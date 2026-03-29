@echo off
setlocal
set "ROOT=%~dp0"
call "%ROOT%node-local.cmd" "%ROOT%src\deploy-commands.js"
exit /b %ERRORLEVEL%
