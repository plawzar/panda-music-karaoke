param([switch]$Cpu)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$runtime = Join-Path $root '.runtime'
$downloads = Join-Path $runtime 'downloads'
New-Item -ItemType Directory -Path $downloads -Force | Out-Null

function Save-VerifiedFile($Url, $Destination, $Sha256) {
    if (Test-Path -LiteralPath $Destination) {
        if ((Get-FileHash -LiteralPath $Destination).Hash -eq $Sha256) { return }
        throw "Existing download failed verification: $Destination"
    }
    $partial = "$Destination.partial"
    & curl.exe --fail --location --retry 2 --continue-at - --output $partial $Url
    if ($LASTEXITCODE -ne 0) { throw "Download failed: $Url" }
    if ((Get-FileHash -LiteralPath $partial).Hash -ne $Sha256) {
        Remove-Item -LiteralPath $partial
        throw "Download did not match its SHA-256 checksum: $Url"
    }
    Move-Item -LiteralPath $partial -Destination $Destination
}

function Invoke-Uv([string[]]$Arguments) {
    & $uv @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Installation step failed: uv $($Arguments -join ' ')" }
}

Write-Host '[1/4] Python 3.12 and local environment'
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
    Invoke-Uv @('python', 'install', '3.12.16')
    Invoke-Uv @('venv', '--managed-python', '--python', '3.12.16', $environment)
}

Write-Host '[2/4] Audio and speech dependencies'
$torchIndex = 'https://download.pytorch.org/whl/cpu'
$onnx = 'onnxruntime==1.26.0'
if (!$Cpu -and (Get-Command nvidia-smi -ErrorAction SilentlyContinue)) {
    $driver = & nvidia-smi --query-gpu=driver_version --format=csv,noheader 2>$null | Select-Object -First 1
    if ($driver -and $driver -match '^\d+\.\d+$' -and [version]$driver -ge [version]'570.0') {
        $torchIndex = 'https://download.pytorch.org/whl/cu128'
        $onnx = 'onnxruntime-gpu==1.26.0'
    }
}
Invoke-Uv @('pip','install','--python',$python,'--index-url',$torchIndex,'torch==2.8.0','torchaudio==2.8.0','torchvision==0.23.0')
Invoke-Uv @('pip','install','--python',$python,'-r',(Join-Path $root 'requirements.txt'),$onnx)

Write-Host '[3/4] FFmpeg'
$ffmpeg = Join-Path $root 'ffmpeg'
if (!(Test-Path -LiteralPath (Join-Path $ffmpeg 'bin/ffmpeg.exe'))) {
    $ffmpegZip = Join-Path $downloads 'ffmpeg-7.1.1-full_build-shared.zip'
    Save-VerifiedFile 'https://github.com/GyanD/codexffmpeg/releases/download/7.1.1/ffmpeg-7.1.1-full_build-shared.zip' $ffmpegZip '9f28727e8b472a04c1d2e520aaa425dca82721b995139b35710091130ea6e699'
    $ffmpegUnpack = Join-Path $runtime 'ffmpeg-unpack'
    Expand-Archive -LiteralPath $ffmpegZip -DestinationPath $ffmpegUnpack -Force
    $ffmpegBin = (Get-ChildItem -LiteralPath $ffmpegUnpack -Filter 'ffmpeg.exe' -File -Recurse | Select-Object -First 1).DirectoryName
    if (!$ffmpegBin) { throw 'ffmpeg.exe was not found in the download.' }
    New-Item -ItemType Directory -Path $ffmpeg -Force | Out-Null
    Copy-Item -LiteralPath $ffmpegBin -Destination $ffmpeg -Recurse -Force
}

Write-Host '[4/4] Local text model (2.5 GB)'
$editor = Join-Path $root '.model-cache/lyrics-editor'
$llama = Join-Path $editor 'runtime'
New-Item -ItemType Directory -Path $llama -Force | Out-Null
if (!(Test-Path -LiteralPath (Join-Path $llama 'llama-server.exe'))) {
    $llamaZip = Join-Path $downloads 'llama-b12811-bin-win-vulkan-x64.zip'
    Save-VerifiedFile 'https://github.com/ggml-org/llama.cpp/releases/download/b12811/llama-b12811-bin-win-vulkan-x64.zip' $llamaZip '97dfdec913525798762df030e638f62ede2c64e85346765e5570b2ba0d4bec8c'
    Expand-Archive -LiteralPath $llamaZip -DestinationPath $llama -Force
}
Save-VerifiedFile 'https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf?download=true' (Join-Path $editor 'Qwen3-4B-Q4_K_M.gguf') '7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5'

Write-Host 'Installation complete. Launch start.bat.'
