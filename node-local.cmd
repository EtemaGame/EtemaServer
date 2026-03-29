@echo off
setlocal
set "ROOT=%~dp0"
set "LOCAL_NODE=%ROOT%Tools\node-v24.14.1-win-x64\node.exe"

if exist "%LOCAL_NODE%" (
  "%LOCAL_NODE%" %*
  exit /b %ERRORLEVEL%
)

where node >nul 2>nul
if errorlevel 1 (
  echo No se encontro Node.js. Instala Node.js 18+ o restaura Tools\node-v24.14.1-win-x64.
  exit /b 1
)

node %*
exit /b %ERRORLEVEL%
