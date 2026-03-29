@echo off
setlocal
set "TASKNAME=EtemaServerBot24x7"

C:\Windows\System32\schtasks.exe /Delete /TN "%TASKNAME%" /F
if errorlevel 1 (
  echo No pude eliminar la tarea programada.
  exit /b 1
)

echo Tarea eliminada: %TASKNAME%
