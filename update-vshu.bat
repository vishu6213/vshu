@echo off
title Vshu - 1-Click Update
echo ====================================================
echo             VSHU 1-CLICK UPDATE
echo ====================================================
echo 1. Sync: rebrand the latest upstream code and merge it (scripts\sync-upstream.mjs).
echo    Your logo, icons, README and other branded files are always kept;
echo    the brand assets are regenerated and the rebrand is checked.
echo 2. Install dependencies, build, package and build the installer.
echo.

cd /d "%~dp0"

node scripts\sync-upstream.mjs --merge
if %ERRORLEVEL% NEQ 0 goto :sync_failed

call pnpm install
if %ERRORLEVEL% NEQ 0 goto :failed

node scripts\vshu-rebrand.mjs --check
if %ERRORLEVEL% NEQ 0 goto :failed

call pnpm run build:cli
if %ERRORLEVEL% NEQ 0 goto :failed

call pnpm run build:electron-vite
if %ERRORLEVEL% NEQ 0 goto :failed

node config\scripts\native-build\windows\upstream-release-windows-addons.mjs >nul 2>&1
call pnpm run ensure:electron-runtime
if %ERRORLEVEL% NEQ 0 (
  echo.
  echo [WARN] Native addon rebuild skipped ^(Visual Studio C++ Build Tools not installed^).
  echo        Continuing with prebuilt native addons...
)

taskkill /F /IM Vshu.exe /T >nul 2>&1
node scripts\package-vshu-app.mjs --installer
if %ERRORLEVEL% NEQ 0 goto :failed

echo.
echo ====================================================
echo Update finished successfully!
echo The installer is in Vshu_Installer\. To ship it to users as an
echo in-app update, bump the version and publish a release (RELEASING.md).
echo ====================================================
pause
exit /b 0

:sync_failed
echo.
echo ====================================================
echo [ERROR] The upstream sync stopped. See the logs above.
echo If the merge has conflicts: resolve them, then
echo   git commit
echo   node scripts\apply-vshu-branding.mjs
echo   (commit again if that changed any file)
echo and run this script again. To give up: git merge --abort
echo ====================================================
pause
exit /b 1

:failed
echo.
echo ====================================================
echo [ERROR] Update stopped. See the logs above.
echo ====================================================
pause
exit /b 1
