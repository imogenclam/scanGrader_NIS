@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
if not exist "bin\ScanGrader.exe" (
  echo Соберите приложение по инструкции в README.md.
  pause
  exit /b 1
)
"bin\ScanGrader.exe" -init-teacher
if errorlevel 1 goto failed
echo Откройте http://127.0.0.1:8080 в браузере. Для остановки нажмите Ctrl+C.
"bin\ScanGrader.exe"
if not errorlevel 1 exit /b 0
:failed
pause
exit /b 1
