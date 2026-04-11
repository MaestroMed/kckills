@echo off
REM KCKILLS / LoLTok Worker — Windows launcher
REM Starts the supervised daemon. Crash-restart loop: if the process dies,
REM wait 10s and relaunch.
REM
REM Hook it into Windows Task Scheduler with:
REM   Trigger: At startup
REM   Action : Start a program -> "%~dp0scripts\run-worker.bat"
REM   Settings: "If the task fails, restart every 1 minute" x 999

setlocal
cd /d "%~dp0\..\worker"

echo ================================================================
echo   KCKILLS / LoLTok Worker
echo ================================================================
echo.

REM Optional venv
if exist ".venv\Scripts\activate.bat" (
    call .venv\Scripts\activate.bat
)

REM Check Python
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python is not installed or not in PATH.
    pause
    exit /b 1
)

:loop
echo [%date% %time%] Starting daemon...
python main.py
echo [%date% %time%] Daemon exited with code %errorlevel%. Restarting in 10s...
timeout /t 10 /nobreak >nul
goto loop
