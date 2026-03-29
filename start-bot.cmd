@echo off
setlocal
set "ROOT=%~dp0"
call "%ROOT%node-local.cmd" "%ROOT%src\index.js"
exit /b %ERRORLEVEL%
