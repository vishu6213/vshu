@echo off
if exist "%LOCALAPPDATA%\Programs\vshu\Vshu.exe" (
  start "" "%LOCALAPPDATA%\Programs\vshu\Vshu.exe"
  exit /b 0
)
if exist "%~dp0dist\Vshu\Vshu.exe" (
  start "" "%~dp0dist\Vshu\Vshu.exe"
  exit /b 0
)
if exist "%~dp0dist\win-unpacked\Vshu.exe" (
  start "" "%~dp0dist\win-unpacked\Vshu.exe"
  exit /b 0
)
echo Vshu.exe not found! Run the installer in Vshu_Installer\ (Vshu-^<version^>-windows-setup.exe).
pause
