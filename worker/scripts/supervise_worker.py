"""
supervise_worker.py — KCKills worker watchdog + auto-restart.

Why this exists
───────────────
The 2026-04-29 audit found the worker had been DEAD for ~13 hours after
a silent kill (likely OS reboot / session close — no traceback in the
logs). The user thought it was running ; throughput collapsed without
any warning. Backlog stayed put.

This supervisor :
  1. Spawns `python main.py` as a subprocess
  2. Streams its stdout/stderr to a rotating log file
  3. If the worker exits (any reason) → restart with exponential backoff
     (1s → 2s → 4s → 8s → 16s → 32s, capped at 60s)
  4. Resets the backoff after 5 min of stable runtime (so a crashy worker
     doesn't end up sleeping for hours between restarts)
  5. Catches SIGTERM / SIGINT / Ctrl+C to forward to the worker and exit
     cleanly without a respawn loop
  6. On Windows : also handles CTRL_BREAK so the worker can be stopped
     manually via taskkill without the supervisor immediately respawning
  7. Pings Discord webhook on every restart so you SEE crashes happening

Run it
──────
  python worker/scripts/supervise_worker.py

For auto-start on Windows logon, schedule via Task Scheduler — see
docs/analytics-and-ops-setup.md or the .xml in this folder.

For Linux/macOS :
  systemctl --user enable kckills-worker.service
  (template service file in worker/systemd/ — TODO if needed)
"""

from __future__ import annotations

import datetime
import logging
import logging.handlers
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

# ─── Config ────────────────────────────────────────────────────────────

WORKER_DIR = Path(__file__).resolve().parent.parent
WORKER_SCRIPT = WORKER_DIR / "main.py"
LOG_DIR = WORKER_DIR / "logs"
LOG_DIR.mkdir(exist_ok=True)
LOG_FILE = LOG_DIR / "worker.log"
SUPERVISOR_LOG = LOG_DIR / "supervisor.log"

# Backoff after a crash : 1, 2, 4, 8, 16, 32, then cap at 60s.
BACKOFF_BASE_SECONDS = 1
BACKOFF_MAX_SECONDS = 60
# After this much stable runtime, reset the backoff to 1s (so a worker
# that's been healthy for 5 min then crashes restarts fast).
STABLE_RUNTIME_RESET_SECONDS = 5 * 60

# Read DISCORD_WATCHDOG_URL from worker/.env if present.
def _read_env(key: str) -> str | None:
    env_path = WORKER_DIR / ".env"
    if not env_path.exists():
        return None
    for line in env_path.read_text(encoding="utf-8").splitlines():
        if line.startswith(f"{key}="):
            return line.split("=", 1)[1].strip()
    return None


DISCORD_WEBHOOK = _read_env("DISCORD_WATCHDOG_URL")


# ─── Logging ──────────────────────────────────────────────────────────

def setup_logging() -> logging.Logger:
    """Rotating supervisor log + console mirror."""
    logger = logging.getLogger("supervisor")
    logger.setLevel(logging.INFO)
    fmt = logging.Formatter(
        "%(asctime)sZ [supervisor] %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
    )
    fmt.converter = time.gmtime  # UTC

    # Rotating file : 10 MB × 5 = ~50 MB max for supervisor's own log
    fh = logging.handlers.RotatingFileHandler(
        SUPERVISOR_LOG,
        maxBytes=10 * 1024 * 1024,
        backupCount=5,
        encoding="utf-8",
    )
    fh.setFormatter(fmt)
    logger.addHandler(fh)

    sh = logging.StreamHandler(sys.stdout)
    sh.setFormatter(fmt)
    logger.addHandler(sh)

    return logger


log = setup_logging()


# ─── Discord notification (best-effort) ────────────────────────────────

def discord_notify(content: str) -> None:
    """Fire-and-forget Discord ping. Silent on failure."""
    if not DISCORD_WEBHOOK:
        return
    try:
        import urllib.request
        req = urllib.request.Request(
            DISCORD_WEBHOOK,
            data=(b'{"content":' + content.encode("utf-8")
                  .replace(b'"', b'\\"').join((b'"', b'"')) + b'}'),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        urllib.request.urlopen(req, timeout=5).close()
    except Exception as e:
        log.warning(f"discord_notify failed: {e}")


# ─── Worker subprocess management ──────────────────────────────────────

class WorkerSupervisor:
    def __init__(self) -> None:
        self.shutdown_requested = False
        self.process: subprocess.Popen[bytes] | None = None
        self.restart_count = 0
        self.backoff_seconds = BACKOFF_BASE_SECONDS

    def install_signal_handlers(self) -> None:
        """Forward SIGTERM/SIGINT to the worker, then exit cleanly."""
        def handler(signum: int, _frame: object) -> None:
            log.info(
                f"received signal {signum} — requesting graceful shutdown"
            )
            self.shutdown_requested = True
            self._terminate_worker()

        signal.signal(signal.SIGTERM, handler)
        signal.signal(signal.SIGINT, handler)
        # CTRL_BREAK on Windows is what taskkill sends ; SIGBREAK only
        # exists on Windows so we guard the import.
        if hasattr(signal, "SIGBREAK"):
            signal.signal(signal.SIGBREAK, handler)

    def _start_worker(self) -> None:
        """Spawn the worker subprocess with stdout/stderr → rotating log."""
        # Open the log file in append mode and pipe the worker's
        # stdout+stderr there. Rotation is handled by the logging handler
        # above (for the supervisor) ; the worker's own log uses
        # structlog and writes to whatever stdout points at.
        log_fh = open(LOG_FILE, "ab", buffering=0)
        env = os.environ.copy()
        # Ensure UTF-8 stdout — Python's default cp1252 on Windows
        # mangles structlog's box-drawing characters.
        env["PYTHONIOENCODING"] = "utf-8"

        # On Windows, spawn in a new process group so we can send
        # CTRL_BREAK_EVENT to the worker without killing the supervisor.
        creationflags = 0
        if sys.platform == "win32":
            creationflags = subprocess.CREATE_NEW_PROCESS_GROUP

        self.process = subprocess.Popen(
            [sys.executable, str(WORKER_SCRIPT)],
            cwd=str(WORKER_DIR),
            stdout=log_fh,
            stderr=subprocess.STDOUT,
            env=env,
            creationflags=creationflags,
        )
        log.info(
            f"worker started — PID {self.process.pid}"
            f" (restart #{self.restart_count})"
        )

    def _terminate_worker(self) -> None:
        """Send TERM/CTRL_BREAK to the worker if still alive."""
        if not self.process or self.process.poll() is not None:
            return
        log.info(f"terminating worker PID {self.process.pid}")
        try:
            if sys.platform == "win32":
                self.process.send_signal(signal.CTRL_BREAK_EVENT)
            else:
                self.process.terminate()
            # Give the worker 30s to clean up before we hard-kill
            self.process.wait(timeout=30)
        except subprocess.TimeoutExpired:
            log.warning("worker didn't exit in 30s — hard-killing")
            self.process.kill()
            self.process.wait(timeout=5)
        except Exception as e:
            log.warning(f"terminate_worker error: {e}")

    def run(self) -> int:
        """Main supervision loop. Returns process exit code."""
        log.info("=" * 60)
        log.info("KCKills worker SUPERVISOR starting")
        log.info(f"  worker script  : {WORKER_SCRIPT}")
        log.info(f"  worker log     : {LOG_FILE}")
        log.info(f"  supervisor log : {SUPERVISOR_LOG}")
        log.info(f"  discord ping   : {'enabled' if DISCORD_WEBHOOK else 'disabled'}")
        log.info("=" * 60)

        self.install_signal_handlers()

        while not self.shutdown_requested:
            started_at = time.time()
            try:
                self._start_worker()
            except Exception as e:
                log.error(f"failed to spawn worker: {e}")
                discord_notify(
                    f"⚠️ KCKills supervisor : failed to spawn worker — {e}"
                )
                time.sleep(self.backoff_seconds)
                self._increase_backoff()
                continue

            assert self.process is not None
            exit_code = self.process.wait()
            uptime = time.time() - started_at
            log.warning(
                f"worker exited — code={exit_code} uptime={uptime:.0f}s"
            )

            if self.shutdown_requested:
                log.info("shutdown requested — exiting supervisor loop")
                break

            # Reset backoff if the worker stayed alive long enough
            if uptime >= STABLE_RUNTIME_RESET_SECONDS:
                self.backoff_seconds = BACKOFF_BASE_SECONDS
                log.info(
                    f"stable runtime ≥ {STABLE_RUNTIME_RESET_SECONDS}s → "
                    f"backoff reset to {BACKOFF_BASE_SECONDS}s"
                )

            self.restart_count += 1
            log.info(
                f"restarting in {self.backoff_seconds}s "
                f"(restart count = {self.restart_count})"
            )
            discord_notify(
                f"🔄 KCKills worker restart #{self.restart_count} — "
                f"prev uptime {uptime:.0f}s, exit code {exit_code}, "
                f"sleeping {self.backoff_seconds}s"
            )

            # Sleep with shutdown polling so Ctrl+C is responsive.
            slept = 0
            while slept < self.backoff_seconds and not self.shutdown_requested:
                time.sleep(min(1, self.backoff_seconds - slept))
                slept += 1

            self._increase_backoff()

        log.info(f"supervisor exiting cleanly. total restarts : {self.restart_count}")
        return 0

    def _increase_backoff(self) -> None:
        """Double the backoff, capped."""
        self.backoff_seconds = min(self.backoff_seconds * 2, BACKOFF_MAX_SECONDS)


def main() -> int:
    sup = WorkerSupervisor()
    return sup.run()


if __name__ == "__main__":
    sys.exit(main())
