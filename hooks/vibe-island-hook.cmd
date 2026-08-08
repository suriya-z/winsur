@echo off
REM Winsur hook wrapper (legacy name redirects here)
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0winsur-hook.ps1" %*
