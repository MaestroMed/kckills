"""
auto_fix_loop.py — Periodic pipeline unblocker (4h supervised run).

Runs in tandem with monitor_loop.py during long-running operations.
Every 5 minutes it :

  1. Runs fix_qc_described_threshold logic — bumps qc_described=true
     for any newly-analyzed event whose linked kill has a description
     >= 30 chars but is stuck at qc_described=false (the seed query
     legacy from migration 014).

  2. Runs force_publish_stuck logic — flips kills.status='analyzed'
     to 'published' for any event that's now is_publishable=true but
     missed the publisher cycle (because the BEFORE UPDATE trigger
     stamped published_at faster than the publisher's "needs publish"
     query could pick it up).

  3. Logs net deltas to stdout (one line per cycle, for piping into
     Claude's Monitor tool).

Exits cleanly after MAX_CYCLES iterations or KeyboardInterrupt.

Usage :
    python scripts/auto_fix_loop.py
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
sys.path.insert(0, str(_WORKER_ROOT))
load_dotenv(_WORKER_ROOT / ".env")

from services.supabase_client import get_db  # noqa: E402

POLL_INTERVAL_SECONDS = 300       # 5 minutes
MAX_CYCLES = 48                    # 48 × 5 min = 4 hours
MIN_DESCRIPTION_LENGTH = 30


def _fix_qc_described() -> int:
    """Bump qc_described=true on events linked to kills with valid
    descriptions. Returns count fixed."""
    db = get_db()
    if db is None:
        return 0

    fixed = 0
    page = 0
    page_size = 500
    while True:
        offset = page * page_size
        try:
            r = httpx.get(
                f"{db.base}/game_events",
                headers=db.headers,
                params={
                    "select": "id,kill_id",
                    "qc_described": "eq.false",
                    "kill_id": "not.is.null",
                    "limit": str(page_size),
                    "offset": str(offset),
                },
                timeout=30.0,
            )
            r.raise_for_status()
            events = r.json() or []
        except Exception:
            break
        if not events:
            break

        kill_ids = [e["kill_id"] for e in events if e.get("kill_id")]
        if not kill_ids:
            break

        # Lookup descriptions
        kill_descs: dict[str, str] = {}
        for i in range(0, len(kill_ids), 50):
            chunk = kill_ids[i:i + 50]
            try:
                r2 = httpx.get(
                    f"{db.base}/kills",
                    headers=db.headers,
                    params={
                        "select": "id,ai_description",
                        "id": f"in.({','.join(chunk)})",
                        "limit": "100",
                    },
                    timeout=30.0,
                )
                r2.raise_for_status()
                for k in r2.json() or []:
                    kill_descs[k["id"]] = k.get("ai_description") or ""
            except Exception:
                continue

        to_fix: list[str] = []
        for ev in events:
            kid = ev.get("kill_id")
            if not kid:
                continue
            desc = kill_descs.get(kid, "")
            if len(desc.strip()) >= MIN_DESCRIPTION_LENGTH:
                to_fix.append(ev["id"])

        for i in range(0, len(to_fix), 50):
            chunk = to_fix[i:i + 50]
            try:
                r3 = httpx.patch(
                    f"{db.base}/game_events",
                    headers={**db.headers, "Prefer": "return=minimal"},
                    params={"id": f"in.({','.join(chunk)})"},
                    json={"qc_described": True},
                    timeout=30.0,
                )
                if r3.status_code in (200, 204):
                    fixed += len(chunk)
            except Exception:
                pass

        if len(events) < page_size:
            break
        page += 1
        if page > 30:  # cap at 15k events to bound runtime
            break

    return fixed


def _force_publish_stuck() -> int:
    """Flip kills.status='analyzed' → 'published' for every publishable
    event with a stuck kill. Returns count flipped."""
    db = get_db()
    if db is None:
        return 0

    seen_kill_ids: set[str] = set()
    page = 0
    page_size = 500
    while True:
        offset = page * page_size
        try:
            r = httpx.get(
                f"{db.base}/game_events",
                headers=db.headers,
                params={
                    "select": "kill_id",
                    "is_publishable": "eq.true",
                    "kill_id": "not.is.null",
                    "limit": str(page_size),
                    "offset": str(offset),
                },
                timeout=30.0,
            )
            r.raise_for_status()
            events = r.json() or []
        except Exception:
            break
        if not events:
            break
        for e in events:
            kid = e.get("kill_id")
            if kid:
                seen_kill_ids.add(kid)
        if len(events) < page_size:
            break
        page += 1
        if page > 30:
            break

    if not seen_kill_ids:
        return 0

    flipped = 0
    ids = list(seen_kill_ids)
    for i in range(0, len(ids), 100):
        chunk = ids[i:i + 100]
        try:
            r2 = httpx.get(
                f"{db.base}/kills",
                headers=db.headers,
                params={"select": "id,status", "id": f"in.({','.join(chunk)})"},
                timeout=30.0,
            )
            r2.raise_for_status()
            rows = r2.json() or []
        except Exception:
            continue

        analyzed_ids = [k["id"] for k in rows if k["status"] == "analyzed"]
        if not analyzed_ids:
            continue
        try:
            r3 = httpx.patch(
                f"{db.base}/kills",
                headers={**db.headers, "Prefer": "return=minimal"},
                params={"id": f"in.({','.join(analyzed_ids)})"},
                json={"status": "published"},
                timeout=30.0,
            )
            if r3.status_code in (200, 204):
                flipped += len(analyzed_ids)
        except Exception:
            pass

    return flipped


def main() -> None:
    print(f"[autofix] starting — {MAX_CYCLES} cycles × {POLL_INTERVAL_SECONDS}s", flush=True)

    for cycle in range(MAX_CYCLES):
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        try:
            qc_fixed = _fix_qc_described()
        except Exception as e:
            qc_fixed = -1
            print(f"{ts}\tautofix\tcycle={cycle + 1}/{MAX_CYCLES}\tqc_error={str(e)[:80]}", flush=True)
        try:
            published = _force_publish_stuck()
        except Exception as e:
            published = -1
            print(f"{ts}\tautofix\tcycle={cycle + 1}/{MAX_CYCLES}\tpublish_error={str(e)[:80]}", flush=True)

        # Only emit a notification line when something actually moved
        # OR every 6 cycles (30min) for a heartbeat.
        if qc_fixed > 0 or published > 0 or cycle % 6 == 0:
            print(
                f"{ts}\tautofix\tcycle={cycle + 1}/{MAX_CYCLES}"
                f"\tqc_described+={qc_fixed}\tpublished+={published}",
                flush=True,
            )

        if cycle + 1 < MAX_CYCLES:
            time.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("[autofix stopped by user]", flush=True)
        sys.exit(0)
