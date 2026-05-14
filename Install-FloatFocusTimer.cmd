@echo off
setlocal
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\Install-FloatFocusTimer.ps1"
if errorlevel 1 (
  echo.
  echo Setup failed. Check the message above.
  pause
  exit /b 1
)

echo.
echo Setup complete. You can launch FloatFocus Timer from the desktop shortcut.
pause
