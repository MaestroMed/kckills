"""
KCKILLS / LoLTok Worker — Tiny CLI to inspect and signal the orchestrator.

Reads the status JSON written by orchestrator.py and writes a small
command file the orchestrator picks up on its 1Hz loop.

Usage:
    python manager.py status
    python manager.py restart <role>      # role = clipper | analyzer | discovery | control | all
    python manager.py stop
    python manager.py logs <role>         # tail last 40 lines of a child log
"""

from __future__ import annotations

import json
import os
import signal
import sys
from datetime import datetime, timezone
from pathlib import Path

# PR-loltok DH : path resolution flows through services.local_paths so
# `manager.py status` works on Mehdi's Windows box (D:/), inside a
# Docker container (/cache/...), and on a fresh Linux dev VM
# (/var/cache/kckills). Same env-var menu used by config.py.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from services.local_paths import LocalPaths  # noqa: E402

DATA_ROOT = Path(LocalPaths.data_root())
STATUS_FILE = Path(LocalPaths.status_file())
COMMAND_FILE = STATUS_FILE.with_name("orchestrator_command.json")

VALID_ROLES = ("clipper", "analyzer", "discovery", "control", "all")


def _load_status() -> dict | None:
    if not STATUS_FILE.exists():
        return None
    try:
        return json.loads(STATUS_FILE.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"manager: cannot parse status file ({e})", file=sys.stderr)
        return None


def _send_command(payload: dict) -> None:
    COMMAND_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = COMMAND_FILE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload), encoding="utf-8")
    os.replace(tmp, COMMAND_FILE)


def cmd_status() -> int:
    st = _load_status()
    if not st:
        print("manager: orchestrator not running (no status file)")
        return 1

    started = st.get("started_at", "?")
    parent_pid = st.get("parent_pid", "?")
    print(f"orchestrator parent PID  : {parent_pid}")
    print(f"started at               : {started}")
    print(f"status file              : {st.get('status_file')}")
    print(f"logs dir                 : {st.get('logs_dir')}")
    print()
    print(f"{'role':<10} {'pid':>7} {'alive':>6} {'restarts':>9}  modules")
    print("-" * 78)
    for role, info in st.get("roles", {}).items():
        pid = info.get("pid") or "-"
        alive = "yes" if info.get("alive") else "no"
        rc = info.get("restart_count", 0)
        mods = ", ".join(info.get("modules", []))
        print(f"{role:<10} {str(pid):>7} {alive:>6} {rc:>9}  {mods}")
    return 0


def cmd_restart(role: str) -> int:
    if role not in VALID_ROLES:
        print(f"manager: unknown role '{role}'. Valid: {', '.join(VALID_ROLES)}",
              file=sys.stderr)
        return 2
    st = _load_status()
    if not st:
        print("manager: orchestrator not running", file=sys.stderr)
        return 1
    _send_command({"action": "restart", "role": role,
                   "issued_at": datetime.now(timezone.utc).isoformat()})
    print(f"manager: restart requested for '{role}' "
          f"(orchestrator polls every 1s)")
    return 0


def cmd_stop() -> int:
    st = _load_status()
    if not st:
        print("manager: orchestrator not running", file=sys.stderr)
        return 1
    _send_command({"action": "stop",
                   "issued_at": datetime.now(timezone.utc).isoformat()})
    print("manager: stop requested. Orchestrator will signal children "
          f"and exit within ~{15}s.")

    parent_pid = st.get("parent_pid")
    if parent_pid:
        try:
            if sys.platform == "win32":
                pass  # file-based command channel is the reliable path
            else:
                os.kill(int(parent_pid), signal.SIGINT)
        except (ProcessLookupError, PermissionError, OSError) as e:
            print(f"manager: could not signal parent PID {parent_pid}: {e}",
                  file=sys.stderr)
    return 0


def cmd_logs(role: str, lines: int = 40) -> int:
    if role not in VALID_ROLES or role == "all":
        print(f"manager: 'logs' needs a single role "
              f"(clipper|analyzer|discovery|control)", file=sys.stderr)
        return 2
    st = _load_status()
    log_dir = Path(st["logs_dir"]) if st and "logs_dir" in st else (DATA_ROOT / "logs")
    log_path = log_dir / f"{role}.log"
    if not log_path.exists():
        print(f"manager: no log at {log_path}", file=sys.stderr)
        return 1
    try:
        with open(log_path, "rb") as f:
            f.seek(0, os.SEEK_END)
            size = f.tell()
            block = min(64 * 1024, size)
            f.seek(size - block, os.SEEK_SET)
            tail = f.read().decode("utf-8", errors="replace").splitlines()[-lines:]
        print("\n".join(tail))
    except Exception as e:
        print(f"manager: could not read log: {e}", file=sys.stderr)
        return 1
    return 0


def main() -> None:
    argv = sys.argv[1:]
    if not argv:
        print(__doc__)
        sys.exit(0)

    cmd = argv[0].lower()
    if cmd == "status":
        sys.exit(cmd_status())
    if cmd == "restart":
        if len(argv) < 2:
            print("usage: manager.py restart <role>", file=sys.stderr)
            sys.exit(2)
        sys.exit(cmd_restart(argv[1].lower()))
    if cmd == "stop":
        sys.exit(cmd_stop())
    if cmd == "logs":
        if len(argv) < 2:
            print("usage: manager.py logs <role> [lines]", file=sys.stderr)
            sys.exit(2)
        n = int(argv[2]) if len(argv) >= 3 and argv[2].isdigit() else 40
        sys.exit(cmd_logs(argv[1].lower(), n))

    print(f"manager: unknown command '{cmd}'", file=sys.stderr)
    print(__doc__)
    sys.exit(2)


if __name__ == "__main__":
    main()
