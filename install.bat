@echo off
setlocal
title PANDA MUSIC - Installer
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-windows.ps1" %*
set "setup_exit=%errorlevel%"
if not "%setup_exit%"=="0" echo Installation failed. Run install.bat again or check the error above.
pause
exit /b %setup_exit%
