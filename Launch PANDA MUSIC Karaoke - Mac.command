#!/bin/sh
set -eu
cd "$(dirname "$0")"
root=$(pwd -P)

# Open the native Apple Silicon build even when Terminal is running under Rosetta.
if [ "$(uname -s)" = Darwin ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || :)" = 1 ]; then
    exec /usr/bin/arch -arm64 /bin/sh "$0" "$@"
fi

platform=$(uname -s)-$(uname -m)
case "$platform" in
    Darwin-arm64)
        uv_target=aarch64-apple-darwin
        uv_sha=e419bf07533bdbf48795fc793601c834dd79db57a8c49ce8e25cfe3a8639958d
        llama_target=macos-arm64
        llama_sha=89c4ecdf56f1fa11498a7ff9407c6bfea4827e6d184e28c074feb8a41acc18d2
        ;;
    Darwin-x86_64)
        uv_target=x86_64-apple-darwin
        uv_sha=153e03197588204c04fc4c81cc4bafbfa4280222a385e4ee36a87aeec0ae63b4
        llama_target=macos-x64
        llama_sha=44885745e1c25af9061c81276ec1c9dc4140b39d9f4244f3d263197a3ff7bea4
        ;;
    Linux-aarch64)
        uv_target=aarch64-unknown-linux-gnu
        uv_sha=14590f644805a6234ffe071154340669e38137f38e60aa9629690119704107d2
        llama_target=ubuntu-arm64
        llama_sha=0213ce9aa6b3861d8d75874076c240d2892b2cf873bd5e31c15dd0587b73545b
        ;;
    Linux-x86_64)
        uv_target=x86_64-unknown-linux-gnu
        uv_sha=bf65ac1a0af10f92c522d91ac096c7c0a39657647b155577e7836c2cbbb4526c
        llama_target=ubuntu-x64
        llama_sha=d6129b610ad889c80545177a462f49b7960fbddecccdb82a176150a9f0cfede0
        ;;
    *)
        printf 'Unsupported OS/CPU: %s\n' "$platform" >&2
        exit 1
        ;;
esac

if [ "$(uname -s)" = Darwin ]; then
    if ! sw_vers -productVersion | awk -F. '{ exit !($1 > 13 || ($1 == 13 && $2 >= 3)) }'; then
        printf 'This build requires macOS 13.3 or newer.\n' >&2
        exit 1
    fi
    ram_mib=$(($(sysctl -n hw.memsize) / 1024 / 1024))
else
    ram_mib=$(awk '/^MemTotal:/ { print int($2 / 1024); exit }' /proc/meminfo)
fi

export PANDA_LIGHTWEIGHT=1
if [ "$ram_mib" -lt 6144 ]; then export PANDA_LOW_MEMORY=1; fi
if [ "$platform" = Darwin-arm64 ] && [ "$ram_mib" -ge 12288 ]; then
    export PANDA_CPU_WHISPER_MODEL=small
fi
if [ "$ram_mib" -lt 12288 ]; then
    export PANDA_COMPACT_TEXT=1
    model=Qwen3-1.7B-Q8_0.gguf
    model_repo=Qwen3-1.7B-GGUF
    model_sha=061b54daade076b5d3362dac252678d17da8c68f07560be70818cace6590cb1a
else
    model=Qwen3-4B-Q4_K_M.gguf
    model_repo=Qwen3-4B-GGUF
    model_sha=7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5
fi

runtime="$root/.runtime/$platform"
downloads="$runtime/downloads"
editor="$root/.model-cache/lyrics-editor"
llama="$editor/runtime-$platform"
uv="$runtime/uv-$uv_target/uv"
python="$runtime/venv/bin/python"
setup_stamp="$runtime/setup-complete"
export UV_PYTHON_INSTALL_DIR="$runtime/python"
export UV_CACHE_DIR="${UV_CACHE_DIR:-$runtime/uv-cache}"
export HF_HOME="${HF_HOME:-$root/.model-cache/huggingface}"
export XDG_CACHE_HOME="${XDG_CACHE_HOME:-$root/.model-cache}"
mkdir -p "$downloads" "$llama"

sha256() {
    if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1"; else shasum -a 256 "$1"; fi | awk '{print $1}'
}

download() {
    if [ -f "$2" ] && [ "$(sha256 "$2")" = "$3" ]; then return; fi
    if [ ! -f "$2.partial" ] || [ "$(sha256 "$2.partial")" != "$3" ]; then
        curl --fail --location --retry 2 --continue-at - --output "$2.partial" "$1"
    fi
    if [ "$(sha256 "$2.partial")" != "$3" ]; then
        rm -f "$2.partial"
        printf 'Checksum mismatch: %s\n' "$1" >&2
        exit 1
    fi
    mv -f "$2.partial" "$2"
}

if [ ! -x "$uv" ]; then
    printf '[1/3] Downloading the local Python installer\n'
    uv_archive="uv-$uv_target.tar.gz"
    download "https://github.com/astral-sh/uv/releases/download/0.13.10/$uv_archive" "$downloads/$uv_archive" "$uv_sha"
    tar -xzf "$downloads/$uv_archive" -C "$runtime"
fi

requirements_hash=$(sha256 requirements-core.txt)
if [ ! -x "$python" ] || [ "$(cat "$setup_stamp" 2>/dev/null || :)" != "$requirements_hash" ]; then
    printf '[2/3] Installing Python and audio dependencies\n'
    "$uv" python install --no-bin 3.12.16
    if [ ! -x "$python" ]; then "$uv" venv --managed-python --python 3.12.16 "$runtime/venv"; fi
    "$uv" pip install --python "$python" -r requirements-core.txt
    printf '%s\n' "$requirements_hash" > "$setup_stamp"
fi

if [ "$platform" = Darwin-arm64 ] && [ "$ram_mib" -ge 12288 ]; then
    vocal_requirements_hash="$requirements_hash:$(sha256 requirements-mac-vocals.txt)"
    vocal_setup_stamp="$runtime/vocal-setup-complete"
    if [ "$(cat "$vocal_setup_stamp" 2>/dev/null || :)" != "$vocal_requirements_hash" ]; then
        printf 'Installing optional vocal separation for precise sync\n'
        if "$uv" pip install --python "$python" -r requirements-core.txt -r requirements-mac-vocals.txt; then
            printf '%s\n' "$vocal_requirements_hash" > "$vocal_setup_stamp"
        fi
    fi
    if [ "$(cat "$vocal_setup_stamp" 2>/dev/null || :)" = "$vocal_requirements_hash" ] &&
       ffmpeg_path=$("$python" -c 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())'); then
        mkdir -p "$runtime/bin"
        ln -sf "$ffmpeg_path" "$runtime/bin/ffmpeg"
        export PATH="$runtime/bin:$PATH"
        export AUDIO_SEPARATOR_MODEL_DIR="$root/.model-cache/audio-separator"
        export PANDA_MAC_VOCALS=1
    fi
fi

if [ ! -x "$llama/llama-server" ] || [ ! -f "$editor/$model" ]; then
    printf '[3/3] Downloading the local text model and its runtime\n'
    if [ ! -x "$llama/llama-server" ]; then
        llama_archive="llama-b12811-bin-$llama_target.tar.gz"
        download "https://github.com/ggml-org/llama.cpp/releases/download/b12811/$llama_archive" "$downloads/$llama_archive" "$llama_sha"
        tar -xzf "$downloads/$llama_archive" --strip-components 1 -C "$llama"
    fi
    download "https://huggingface.co/Qwen/$model_repo/resolve/main/$model?download=true" "$editor/$model" "$model_sha"
fi

if [ -f "$root/resources/review-start.mp3" ]; then
    cp "$root/resources/review-start.mp3" "$root/static/review-start.mp3" ||
        printf 'Optional review sound could not be installed.\n' >&2
fi

port=${PANDA_STUDIO_PORT:-8001}
url="http://127.0.0.1:$port/"
printf 'PANDA MUSIC Karaoke Studio · %s\n' "$url"
if [ -z "${PANDA_NO_BROWSER:-}" ]; then
    (
        tries=0
        while [ "$tries" -lt 30 ]; do
            if curl --silent --fail --max-time 1 --output /dev/null "$url"; then
                case "$platform" in
                    Darwin-*) open "$url" ;;
                    Linux-*) command -v xdg-open >/dev/null 2>&1 && xdg-open "$url" || : ;;
                esac
                break
            fi
            tries=$((tries + 1))
            sleep 1
        done
    ) &
fi
exec "$python" -m uvicorn app:app --host 127.0.0.1 --port "$port" --log-level info --no-access-log
