"""
monitor_loop.py — Lightweight pipeline health monitor.

Polls Supabase every 3 minutes for ~80 cycles (4 hours total) and
emits ONE structured line per cycle on stdout. Designed to be
piped into Claude's Monitor tool — each line becomes a notification,
which is selective by design (no per-row spam).

Output format (one TSV line per cycle) :
    YYYY-MM-DDTHH:MM:SSZ  pub=NNN  raw=NNN  err=NNN  hb=Xm  delta_pub=+N  alert=...

Where :
  pub        kills.status='published' (visible site)
  raw        kills.status='raw'       (untouched)
  err        kills.status='clip_error' (clipping failed)
  hb         minutes since worker_heartbeat last updated
  delta_pub  change vs previous cycle
  alert      human-readable issue if something looks off (worker stuck,
             clip_error growing, etc). Empty when fine.

Exits cleanly after MAX_CYCLES iterations or on KeyboardInterrupt.
"""

from __future__ import annotations

import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx
from dotenv import load_dotenv

_WORKER_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_WORKER_ROOT / ".env")

SUPA_URL = os.getenv("SUPABASE_URL", "").rstrip("/") + "/rest/v1"
SUPA_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
H = {"apikey": SUPA_KEY, "Authorization": f"Bearer {SUPA_KEY}"}

POLL_INTERVAL_SECONDS = 180   # 3 minutes
MAX_CYCLES = 80               # 80 × 3 min = 240 min = 4 hours

# Alerts thresholds
HB_STALE_MINUTES = 15         # worker heartbeat stale beyond this = ALERT
CLIP_ERROR_GROWTH_ALERT = 50  # clip_errors growing by >50 between cycles


def _count(filter_q: str) -> int:
    """Return exact row count for a kills filter."""
    try:
        r = httpx.head(
            f"{SUPA_URL}/kills",
            headers={**H, "Prefer": "count=exact"},
            params={"select": "id", **{k: v for k, v in [filter_q.split("=", 1)]}} if filter_q else {"select": "id"},
            timeout=20.0,
        )
        cr = r.headers.get("content-range", "")
        if "/" in cr:
            return int(cr.split("/")[-1])
    except Exception:
        return -1
    return -1


def _count_simple(table: str, **filters) -> int:
    """Generic counter — pass eq filters as kwargs."""
    try:
        params = {"select": "id"}
        for k, v in filters.items():
            params[k] = v
        r = httpx.head(
            f"{SUPA_URL}/{table}",
            headers={**H, "Prefer": "count=exact"},
            params=params,
            timeout=20.0,
        )
        cr = r.headers.get("content-range", "")
        if "/" in cr:
            return int(cr.split("/")[-1])
    except Exception as e:
        return -1
    return -1


def _heartbeat_age_minutes() -> float:
    """How long ago did the worker last ping health_checks?"""
    try:
        r = httpx.get(
            f"{SUPA_URL}/health_checks",
            headers=H,
            params={"select": "last_seen", "id": "eq.worker_heartbeat"},
            timeout=10.0,
        )
        rows = r.json() or []
        if not rows:
            return -1.0
        ts = rows[0].get("last_seen")
        if not ts:
            return -1.0
        # Parse "2026-04-23T10:33:21.773266+00:00"
        last = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        age = (datetime.now(timezone.utc) - last).total_seconds() / 60.0
        return age
    except Exception:
        return -1.0


def main() -> None:
    if not SUPA_URL or not SUPA_KEY:
        print("ERROR: SUPABASE_URL / SUPABASE_SERVICE_KEY not set", flush=True)
        sys.exit(1)

    prev_pub = -1
    prev_err = -1

    for cycle in range(MAX_CYCLES):
        now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

        # Snapshot
        pub = _count_simple("kills", status="eq.published")
        raw = _count_simple("kills", status="eq.raw")
        err = _count_simple("kills", status="eq.clip_error")
        ana = _count_simple("kills", status="eq.analyzed")
        hb_age = _heartbeat_age_minutes()

        # Alert reasoning
        alerts = []
        if hb_age < 0:
            alerts.append("hb_unreachable")
        elif hb_age > HB_STALE_MINUTES:
            alerts.append(f"hb_stale_{int(hb_age)}m")

        if prev_err >= 0 and err - prev_err > CLIP_ERROR_GROWTH_ALERT:
            alerts.append(f"err_jumped_+{err - prev_err}")

        delta_pub = (pub - prev_pub) if prev_pub >= 0 else 0
        delta_err = (err - prev_err) if prev_err >= 0 else 0

        line = (
            f"{now}\tpub={pub}\traw={raw}\tana={ana}\terr={err}"
            f"\thb={hb_age:.1f}m\tdpub={delta_pub:+d}\tderr={delta_err:+d}"
            f"\tcycle={cycle + 1}/{MAX_CYCLES}"
        )
        if alerts:
            line += f"\tALERT={','.join(alerts)}"
        print(line, flush=True)

        prev_pub = pub
        prev_err = err

        # Don't sleep after the last cycle.
        if cycle + 1 < MAX_CYCLES:
            time.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[monitor stopped by user]", flush=True)
        sys.exit(0)
