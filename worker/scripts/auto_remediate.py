"""
auto_remediate.py — Wave 35 #7 (2026-05-28)

Autonomous watch + remediate loop for the kckills.com worker.

Triggered every 5 min by a Monitor / cron. Each cycle :
  1. Reads daemon-wave35.log for the past 5 minutes
  2. Polls Supabase for pipeline health
  3. Emits ONE line summarising state (cache-friendly notification)
  4. If a condition fires, AUTO-REMEDIATES :
        ─ yt-dlp 429 storm (>=10 in 5 min)
            → release stale claims + log warning
            → if persists 3 cycles, edit .env to halve PARALLEL_CLIPPER
              and write a .auto_remediate_restart marker (operator
              picks it up to restart, OR if --auto-restart, we do it)
        ─ Gemini daily cost > $15
            → call fn_worker_quota_get to confirm
            → flip KCKILLS_GEMINI_TIER from premium → free in .env
              (writes a marker for restart)
        ─ Kills stuck in 'clipping' >30 min
            → call fn_release_stale_pipeline_locks RPC
            → flips abandoned `clipped` lease holds back to pending
        ─ Pipeline_jobs queue grows monotonically 5 cycles
            → log warning (operator action needed)

Design rules :
  * NEVER killed by Supabase / log issues — wrap everything in try/except
  * Idempotent — safe to run as often as cron likes
  * Single line stdout per cycle = clean notification stream when
    consumed via the Monitor tool
  * Emit `[OK] ...` when nothing to do (so silence really means
    "the script crashed", not "all healthy")
  * `--once` runs one cycle and exits (use from cron)
  * Without `--once`, loops every 300s (use from Monitor)

Outputs go to stdout. Persistent state lives in
worker/.auto_remediate_state.json so cycle N can compare against
cycle N-1 (used for streaks like "429 for 3 cycles in a row").
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import httpx
from dotenv import load_dotenv

_THIS = Path(__file__).resolve().parent
_WORKER = _THIS.parent
sys.path.insert(0, str(_WORKER))
load_dotenv(_WORKER / ".env")

SB_URL = os.environ.get("SUPABASE_URL")
SB_KEY = os.environ.get("SUPABASE_SERVICE_KEY")
HEADERS = {
    "apikey": SB_KEY or "",
    "Authorization": f"Bearer {SB_KEY or ''}",
    "Content-Type": "application/json",
}

LOG_FILE = _WORKER / "daemon-wave35.log"
STATE_FILE = _WORKER / ".auto_remediate_state.json"
RESTART_MARKER = _WORKER / ".auto_remediate_restart"

# ─── Thresholds ───────────────────────────────────────────────────────
GEMINI_COST_SOFT_CAP_USD = 15.0          # of the $20 cap, warn at 75%
THROTTLE_429_PER_CYCLE = 10              # 429 events in last 5min → suspect
THROTTLE_STREAK_CYCLES = 3               # consecutive cycles before action
STUCK_CLIPPING_MINUTES = 30              # kills.status='clipping' age
QUEUE_GROWTH_STREAK_CYCLES = 5           # monotonic growth → ops note


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _quota_date_today() -> str:
    """Same logic as the worker : 07:00 UTC reset window."""
    now = _utc_now()
    if now.hour >= 7:
        return now.date().isoformat()
    return (now.date() - timedelta(days=1)).isoformat()


# ─── Persistent state ──────────────────────────────────────────────────
def load_state() -> dict:
    try:
        if STATE_FILE.exists():
            return json.loads(STATE_FILE.read_text("utf-8"))
    except Exception:
        pass
    return {}


def save_state(state: dict) -> None:
    try:
        STATE_FILE.write_text(json.dumps(state, indent=2), "utf-8")
    except Exception as e:
        print(f"[WARN] state save failed: {e}", file=sys.stderr)


# ─── Log scanning ─────────────────────────────────────────────────────
_LOG_PATTERN_429 = re.compile(r"\b(429|HTTP Error 429|too[\s_-]?many[\s_-]?requests|rate[\s_-]?limit)\b", re.IGNORECASE)
_LOG_PATTERN_ERROR = re.compile(r"\bpipeline_run_failed\b", re.IGNORECASE)


def scan_log_recent(minutes: int = 5) -> dict:
    """Tail-scan the daemon log for events within the past N minutes."""
    out = {"throttle_429": 0, "errors": 0, "last_ts": None}
    if not LOG_FILE.exists():
        return out
    cutoff = _utc_now() - timedelta(minutes=minutes)
    cutoff_iso = cutoff.isoformat()
    try:
        # Read last ~10K lines worth to stay bounded
        with LOG_FILE.open("r", encoding="utf-8", errors="ignore") as f:
            try:
                f.seek(0, 2)
                size = f.tell()
                f.seek(max(0, size - 1_500_000))  # last ~1.5 MB
            except Exception:
                pass
            for line in f:
                # Lines start with ISO timestamp like
                # "2026-05-28T03:23:16.350896Z [info ..."
                if len(line) < 20 or line[4] != "-":
                    continue
                ts_str = line[:19]
                if ts_str < cutoff_iso[:19]:
                    continue
                out["last_ts"] = ts_str
                if _LOG_PATTERN_429.search(line):
                    out["throttle_429"] += 1
                if _LOG_PATTERN_ERROR.search(line):
                    out["errors"] += 1
    except Exception as e:
        print(f"[WARN] log scan failed: {e}", file=sys.stderr)
    return out


# ─── Supabase queries ─────────────────────────────────────────────────
def _head_count(table: str, params: dict) -> int:
    try:
        r = httpx.head(
            f"{SB_URL}/rest/v1/{table}",
            params={**params, "select": "id", "limit": "1"},
            headers={**HEADERS, "Prefer": "count=planned", "Range": "0-0"},
            timeout=10,
        )
        cr = r.headers.get("content-range", "")
        if "/" in cr:
            tail = cr.split("/")[-1]
            if tail and tail != "*":
                return int(tail)
    except Exception:
        pass
    return -1


def gemini_cost_today() -> tuple[int, float]:
    """Returns (call_count, cost_usd) for today's quota window."""
    try:
        r = httpx.post(
            f"{SB_URL}/rest/v1/rpc/fn_worker_quota_get",
            json={"p_service": "gemini", "p_quota_date": _quota_date_today()},
            headers=HEADERS,
            timeout=10,
        )
        if r.status_code == 200:
            data = r.json()
            if isinstance(data, list) and data:
                row = data[0]
                return int(row.get("call_count", 0) or 0), float(row.get("cost_usd", 0) or 0)
            if isinstance(data, dict):
                return int(data.get("call_count", 0) or 0), float(data.get("cost_usd", 0) or 0)
    except Exception:
        pass
    return 0, 0.0


def stuck_clipping_count() -> int:
    """Kills in status='clipping' whose updated_at is older than threshold."""
    cutoff = (_utc_now() - timedelta(minutes=STUCK_CLIPPING_MINUTES)).isoformat()
    return max(0, _head_count("kills", {
        "status": "eq.clipping",
        "updated_at": f"lt.{cutoff}",
    }))


def pipeline_jobs_pending() -> int:
    return max(0, _head_count("pipeline_jobs", {"status": "eq.pending"}))


def kills_raw_count() -> int:
    return max(0, _head_count("kills", {"status": "eq.raw"}))


def kills_published_count() -> int:
    return max(0, _head_count("kills", {"status": "eq.published"}))


# ─── Remediations ──────────────────────────────────────────────────────
def release_stale_locks() -> int:
    """Call fn_release_stale_pipeline_locks. Returns rows released."""
    try:
        r = httpx.post(
            f"{SB_URL}/rest/v1/rpc/fn_release_stale_pipeline_locks",
            json={"p_max_age_minutes": 5},
            headers=HEADERS,
            timeout=15,
        )
        if r.status_code == 200:
            out = r.json()
            if isinstance(out, int):
                return out
            if isinstance(out, list) and out:
                first = out[0]
                if isinstance(first, dict):
                    for v in first.values():
                        try:
                            return int(v)
                        except (TypeError, ValueError):
                            continue
        return 0
    except Exception:
        return 0


def edit_env_int(key: str, new_value: int) -> bool:
    """Set or replace KEY=value in worker/.env. Returns True on change."""
    env = _WORKER / ".env"
    try:
        text = env.read_text("utf-8")
        pat = re.compile(rf"^{re.escape(key)}=.*$", re.MULTILINE)
        if pat.search(text):
            new_text = pat.sub(f"{key}={new_value}", text)
        else:
            new_text = text.rstrip() + f"\n{key}={new_value}\n"
        if new_text != text:
            env.write_text(new_text, "utf-8")
            return True
    except Exception as e:
        print(f"[WARN] env edit failed: {e}", file=sys.stderr)
    return False


def write_restart_marker(reason: str) -> None:
    """Drop a marker file the operator (or --auto-restart) sees."""
    try:
        RESTART_MARKER.write_text(
            f"{_utc_now().isoformat()} | {reason}\n",
            "utf-8",
        )
    except Exception:
        pass


# ─── Main cycle ────────────────────────────────────────────────────────
def cycle(auto_restart: bool = False) -> None:
    state = load_state()

    log_summary = scan_log_recent(minutes=5)
    gem_calls, gem_cost = gemini_cost_today()
    stuck = stuck_clipping_count()
    pending = pipeline_jobs_pending()
    raws = kills_raw_count()
    pub = kills_published_count()

    actions: list[str] = []

    # ─── A) Gemini cost soft-cap ───────────────────────────────────────
    if gem_cost >= GEMINI_COST_SOFT_CAP_USD:
        # Hot-swap premium → free in env + write restart marker.
        # The runtime cap at $20 will still hard-stop us if we hit it,
        # but we'd rather degrade quality than tilt the budget.
        if os.environ.get("KCKILLS_GEMINI_TIER") != "free":
            changed = edit_env_int("KCKILLS_GEMINI_TIER", "free")  # str works too
            if changed:
                write_restart_marker(f"gemini cost {gem_cost:.2f} >= soft cap")
                actions.append(f"REMEDIATE gemini → tier=free (cost={gem_cost:.2f})")
            else:
                actions.append("gemini already at free tier")

    # ─── B) yt-dlp 429 streak ──────────────────────────────────────────
    streak_429 = int(state.get("streak_429", 0))
    if log_summary["throttle_429"] >= THROTTLE_429_PER_CYCLE:
        streak_429 += 1
        actions.append(f"429 storm count={log_summary['throttle_429']} streak={streak_429}")
        if streak_429 >= THROTTLE_STREAK_CYCLES:
            # Halve clipper parallelism
            current = int(os.environ.get("KCKILLS_PARALLEL_CLIPPER", "12") or "12")
            new_val = max(2, current // 2)
            if new_val < current:
                edit_env_int("KCKILLS_PARALLEL_CLIPPER", new_val)
                write_restart_marker(f"429 streak — clipper parallel {current}→{new_val}")
                actions.append(f"REMEDIATE clipper parallel {current}→{new_val}")
                streak_429 = 0
    else:
        if streak_429 > 0:
            actions.append(f"429 streak cleared (was {streak_429})")
        streak_429 = 0
    state["streak_429"] = streak_429

    # ─── C) Stuck clipping → release stale locks ───────────────────────
    if stuck > 0:
        released = release_stale_locks()
        actions.append(f"REMEDIATE released {released} stale locks (stuck={stuck})")

    # ─── D) Queue growth monitor (warn only) ───────────────────────────
    last_pending = int(state.get("last_pending_pipeline_jobs", -1))
    growth_streak = int(state.get("queue_growth_streak", 0))
    if last_pending >= 0 and pending > last_pending:
        growth_streak += 1
    else:
        growth_streak = 0
    if growth_streak >= QUEUE_GROWTH_STREAK_CYCLES:
        actions.append(f"WARN pipeline_jobs.pending growing {growth_streak} cycles ({pending} now)")
    state["last_pending_pipeline_jobs"] = pending
    state["queue_growth_streak"] = growth_streak

    # ─── Auto restart trigger ──────────────────────────────────────────
    if auto_restart and RESTART_MARKER.exists():
        try:
            # Best-effort restart : kill worker by PID file, relaunch.
            pid_file = _WORKER / "daemon-wave35.pid"
            if pid_file.exists():
                pid = int(pid_file.read_text("utf-8").strip())
                subprocess.run(
                    ["taskkill", "/F", "/PID", str(pid)],
                    capture_output=True, timeout=10,
                )
                time.sleep(2)
            log_path = _WORKER / "daemon-wave35.log"
            err_path = _WORKER / "daemon-wave35.err"
            new_proc = subprocess.Popen(
                [str(_WORKER / ".venv/Scripts/python.exe"), "-u", "main.py"],
                cwd=str(_WORKER),
                stdout=open(log_path, "a", encoding="utf-8"),
                stderr=open(err_path, "a", encoding="utf-8"),
                creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0),
            )
            pid_file.write_text(str(new_proc.pid), "utf-8")
            RESTART_MARKER.unlink(missing_ok=True)
            actions.append(f"AUTO-RESTART worker → PID={new_proc.pid}")
        except Exception as e:
            actions.append(f"AUTO-RESTART FAILED: {e}")

    save_state(state)

    # ─── Single-line summary (one event per cycle) ─────────────────────
    if actions:
        tag = "REMEDIATE"
    else:
        tag = "OK"
    line = (
        f"[{tag}] {_utc_now().isoformat()[:19]}Z "
        f"raw={raws} pending={pending} published={pub} "
        f"gem=${gem_cost:.3f}/{gem_calls}calls "
        f"stuck_clip={stuck} 429={log_summary['throttle_429']}"
    )
    if actions:
        line += " :: " + " ; ".join(actions)
    print(line, flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--once", action="store_true",
                        help="Run one cycle and exit (for cron)")
    parser.add_argument("--auto-restart", action="store_true",
                        help="When a restart marker is dropped, kill+relaunch the worker")
    parser.add_argument("--interval", type=int, default=300,
                        help="Seconds between cycles (default 300, only used when --once is OFF)")
    args = parser.parse_args()

    if not SB_URL or not SB_KEY:
        print("[ERROR] SUPABASE_URL or SUPABASE_SERVICE_KEY missing", file=sys.stderr)
        return 2

    if args.once:
        try:
            cycle(auto_restart=args.auto_restart)
        except Exception as e:
            print(f"[ERROR] cycle crashed: {e}", file=sys.stderr)
            return 1
        return 0

    while True:
        try:
            cycle(auto_restart=args.auto_restart)
        except Exception as e:
            print(f"[ERROR] cycle crashed: {e}", file=sys.stderr)
        time.sleep(args.interval)


if __name__ == "__main__":
    sys.exit(main())
