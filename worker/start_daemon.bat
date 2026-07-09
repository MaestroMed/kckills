@echo off
REM ============================================================
REM   KCKILLS Worker daemon — auto-restart wrapper
REM ============================================================
REM
REM   Launched by Windows Task Scheduler (see install_task.ps1).
REM   Loops the daemon: if main.py exits (crash, SIGTERM, etc),
REM   wait 10s and restart. Logs to logs\daemon.log.
REM
REM   To run manually:  worker\start_daemon.bat
REM   To stop:          taskkill /IM python.exe /F  (or close window)
REM ============================================================

cd /d "%~dp0"
if not exist "logs" mkdir "logs"

set PYTHON=.venv\Scripts\python.exe
if not exist "%PYTHON%" (
    echo ERROR: venv not found at %PYTHON%
    echo Run: python -m venv .venv
    echo Then: .venv\Scripts\pip.exe install -r requirements.txt
    pause
    exit /b 1
)

:loop
REM Rotate daemon.log above ~1 GB. NOTE: cmd's IF GTR compares as SIGNED
REM 32-BIT — a 4.5 GB size overflows and the test silently fails. So we
REM test the DIGIT COUNT of the size instead (10+ digits = >= 1 GB).
set "DLOGSZ=0"
for %%F in (logs\daemon.log) do set "DLOGSZ=%%~zF"
if not "%DLOGSZ:~9,1%"=="" (
    del /f /q logs\daemon-1.log 2>nul
    move /y logs\daemon.log logs\daemon-1.log >nul
)
echo [%date% %time%] starting daemon... >> logs\daemon.log
"%PYTHON%" main.py >> logs\daemon.log 2>&1
echo [%date% %time%] daemon exited with code %ERRORLEVEL%, restart in 10s >> logs\daemon.log
timeout /t 10 /nobreak > nul
goto loop
