@echo off
setlocal EnableExtensions EnableDelayedExpansion
set "ROOT=%~dp0"
set "LOGDIR=%ROOT%logs"
if not exist "%LOGDIR%" mkdir "%LOGDIR%"

echo [%date% %time%] Iniciando modo 24/7 >> "%LOGDIR%\runner.log"

:loop
call "%ROOT%node-local.cmd" "%ROOT%src\index.js" >> "%LOGDIR%\bot.log" 2>&1
set "EXITCODE=!ERRORLEVEL!"
echo [%date% %time%] El bot se cerro con codigo !EXITCODE!. Reiniciando en 5 segundos... >> "%LOGDIR%\runner.log"
timeout /t 5 /nobreak >nul
goto loop
