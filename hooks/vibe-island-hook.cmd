@echo off
REM Vibe Island Win - Agent Hook 包装脚本
REM 功能：调用 PowerShell 脚本处理 Agent 事件
REM 用法：vibe-island-hook.cmd <EventName>

set SCRIPT_DIR=%~dp0
powershell -ExecutionPolicy Bypass -NoProfile -File "%SCRIPT_DIR%vibe-island-hook.ps1" %*
exit /b %ERRORLEVEL%
