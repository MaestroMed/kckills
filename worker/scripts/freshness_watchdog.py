"""Freshness watchdog — tue le daemon s'il GÈLE (log figé), le wrapper relance.

Pourquoi : le 2026-07-17 le daemon a gelé ~10 h (process vivants, boucle
asyncio figée — dernier log 12:08, harvester mort depuis 04:47). Le wrapper
start_daemon.bat ne relance que sur EXIT, pas sur hang, et le module watchdog
interne tourne DANS la boucle gelée (inutile dans ce cas).

Ce script tourne DÉTACHÉ, hors de la boucle : toutes les 5 min il compare le
mtime de logs/daemon.log à l'horloge. Si le log n'a pas avancé depuis
STALL_MIN minutes, il tue les python du daemon (PAS lui-même ni les autres
scripts) → le wrapper relance un daemon frais. Journal :
logs/freshness_watchdog.log.

Lancer (détaché, via WMI comme le daemon) :
  powershell Invoke-CimMethod ... freshness_watchdog.py
"""
from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
LOG = _ROOT / "logs" / "daemon.log"
SELF_LOG = _ROOT / "logs" / "freshness_watchdog.log"
STALL_MIN = 30
CHECK_S = 300
MY_PID = os.getpid()


def wlog(msg: str) -> None:
    with open(SELF_LOG, "a", encoding="utf-8") as f:
        f.write(f"{time.strftime('%Y-%m-%dT%H:%M:%S')} {msg}\n")


def daemon_pids() -> list[int]:
    """PIDs des python lancés par start_daemon (cmdline contient main.py),
    en excluant ce watchdog et tout autre script."""
    out = subprocess.run(
        ["powershell", "-NoProfile", "-Command",
         "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | "
         "ForEach-Object { \"$($_.ProcessId)|$($_.CommandLine)\" }"],
        capture_output=True, text=True, timeout=60).stdout
    pids = []
    for line in (out or "").splitlines():
        if "|" not in line:
            continue
        pid_s, cmd = line.split("|", 1)
        try:
            pid = int(pid_s.strip())
        except ValueError:
            continue
        if pid == MY_PID:
            continue
        if "main.py" in cmd and "scripts" not in cmd.replace("\\", "/"):
            pids.append(pid)
    return pids


def spawn_daemon() -> None:
    """Relance main.py détaché, stdout/err en append dans daemon.log.
    Wave 46 — le watchdog devient LE superviseur : le wrapper .bat s'est
    montré fragile (cmd via WMI/Start-Process meurt sans console, timeout
    /nobreak KO hors console interactive). Ici : Popen direct, flags
    DETACHED, handle en append — survit à la mort du watchdog."""
    py = str(_ROOT / ".venv" / "Scripts" / "python.exe")
    logf = open(_ROOT / "logs" / "daemon.log", "ab")
    flags = 0x00000008 | 0x00000200  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
    p = subprocess.Popen([py, "main.py"], cwd=str(_ROOT),
                         stdout=logf, stderr=subprocess.STDOUT,
                         creationflags=flags)
    wlog(f"daemon relancé par le watchdog (pid {p.pid})")


BACKUP_MARK = _ROOT / "logs" / ".last_backup_day"


def daily_backup_if_due() -> None:
    """Sauvegarde quotidienne — le watchdog est le seul process toujours
    vivant, donc c'est lui qui la porte (Audit 2.0 : la tache planifiee
    Windows echouait en silence en affichant vert depuis des mois)."""
    today = time.strftime("%Y-%m-%d")
    try:
        if BACKUP_MARK.exists() and BACKUP_MARK.read_text().strip() == today:
            return
    except Exception:
        pass
    py = str(_ROOT / ".venv" / "Scripts" / "python.exe")
    wlog("sauvegarde quotidienne : demarrage")
    try:
        r = subprocess.run([py, "scripts/backup_supabase.py"], cwd=str(_ROOT),
                           capture_output=True, text=True, timeout=3600)
        tail = (r.stdout or "").strip().splitlines()[-1:] or [""]
        if r.returncode == 0:
            BACKUP_MARK.write_text(today)
            wlog(f"sauvegarde OK — {tail[0][:120]}")
        else:
            # On n'ecrit PAS le marqueur : on retentera au prochain tick.
            wlog(f"SAUVEGARDE ECHOUEE (code {r.returncode}) — {tail[0][:120]}")
    except Exception as e:
        wlog(f"sauvegarde exception: {str(e)[:150]}")


def main() -> None:
    wlog(f"watchdog démarré (stall>{STALL_MIN}min -> kill, check {CHECK_S}s)")
    while True:
        try:
            age_min = (time.time() - LOG.stat().st_mtime) / 60 if LOG.exists() else 0
            if age_min > STALL_MIN:
                pids = daemon_pids()
                if pids:
                    wlog(f"GEL détecté (log figé {age_min:.0f} min) — kill {pids}")
                    for p in pids:
                        subprocess.run(["taskkill", "/PID", str(p), "/F"],
                                       capture_output=True, timeout=30)
                    wlog("daemon tué — le wrapper start_daemon relance")
                    time.sleep(120)  # laisser le restart s'installer
                else:
                    wlog(f"log figé {age_min:.0f} min et aucun daemon — respawn direct")
                    spawn_daemon()
                    time.sleep(120)
            daily_backup_if_due()
        except Exception as e:
            wlog(f"erreur: {str(e)[:150]}")
        time.sleep(CHECK_S)


if __name__ == "__main__":
    main()
