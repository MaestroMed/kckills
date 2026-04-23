@echo off
REM ============================================================
REM   KCKILLS Worker — orchestrator (4-process split) launcher
REM ============================================================
REM   Runs the multi-process orchestrator with auto-restart on
REM   crash. Companion to start_daemon.bat (which runs main.py
REM   single-process mode). Use this one when you want the GIL-
REM   free CPU/IO split shipped in PR-orchestrator.
REM
REM   To run manually:  worker\start_orchestrator.bat
REM   To stop:          taskkill /IM python.exe /F  (or close window)
REM ============================================================

cd /d "%~dp0"
if not exist "logs" mkdir "logs"

set PYTHON=.venv\Scripts\python.exe
if not exist "%PYTHON%" (
    echo ERROR: venv not found at %PYTHON%
    pause
    exit /b 1
)

:loop
echo [%date% %time%] starting orchestrator... >> logs\orchestrator.log
"%PYTHON%" orchestrator.py >> logs\orchestrator.log 2>&1
echo [%date% %time%] orchestrator exited with code %ERRORLEVEL%, restart in 10s >> logs\orchestrator.log
timeout /t 10 /nobreak > nul
goto loop
