@echo off
REM Rejoue backfill_au_crible (--apply) sur une liste de games, une par ligne.
REM Usage : scripts\run_au_crible_list.bat <fichier_liste> <fichier_log>
cd /d "%~dp0.."
set PYTHONIOENCODING=utf-8
echo [%date% %time%] debut liste %1 >> %2
for /f "usebackq delims=" %%G in (%1) do (
    echo [%date% %time%] game %%G >> %2
    .venv\Scripts\python.exe scripts\backfill_au_crible.py --game %%G --apply >> %2 2>&1
)
echo [%date% %time%] FIN >> %2
