@echo off
REM KCKills Worker — Windows startup script
REM Run this to start the worker daemon on your PC

echo === KCKills Worker ===
echo.

cd /d "%~dp0\..\worker"

REM Check Python
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python is not installed.
    pause
    exit /b 1
)

echo Starting worker daemon...
echo Press Ctrl+C to stop.
echo.

python -m src.main

pause
