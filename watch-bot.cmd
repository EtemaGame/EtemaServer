@echo off
setlocal
set "ROOT=%~dp0"
call "%ROOT%node-local.cmd" --watch "%ROOT%src\index.js"
exit /b %ERRORLEVEL%
