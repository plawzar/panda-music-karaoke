param([switch]$Cpu, [switch]$Check)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$runtime = Join-Path $root '.runtime'
$downloads = Join-Path $runtime 'downloads'
$profilePath = Join-Path $runtime 'setup-profile-v5'

function Get-Sha256([string]$Path) {
    $stream = [System.IO.File]::OpenRead($Path)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { return [System.BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '') }
    finally { $sha.Dispose(); $stream.Dispose() }
}

$fingerprint = @(
    Get-Sha256 $PSCommandPath
    Get-Sha256 (Join-Path $root 'requirements-core.txt')
    Get-Sha256 (Join-Path $root 'requirements.txt')
) -join '-'
if ($Check) {
    if (!(Test-Path -LiteralPath $profilePath -PathType Leaf)) { exit 1 }
    $profile = ((Get-Content -LiteralPath $profilePath -Raw).Trim() -split '\s+')
    if ($profile.Count -ne 5 -or $profile[4] -ne $fingerprint) { exit 1 }
    exit 0
}

New-Item -ItemType Directory -Path $downloads -Force | Out-Null

function Save-VerifiedFile($Url, $Destination, $Sha256) {
    if (Test-Path -LiteralPath $Destination) {
        if ((Get-Sha256 $Destination) -eq $Sha256) { return }
    }
    $partial = "$Destination.partial"
    if (!(Test-Path -LiteralPath $partial) -or (Get-Sha256 $partial) -ne $Sha256) {
        & curl.exe --fail --location --retry 2 --continue-at - --output $partial $Url
        if ($LASTEXITCODE -ne 0) { throw "Download failed: $Url" }
    }
    if ((Get-Sha256 $partial) -ne $Sha256) {
        Remove-Item -LiteralPath $partial
        throw "Download did not match its SHA-256 checksum: $Url"
    }
    Move-Item -LiteralPath $partial -Destination $Destination -Force
}

function Invoke-Uv([string[]]$Arguments) {
    & $uv @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Installation step failed: uv $($Arguments -join ' ')" }
}

function Install-FFmpeg {
    $ffmpeg = Join-Path $root 'ffmpeg'
    if (Test-Path -LiteralPath (Join-Path $ffmpeg 'bin/ffmpeg.exe')) { return }
    $ffmpegZip = Join-Path $downloads 'ffmpeg-7.1.1-full_build-shared.zip'
    Save-VerifiedFile 'https://github.com/GyanD/codexffmpeg/releases/download/7.1.1/ffmpeg-7.1.1-full_build-shared.zip' $ffmpegZip '9f28727e8b472a04c1d2e520aaa425dca82721b995139b35710091130ea6e699'
    $ffmpegUnpack = Join-Path $runtime 'ffmpeg-unpack'
    Expand-Archive -LiteralPath $ffmpegZip -DestinationPath $ffmpegUnpack -Force
    $ffmpegBin = (Get-ChildItem -LiteralPath $ffmpegUnpack -Filter 'ffmpeg.exe' -File -Recurse | Select-Object -First 1).DirectoryName
    if (!$ffmpegBin) { throw 'ffmpeg.exe was not found in the download.' }
    New-Item -ItemType Directory -Path $ffmpeg -Force | Out-Null
    Copy-Item -LiteralPath $ffmpegBin -Destination $ffmpeg -Recurse -Force
}

Write-Host '[1/3] Python 3.12 and local environment'
$uvDirectory = Join-Path $runtime 'uv'
$uv = Join-Path $uvDirectory 'uv.exe'
if (!(Test-Path -LiteralPath $uv)) {
    $uvZip = Join-Path $downloads 'uv-0.13.10.zip'
    Save-VerifiedFile 'https://github.com/astral-sh/uv/releases/download/0.13.10/uv-x86_64-pc-windows-msvc.zip' $uvZip '297b3881fe1adfb922becc2c1613202abb41dc83ea5ff43d472aa087ca1f8683'
    Expand-Archive -LiteralPath $uvZip -DestinationPath $uvDirectory -Force
    $uv = (Get-ChildItem -LiteralPath $uvDirectory -Filter 'uv.exe' -File -Recurse | Select-Object -First 1).FullName
    if (!$uv) { throw 'uv.exe was not found in the installer archive.' }
}
$env:UV_PYTHON_INSTALL_DIR = Join-Path $runtime 'python'
$environment = Join-Path $root 'venv'
$python = Join-Path $environment 'Scripts/python.exe'
if (!(Test-Path -LiteralPath $python)) {
    Invoke-Uv @('python', 'install', '--no-bin', '3.12.16')
    Invoke-Uv @('venv', '--managed-python', '--python', '3.12.16', $environment)
}

Write-Host '[2/3] Audio and speech dependencies'
$ramMiB = [math]::Floor((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1MB)
$full = $false
if (!$Cpu -and (Get-Command nvidia-smi -ErrorAction SilentlyContinue)) {
    $gpus = & nvidia-smi --query-gpu=driver_version,memory.total --format=csv,noheader,nounits 2>$null
    foreach ($gpu in $gpus) {
        if ($gpu -match '^\s*(\d+\.\d+)\s*,\s*(\d+)\s*$' -and
            [version]$Matches[1] -ge [version]'570.0' -and [int]$Matches[2] -ge 4096 -and $ramMiB -ge 8192) {
            $full = $true
            break
        }
    }
}
if ($full) {
    Write-Host 'Selected NVIDIA profile: WhisperX, vocal isolation and GPU text inference.'
    try {
        Invoke-Uv @('pip', 'install', '--python', $python,
            '-r', (Join-Path $root 'requirements.txt'), 'onnxruntime==1.26.0',
            'torch @ https://download.pytorch.org/whl/cu128/torch-2.8.0%2Bcu128-cp312-cp312-win_amd64.whl',
            'torchaudio @ https://download.pytorch.org/whl/cu128/torchaudio-2.8.0%2Bcu128-cp312-cp312-win_amd64.whl',
            'torchvision @ https://download.pytorch.org/whl/cu128/torchvision-0.23.0%2Bcu128-cp312-cp312-win_amd64.whl')
        & $python -c "import torch, whisperx; assert torch.cuda.is_available()"
        if ($LASTEXITCODE -ne 0) { throw 'The CUDA runtime is unavailable.' }
        Install-FFmpeg
    } catch {
        Write-Warning "NVIDIA profile installation failed. Trying an alternative profile. $_"
        $full = $false
    }
}
$directml = $false
if (!$full -and !$Cpu -and $ramMiB -ge 6144) {
    $radeon = Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue |
        Where-Object { $_.PNPDeviceID -match '^PCI\\VEN_1002&' }
    if ($radeon) {
        Write-Host 'Trying Radeon DirectML: GPU vocal separation and CPU speech recognition.'
        try {
            $directmlEnvironment = Join-Path $runtime 'directml-venv'
            $directmlPython = Join-Path $directmlEnvironment 'Scripts/python.exe'
            if (!(Test-Path -LiteralPath $directmlPython)) {
                Invoke-Uv @('venv', '--managed-python', '--python', '3.12.16', $directmlEnvironment)
            }
            # faster-whisper declares the CPU distribution. DirectML provides the
            # same onnxruntime module, and installing both overwrites shared files.
            $excludes = Join-Path $runtime 'directml-excludes.txt'
            Set-Content -LiteralPath $excludes -Value 'onnxruntime' -Encoding ASCII
            Invoke-Uv @('pip', 'install', '--python', $directmlPython, '--excludes', $excludes,
                '-r', (Join-Path $root 'requirements-core.txt'), 'audio-separator==0.48.0', 'audioread>=3.0.0', 'onnxruntime-directml==1.24.4',
                'torch @ https://download.pytorch.org/whl/cpu/torch-2.8.0%2Bcpu-cp312-cp312-win_amd64.whl',
                'torchvision @ https://download.pytorch.org/whl/cpu/torchvision-0.23.0%2Bcpu-cp312-cp312-win_amd64.whl')
            & $directmlPython -c "import onnxruntime as ort; from audio_separator.separator import Separator; assert 'DmlExecutionProvider' in ort.get_available_providers()"
            if ($LASTEXITCODE -ne 0) { throw 'The DirectML runtime is unavailable.' }
            Install-FFmpeg
            $directml = $true
        } catch {
            Write-Warning "DirectML setup failed. Continuing with the CPU profile. $_"
        }
    }
}
if (!$full -and !$directml) {
    Write-Host 'Selected lightweight CPU profile: faster-whisper int8.'
    Invoke-Uv @('pip','install','--python',$python,'-r',(Join-Path $root 'requirements-core.txt'))
}

Write-Host '[3/3] Local text model'
$editor = Join-Path $root '.model-cache/lyrics-editor'
$llama = Join-Path $editor 'runtime'
New-Item -ItemType Directory -Path $llama -Force | Out-Null
$llamaBuild = 'cpu'
$llamaSha = '7316c7c0e1f6a35c46ed386d140a9854f49d2496a3a368ab38d2805da70c7b2d'
if ($full) {
    $llamaBuild = 'vulkan'
    $llamaSha = '97dfdec913525798762df030e638f62ede2c64e85346765e5570b2ba0d4bec8c'
}
$llama = Join-Path $editor "runtime-$llamaBuild"
if (!(Test-Path -LiteralPath (Join-Path $llama 'llama-server.exe'))) {
    $asset = "llama-b12811-bin-win-$llamaBuild-x64.zip"
    $llamaZip = Join-Path $downloads $asset
    Save-VerifiedFile "https://github.com/ggml-org/llama.cpp/releases/download/b12811/$asset" $llamaZip $llamaSha
    Expand-Archive -LiteralPath $llamaZip -DestinationPath $llama -Force
}
if ($ramMiB -lt 12288) {
    $model = 'Qwen3-1.7B-Q8_0.gguf'
    Save-VerifiedFile 'https://huggingface.co/Qwen/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q8_0.gguf?download=true' (Join-Path $editor $model) '061b54daade076b5d3362dac252678d17da8c68f07560be70818cace6590cb1a'
} else {
    $model = 'Qwen3-4B-Q4_K_M.gguf'
    Save-VerifiedFile 'https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf?download=true' (Join-Path $editor $model) '7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5'
}

$lowMemory = [int]($ramMiB -lt 6144)
$vocalBackend = if ($directml) { 'directml' } else { 'default' }
$pendingProfile = "$profilePath.partial"
Set-Content -LiteralPath $pendingProfile -Value "$llamaBuild $model $lowMemory $vocalBackend $fingerprint" -Encoding ASCII
Move-Item -LiteralPath $pendingProfile -Destination $profilePath -Force
Write-Host 'Installation complete. Use Launch PANDA MUSIC Karaoke - Windows.bat to open the studio.'
