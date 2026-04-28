@echo off
REM ════════════════════════════════════════════════════════════════════
REM  start_worker_supervisor.bat
REM
REM  Convenience wrapper for Windows Task Scheduler / manual launch.
REM  Activates the right Python, sets UTF-8, and starts the supervisor
REM  in the worker/ directory so all relative paths resolve correctly.
REM ════════════════════════════════════════════════════════════════════

REM Force UTF-8 stdout — Windows code page 1252 mangles structlog box-
REM drawing characters and the supervisor's log timestamps.
set PYTHONIOENCODING=utf-8
chcp 65001 > nul

REM Move to the worker dir so .env reads + relative imports work.
cd /d "C:\Users\Matter1\Karmine_Stats\worker"

REM Use the system Python (matches what the user has been using
REM interactively). If you keep a venv, swap this for:
REM    .\venv\Scripts\python.exe scripts\supervise_worker.py
python scripts\supervise_worker.py

REM If the supervisor exits cleanly (Ctrl+C / SIGTERM), this script
REM just ends. Task Scheduler is configured to NOT respawn on clean
REM exit — only on unexpected exit codes.
exit /b %ERRORLEVEL%
