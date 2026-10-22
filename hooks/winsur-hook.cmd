@echo off
REM Winsur - forward an agent hook event to the local server.
REM Usage: winsur-hook.cmd EventName [agentType]

set SCRIPT_DIR=%~dp0
powershell -ExecutionPolicy Bypass -NoProfile -File "%SCRIPT_DIR%winsur-hook.ps1" %*
exit /b %ERRORLEVEL%
