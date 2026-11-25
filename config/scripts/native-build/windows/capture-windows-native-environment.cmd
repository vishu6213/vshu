@echo off
chcp 65001 >nul
call "%VSHU_WINDOWS_VSDEVCMD%" -no_logo -arch=%VSHU_WINDOWS_NATIVE_ARCH% -host_arch=%VSHU_WINDOWS_NATIVE_ARCH%
if errorlevel 1 exit /b 1
echo VSHU_WINDOWS_NATIVE_ENVIRONMENT
set
