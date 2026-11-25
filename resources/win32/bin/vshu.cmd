@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
set "LAUNCHER=%SCRIPT_DIR%vshu.exe"
if not exist "%LAUNCHER%" (
  set "LAUNCHER=%SCRIPT_DIR%vshu.exe"
)

if exist "%LAUNCHER%" (
  if /I "%~1"=="orchestration" if /I "%~2"=="send" goto :unsafe_body
  if /I "%~1"=="orchestration" if /I "%~2"=="reply" goto :unsafe_body
  "%LAUNCHER%" %*
  exit /b %ERRORLEVEL%
)

set "ELECTRON=%SCRIPT_DIR%..\..\Vshu.exe"
if not exist "%ELECTRON%" (
  set "ELECTRON=%SCRIPT_DIR%..\..\Vshu.exe"
)
if not exist "%ELECTRON%" (
  set "ELECTRON=%SCRIPT_DIR%..\Vshu.exe"
)
if not exist "%ELECTRON%" (
  set "ELECTRON=%SCRIPT_DIR%..\Vshu.exe"
)

set "CLI=%SCRIPT_DIR%..\app.asar.unpacked\out\cli\index.js"
if not exist "%CLI%" (
  set "CLI=%SCRIPT_DIR%..\app\out\cli\index.js"
)
if not exist "%CLI%" (
  set "CLI=%SCRIPT_DIR%..\out\cli\index.js"
)

if not exist "%ELECTRON%" (
  echo Unable to locate Vshu executable at "%ELECTRON%" 1>&2
  exit /b 1
)

if not exist "%CLI%" (
  echo Unable to locate Vshu CLI entrypoint at "%CLI%" 1>&2
  exit /b 1
)

set "VSHU_NODE_OPTIONS=%NODE_OPTIONS%"
set "VSHU_NODE_REPL_EXTERNAL_MODULE=%NODE_REPL_EXTERNAL_MODULE%"
set NODE_OPTIONS=
set NODE_REPL_EXTERNAL_MODULE=
set ELECTRON_RUN_AS_NODE=1

"%ELECTRON%" "%CLI%" %*
exit /b %ERRORLEVEL%

:unsafe_body
echo vshu.cmd cannot safely forward orchestration message bodies. Use "%LAUNCHER%" instead. 1>&2
exit /b 2
