@echo off
setlocal
set "ROOT=%~dp0"
set "LOCAL_NODE_DIR=%ROOT%Tools\node-v24.14.1-win-x64"
set "LOCAL_NPM=%ROOT%Tools\node-v24.14.1-win-x64\npm.cmd"

if exist "%LOCAL_NODE_DIR%\node.exe" (
  set "PATH=%LOCAL_NODE_DIR%;%PATH%"
)

pushd "%ROOT%" >nul
if errorlevel 1 (
  echo No pude abrir la carpeta del proyecto: %ROOT%
  exit /b 1
)

if exist "%LOCAL_NPM%" (
  call "%LOCAL_NPM%" %*
  set "EXITCODE=%ERRORLEVEL%"
  popd >nul
  exit /b %EXITCODE%
)

where npm >nul 2>nul
if errorlevel 1 (
  popd >nul
  echo No se encontro npm. Instala Node.js 18+ o restaura Tools\node-v24.14.1-win-x64.
  exit /b 1
)

npm %*
set "EXITCODE=%ERRORLEVEL%"
popd >nul
exit /b %EXITCODE%
