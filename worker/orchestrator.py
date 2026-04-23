"""
KCKILLS / LoLTok Worker — Process-split orchestrator.

Spawns 4 child processes, each running a subset of DAEMON_MODULES in
its own asyncio loop. The GIL no longer pins CPU-bound work (Pillow,
ffmpeg post-processing) against I/O work (Supabase, R2 uploads).

Cross-process coordination is via Supabase tables — modules are already
stateless w.r.t. each other, so no IPC primitives are needed.

Usage:
    python orchestrator.py                   # parent: spawns + monitors 4 children
    python orchestrator.py --role clipper    # child mode (used by parent)
    python orchestrator.py --role analyzer
    python orchestrator.py --role discovery
    python orchestrator.py --role control

Process layout:
    A — clipper    (CPU + GPU bound: clipper, hls_packager)
    B — analyzer   (network + Gemini: analyzer, qc_sampler, og_generator, event_publisher)
    C — discovery  (external APIs: sentinel, harvester, transitioner, channel_*, match_planner, event_mapper, vod_offset_finder)
    D — control    (admin + housekeeping: moderator, job_runner, heartbeat, watchdog)
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import signal
import subprocess
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import structlog

# ──────────────────────────────────────────────────────────────────────
# Logging
# ──────────────────────────────────────────────────────────────────────
structlog.configure(
    processors=[
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.add_log_level,
        structlog.dev.ConsoleRenderer(),
    ]
)
log = structlog.get_logger()


# ──────────────────────────────────────────────────────────────────────
# Role → modules mapping
# ──────────────────────────────────────────────────────────────────────
# Re-uses the (name, interval, dotted) tuples from main.DAEMON_MODULES
# so we keep a single source of truth for intervals.
ROLE_MODULES: dict[str, list[str]] = {
    "clipper":   ["clipper", "hls_packager"],
    "analyzer":  ["analyzer", "qc_sampler", "og_generator", "event_publisher"],
    "discovery": ["sentinel", "harvester", "transitioner", "channel_discoverer",
                  "channel_reconciler", "match_planner", "event_mapper",
                  "vod_offset_finder"],
    "control":   ["moderator", "job_runner", "kill_of_the_week",
                  "push_notifier", "heartbeat", "watchdog"],
}

ROLES = tuple(ROLE_MODULES.keys())

# Restart back-off bounds for crashed children
RESTART_BACKOFF_BASE = 1.0
RESTART_BACKOFF_MAX = 60.0

# Grace period before SIGKILL on shutdown
SHUTDOWN_GRACE_SECONDS = 10

# Restart inside a child task (matches main.py)
TASK_RESTART_DELAY = 10


# ──────────────────────────────────────────────────────────────────────
# Paths
# ──────────────────────────────────────────────────────────────────────
def _data_root() -> Path:
    """Worker data root — D:/kckills_worker if D:/ exists, else worker dir."""
    if os.path.isdir("D:/"):
        return Path("D:/kckills_worker")
    return Path(__file__).resolve().parent


DATA_ROOT = _data_root()
LOGS_DIR = DATA_ROOT / "logs"
DEFAULT_STATUS_FILE = DATA_ROOT / "orchestrator_status.json"
STATUS_FILE = Path(os.getenv("KCKILLS_ORCHESTRATOR_STATUS_FILE",
                             str(DEFAULT_STATUS_FILE)))


# ══════════════════════════════════════════════════════════════════════
# CHILD MODE — runs the modules for one role in a single asyncio loop
# ══════════════════════════════════════════════════════════════════════
async def supervised_task(name: str, interval: int, run_func):
    """
    Run a module in a loop with auto-restart on crash. Identical to
    main.supervised_task.
    """
    while True:
        try:
            start = time.monotonic()
            log.info("module_start", module=name)
            await run_func()
            elapsed = time.monotonic() - start
            log.info("module_done", module=name, elapsed_s=round(elapsed, 1))
        except Exception as e:
            log.error(
                "module_crash",
                module=name,
                error=str(e),
                traceback=traceback.format_exc()[:1500],
            )
            try:
                from services import discord_webhook
                await discord_webhook.notify_error(name, f"{type(e).__name__}: {e}")
            except Exception:
                pass
            await asyncio.sleep(TASK_RESTART_DELAY)
            continue

        await asyncio.sleep(interval)


def _module_specs_for_role(role: str) -> list[tuple[str, int, str]]:
    """Return (name, interval, dotted) tuples for the given role."""
    from main import DAEMON_MODULES

    wanted = set(ROLE_MODULES[role])
    specs = [m for m in DAEMON_MODULES if m[0] in wanted]
    found = {m[0] for m in specs}
    missing = wanted - found
    if missing:
        log.error("role_missing_modules", role=role, missing=sorted(missing))
    return specs


async def run_child(role: str) -> None:
    """Run one role's modules under supervision."""
    import importlib

    specs = _module_specs_for_role(role)
    log.info("child_start", role=role, modules=[s[0] for s in specs], pid=os.getpid())

    tasks: list[asyncio.Task] = []
    for name, interval, dotted in specs:
        try:
            mod = importlib.import_module(dotted)
        except Exception as e:
            log.error("module_import_failed", module=name, error=str(e))
            continue
        if not hasattr(mod, "run"):
            log.error("module_no_run", module=name)
            continue
        tasks.append(asyncio.create_task(
            supervised_task(name, interval, mod.run),
            name=f"{role}:{name}",
        ))

    # Daily report at 23:00 UTC — only the 'control' child owns it,
    # otherwise we'd send it 4 times.
    if role == "control":
        async def daily_report_loop():
            from modules import watchdog as wd
            while True:
                await asyncio.sleep(3600)
                now = datetime.now(timezone.utc)
                if now.hour == 23:
                    try:
                        await wd.send_daily_report()
                    except Exception as e:
                        log.warn("daily_report_failed", error=str(e))

        tasks.append(asyncio.create_task(daily_report_loop(),
                                         name="control:daily_report"))

    log.info("child_running", role=role, task_count=len(tasks))

    # Graceful shutdown on SIGTERM / SIGINT inside the child
    stop_event = asyncio.Event()

    def _request_stop(*_):
        log.info("child_stop_requested", role=role)
        stop_event.set()

    try:
        signal.signal(signal.SIGTERM, _request_stop)
    except (ValueError, AttributeError):
        pass
    try:
        signal.signal(signal.SIGINT, _request_stop)
    except (ValueError, AttributeError):
        pass

    gather_task = asyncio.gather(*tasks, return_exceptions=True)
    stop_task = asyncio.create_task(stop_event.wait())

    done, pending = await asyncio.wait(
        {gather_task, stop_task},
        return_when=asyncio.FIRST_COMPLETED,
    )

    if stop_task in done:
        log.info("child_shutting_down", role=role)
        for t in tasks:
            t.cancel()
        try:
            await asyncio.wait_for(asyncio.gather(*tasks, return_exceptions=True),
                                   timeout=8.0)
        except asyncio.TimeoutError:
            log.warn("child_shutdown_timeout", role=role)

    log.info("child_exit", role=role)


# ══════════════════════════════════════════════════════════════════════
# PARENT MODE — spawn + monitor 4 children
# ══════════════════════════════════════════════════════════════════════
class ChildProc:
    """One supervised child process slot."""

    __slots__ = ("role", "popen", "log_fh", "started_at", "restart_count",
                 "last_restart", "next_backoff", "next_allowed_start")

    def __init__(self, role: str):
        self.role: str = role
        self.popen: Optional[subprocess.Popen] = None
        self.log_fh = None
        self.started_at: Optional[float] = None
        self.restart_count: int = 0
        self.last_restart: Optional[float] = None
        self.next_backoff: float = RESTART_BACKOFF_BASE
        self.next_allowed_start: float = 0.0

    @property
    def pid(self) -> Optional[int]:
        return self.popen.pid if self.popen else None

    @property
    def alive(self) -> bool:
        return self.popen is not None and self.popen.poll() is None

    def open_log(self) -> None:
        LOGS_DIR.mkdir(parents=True, exist_ok=True)
        path = LOGS_DIR / f"{self.role}.log"
        self.log_fh = open(path, "a", buffering=1, encoding="utf-8", errors="replace")
        self.log_fh.write(
            f"\n--- orchestrator launch @ "
            f"{datetime.now(timezone.utc).isoformat()} (role={self.role}) ---\n"
        )

    def close_log(self) -> None:
        if self.log_fh:
            try:
                self.log_fh.flush()
                self.log_fh.close()
            except Exception:
                pass
            self.log_fh = None

    def spawn(self) -> None:
        """Spawn the child subprocess. Reuses sys.executable + this script."""
        if self.alive:
            return

        self.close_log()
        self.open_log()

        cmd = [sys.executable, os.path.abspath(__file__), "--role", self.role]

        creationflags = 0
        if sys.platform == "win32":
            creationflags = subprocess.CREATE_NEW_PROCESS_GROUP

        cwd = Path(__file__).resolve().parent

        self.popen = subprocess.Popen(
            cmd,
            stdout=self.log_fh,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            cwd=str(cwd),
            creationflags=creationflags,
            close_fds=False,
        )
        self.started_at = time.time()
        self.last_restart = time.time()

    def request_stop(self) -> None:
        """Politely ask the child to exit."""
        if not self.alive:
            return
        try:
            if sys.platform == "win32":
                self.popen.send_signal(signal.CTRL_BREAK_EVENT)
            else:
                self.popen.send_signal(signal.SIGTERM)
        except (OSError, ValueError) as e:
            log.warn("child_signal_failed", role=self.role, error=str(e))

    def kill(self) -> None:
        if not self.alive:
            return
        try:
            self.popen.kill()
        except OSError as e:
            log.warn("child_kill_failed", role=self.role, error=str(e))

    def reap(self) -> Optional[int]:
        if self.popen is None:
            return None
        rc = self.popen.poll()
        if rc is not None:
            self.close_log()
        return rc

    def schedule_restart(self) -> None:
        self.restart_count += 1
        self.next_allowed_start = time.monotonic() + self.next_backoff
        self.next_backoff = min(self.next_backoff * 2, RESTART_BACKOFF_MAX)

    def reset_backoff(self) -> None:
        self.next_backoff = RESTART_BACKOFF_BASE


def _write_status(children: dict[str, ChildProc], started_at: float) -> None:
    """Atomic-ish write of the status JSON."""
    payload = {
        "started_at": datetime.fromtimestamp(started_at, tz=timezone.utc).isoformat(),
        "parent_pid": os.getpid(),
        "status_file": str(STATUS_FILE),
        "logs_dir": str(LOGS_DIR),
        "roles": {
            role: {
                "pid": c.pid,
                "alive": c.alive,
                "started_at": (datetime.fromtimestamp(c.started_at, tz=timezone.utc).isoformat()
                               if c.started_at else None),
                "last_restart": (datetime.fromtimestamp(c.last_restart, tz=timezone.utc).isoformat()
                                 if c.last_restart else None),
                "restart_count": c.restart_count,
                "log_file": str(LOGS_DIR / f"{role}.log"),
                "modules": ROLE_MODULES[role],
            }
            for role, c in children.items()
        },
    }
    STATUS_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATUS_FILE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    os.replace(tmp, STATUS_FILE)


def _read_manager_command() -> Optional[dict]:
    """File-based command channel used by manager.py."""
    cmd_file = STATUS_FILE.with_name("orchestrator_command.json")
    if not cmd_file.exists():
        return None
    try:
        data = json.loads(cmd_file.read_text(encoding="utf-8"))
    except Exception as e:
        log.warn("bad_command_file", error=str(e))
        try:
            cmd_file.unlink()
        except OSError:
            pass
        return None
    try:
        cmd_file.unlink()
    except OSError:
        pass
    return data


def run_parent() -> int:
    """Spawn 4 children, monitor + restart, handle Ctrl+C."""
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    STATUS_FILE.parent.mkdir(parents=True, exist_ok=True)

    children: dict[str, ChildProc] = {role: ChildProc(role) for role in ROLES}
    started_at = time.time()

    for c in children.values():
        c.spawn()

    summary = ", ".join(f"{role}=PID{children[role].pid}" for role in ROLES)
    print(f"orchestrator: 4 children launched ({summary})")
    log.info("orchestrator_started",
             pids={r: children[r].pid for r in ROLES},
             status_file=str(STATUS_FILE),
             logs_dir=str(LOGS_DIR))

    _write_status(children, started_at)

    shutdown_requested = {"flag": False}

    def _on_sigint(signum, frame):
        if not shutdown_requested["flag"]:
            log.info("orchestrator_sigint_received")
            shutdown_requested["flag"] = True
        else:
            log.warn("orchestrator_force_exit")
            for c in children.values():
                c.kill()
            sys.exit(130)

    signal.signal(signal.SIGINT, _on_sigint)
    if hasattr(signal, "SIGBREAK"):
        signal.signal(signal.SIGBREAK, _on_sigint)

    try:
        last_status_write = time.monotonic()
        HEALTHY_UPTIME = 300

        while not shutdown_requested["flag"]:
            time.sleep(1)
            now = time.monotonic()
            wall = time.time()

            for role, c in children.items():
                if c.popen is None:
                    continue
                rc = c.reap()
                if rc is not None:
                    log.warn("child_exited", role=role, exit_code=rc,
                             restart_count=c.restart_count)
                    c.popen = None
                    c.schedule_restart()

            for role, c in children.items():
                if c.popen is None and now >= c.next_allowed_start:
                    log.info("child_respawning", role=role,
                             restart_count=c.restart_count,
                             backoff_used_s=round(c.next_backoff / 2, 2))
                    c.spawn()

            for c in children.values():
                if c.alive and c.started_at and (wall - c.started_at) > HEALTHY_UPTIME:
                    c.reset_backoff()

            cmd = _read_manager_command()
            if cmd:
                action = (cmd.get("action") or "").lower()
                role = cmd.get("role")
                if action == "stop":
                    log.info("manager_stop_received")
                    shutdown_requested["flag"] = True
                elif action == "restart" and role in children:
                    log.info("manager_restart_received", role=role)
                    children[role].request_stop()
                    children[role].next_allowed_start = now
                elif action == "restart" and role == "all":
                    log.info("manager_restart_all_received")
                    for c in children.values():
                        c.request_stop()
                        c.next_allowed_start = now
                else:
                    log.warn("manager_command_unknown", cmd=cmd)

            if now - last_status_write > 5:
                _write_status(children, started_at)
                last_status_write = now

    except Exception as e:
        log.error("orchestrator_loop_crash", error=str(e),
                  traceback=traceback.format_exc()[:1500])
        shutdown_requested["flag"] = True

    log.info("orchestrator_stopping_children")
    for c in children.values():
        c.request_stop()

    deadline = time.monotonic() + SHUTDOWN_GRACE_SECONDS
    while time.monotonic() < deadline:
        if all(not c.alive for c in children.values()):
            break
        time.sleep(0.2)

    survivors = [r for r, c in children.items() if c.alive]
    if survivors:
        log.warn("orchestrator_force_killing", roles=survivors)
        for r in survivors:
            children[r].kill()
        time.sleep(1)

    for c in children.values():
        c.reap()
        c.close_log()

    _write_status(children, started_at)

    try:
        STATUS_FILE.unlink()
    except OSError:
        pass

    log.info("orchestrator_exit")
    return 0


# ══════════════════════════════════════════════════════════════════════
# Entry point
# ══════════════════════════════════════════════════════════════════════
def _parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="orchestrator",
        description="KCKILLS worker orchestrator (parent or child).",
    )
    p.add_argument(
        "--role",
        choices=list(ROLES),
        default=None,
        help="Run as a child for the given role. Omit to run as parent.",
    )
    return p.parse_args(argv)


def main() -> None:
    args = _parse_args(sys.argv[1:])

    if args.role is None:
        rc = run_parent()
        sys.exit(rc)

    print("=" * 60)
    print(f"  KCKILLS / LoLTok Worker — child role: {args.role}")
    print("=" * 60)
    try:
        asyncio.run(run_child(args.role))
    except KeyboardInterrupt:
        log.info("child_keyboard_interrupt", role=args.role)


if __name__ == "__main__":
    main()
