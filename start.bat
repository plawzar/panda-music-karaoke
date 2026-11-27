@echo off
rem Modified 2026-11-27 for a local FFmpeg and CUDA runtime.
setlocal
title PANDA MUSIC - Karaoke Studio
color 0B
set "PYTHONUNBUFFERED=1"
set "PYTHONIOENCODING=utf-8"
if not defined PANDA_STUDIO_PORT set "PANDA_STUDIO_PORT=8001"

echo =======================================================
echo   PANDA MUSIC - Karaoke Studio
echo =======================================================
echo.

cd /d "%~dp0"

REM 1. Check embedded python (Portable Edition)
if exist "%~dp0python_embed\python.exe" (
    set "PY_EXE=%~dp0python_embed\python.exe"
    goto :RUN
)

REM 2. Check local venv
if exist "%~dp0venv\Scripts\python.exe" (
    set "PY_EXE=%~dp0venv\Scripts\python.exe"
    goto :RUN
)

REM 3. Check system python
python --version >nul 2>&1
if not errorlevel 1 (
    set "PY_EXE=python"
    goto :RUN
)

echo [ERROR] Python not found!
echo Please run install.bat first to set up the environment.
pause
exit /b 1

:RUN
if exist "%~dp0ffmpeg\bin\ffmpeg.exe" set "PATH=%~dp0ffmpeg\bin;%PATH%"
if exist "%~dp0venv\Lib\site-packages\torch\lib" set "PATH=%~dp0venv\Lib\site-packages\torch\lib;%PATH%"
if not defined HF_HOME set "HF_HOME=%~dp0.model-cache\huggingface"
if not defined TORCH_HOME set "TORCH_HOME=%~dp0.model-cache\torch"
if not defined XDG_CACHE_HOME set "XDG_CACHE_HOME=%~dp0.model-cache"
if not defined AUDIO_SEPARATOR_MODEL_DIR set "AUDIO_SEPARATOR_MODEL_DIR=%~dp0.model-cache\audio-separator"
echo Server starting at: http://127.0.0.1:%PANDA_STUDIO_PORT%
echo To stop server: press Ctrl+C
echo.

REM Open browser after 2 seconds
if not defined PANDA_NO_BROWSER start "" cmd /c "timeout /t 2 /nobreak >nul && start http://127.0.0.1:%PANDA_STUDIO_PORT%"

"%PY_EXE%" -m uvicorn app:app --host 127.0.0.1 --port %PANDA_STUDIO_PORT% --log-level info --no-access-log
pause
