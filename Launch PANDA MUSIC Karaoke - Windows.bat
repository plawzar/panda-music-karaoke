@echo off
setlocal
title PANDA MUSIC - Karaoke Studio
cd /d "%~dp0"

call :READ_PROFILE
if not errorlevel 1 goto :LAUNCH

:SETUP
echo Preparing or updating the Windows runtime and local models.
echo Keep this window open until the studio starts.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-windows.ps1"
if errorlevel 1 goto :FAILED
call :READ_PROFILE
if errorlevel 1 goto :FAILED

:LAUNCH
if "%PANDA_LLAMA_BUILD%"=="cpu" set "PANDA_LIGHTWEIGHT=1"
if "%PANDA_VOCAL_BACKEND%"=="directml" (
    set "PANDA_STUDIO_PYTHON=%~dp0.runtime\directml-venv\Scripts\python.exe"
    set "PANDA_VOCAL_DIRECTML=1"
    set "PANDA_CPU_WHISPER_MODEL=small"
)
if "%PANDA_TEXT_WEIGHTS%"=="Qwen3-1.7B-Q8_0.gguf" set "PANDA_COMPACT_TEXT=1"
call "%~dp0start.bat"
exit /b %errorlevel%

:READ_PROFILE
if not exist ".runtime\setup-profile-v5" exit /b 1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-windows.ps1" -Check
if errorlevel 1 exit /b 1
for /f "tokens=1-4" %%A in (.runtime\setup-profile-v5) do (
    set "PANDA_LLAMA_BUILD=%%A"
    set "PANDA_TEXT_WEIGHTS=%%B"
    set "PANDA_LOW_MEMORY=%%C"
    set "PANDA_VOCAL_BACKEND=%%D"
)
if "%PANDA_VOCAL_BACKEND%"=="directml" (
    if not exist ".runtime\directml-venv\Scripts\python.exe" exit /b 1
    if not exist "ffmpeg\bin\ffmpeg.exe" exit /b 1
) else (
    if not exist "venv\Scripts\python.exe" exit /b 1
)
if not exist ".model-cache\lyrics-editor\runtime-%PANDA_LLAMA_BUILD%\llama-server.exe" exit /b 1
if not exist ".model-cache\lyrics-editor\%PANDA_TEXT_WEIGHTS%" exit /b 1
if "%PANDA_LLAMA_BUILD%"=="vulkan" if not exist "ffmpeg\bin\ffmpeg.exe" exit /b 1
exit /b 0

:FAILED
echo Installation failed. Launch this file again to retry.
pause
exit /b 1
