@echo off
REM Winsur Win - Agent Hook åŒ…è£…è„šæœ¬
REM åŠŸèƒ½ï¼šè°ƒç”¨ PowerShell è„šæœ¬å¤„ç† Agent äº‹ä»¶
REM ç”¨æ³•ï¼šwinsur-hook.cmd <EventName>

set SCRIPT_DIR=%~dp0
powershell -ExecutionPolicy Bypass -NoProfile -File "%SCRIPT_DIR%winsur-hook.ps1" %*
exit /b %ERRORLEVEL%

