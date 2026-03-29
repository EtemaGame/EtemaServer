@echo off
setlocal
set "ROOT=%~dp0"
set "TASKNAME=EtemaServerBot24x7"

C:\Windows\System32\schtasks.exe /Create /TN "%TASKNAME%" /SC ONLOGON /TR "\"%ROOT%run-bot-24-7.cmd\"" /F
if errorlevel 1 (
  echo No pude crear la tarea programada.
  exit /b 1
)

echo Tarea creada correctamente: %TASKNAME%
echo Se iniciara automaticamente al abrir sesion.
