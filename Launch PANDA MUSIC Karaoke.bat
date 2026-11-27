@echo off
setlocal
title PANDA MUSIC - Karaoke Studio
cd /d "%~dp0"

if not exist ".runtime\setup-complete" goto :SETUP
if not exist "venv\Scripts\python.exe" goto :SETUP
if not exist "ffmpeg\bin\ffmpeg.exe" goto :SETUP
if not exist ".model-cache\lyrics-editor\runtime\llama-server.exe" goto :SETUP
if not exist ".model-cache\lyrics-editor\Qwen3-4B-Q4_K_M.gguf" goto :SETUP
goto :LAUNCH

:SETUP
echo First launch: downloading the Windows runtime and local models.
echo Keep this window open until the studio starts.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-windows.ps1"
if errorlevel 1 (
    echo Installation failed. Launch this file again to retry.
    pause
    exit /b 1
)

:LAUNCH
call "%~dp0start.bat"
exit /b %errorlevel%
