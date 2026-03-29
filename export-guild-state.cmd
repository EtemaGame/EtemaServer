@echo off
setlocal
set "ROOT=%~dp0"
call "%ROOT%node-local.cmd" "%ROOT%src\export-guild-state.js"
exit /b %ERRORLEVEL%
