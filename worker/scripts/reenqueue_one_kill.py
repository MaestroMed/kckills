"""
reenqueue_one_kill.py — Single-kill version of backfill_clip_errors.

Built for the operator path : the admin UI surfaces a stuck clip_error
kill, the operator clicks "retry", and that calls this script with the
kill's UUID. Verbose by design — prints the existing kill row, the new
pipeline_jobs row, and the post-reset kill row so the operator has a
clear audit trail.

Unlike backfill_clip_errors.py, this script :
  * Does NOT enforce retry_count<3. Operator override is the whole point.
  * Will requeue ANY status (clip_error, clipped, analyzed...) — useful
    for re-clipping an already-published kill after a sync fix.
  * Prints the priority math so it's clear why the queue ordered the job
    where it did.

Usage :
    python scripts/reenqueue_one_kill.py <kill_uuid>
    python scripts/reenqueue_one_kill.py <kill_uuid> --priority 200
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv

_WORKER_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_WORKER_ROOT))
load_dotenv(_WORKER_ROOT / ".env")

from services import job_queue  # noqa: E402
from services.supabase_client import get_db  # noqa: E402


def _priority_from_score(highlight_score: float | None) -> int:
    """Same mapping as backfill_clip_errors. floor(score * 10), default 5.0."""
    score = float(highlight_score) if highlight_score is not None else 5.0
    return int(math.floor(score * 10))


def _fetch_kill(db, kill_id: str) -> dict | None:
    r = httpx.get(
        f"{db.base}/kills",
        headers=db.headers,
        params={
            "select": (
                "id,game_id,killer_player_id,killer_champion,"
                "victim_player_id,victim_champion,event_epoch,"
                "highlight_score,retry_count,status,created_at,updated_at"
            ),
            "id": f"eq.{kill_id}",
            "limit": "1",
        },
        timeout=15.0,
    )
    r.raise_for_status()
    rows = r.json() or []
    return rows[0] if rows else None


def _fetch_job(db, job_id: str) -> dict | None:
    r = httpx.get(
        f"{db.base}/pipeline_jobs",
        headers=db.headers,
        params={
            "select": (
                "id,type,entity_type,entity_id,priority,status,"
                "attempts,max_attempts,run_after,created_at"
            ),
            "id": f"eq.{job_id}",
            "limit": "1",
        },
        timeout=15.0,
    )
    r.raise_for_status()
    rows = r.json() or []
    return rows[0] if rows else None


def _reset_status(db, kill_id: str) -> bool:
    try:
        r = httpx.patch(
            f"{db.base}/kills",
            headers={**db.headers, "Prefer": "return=minimal"},
            params={"id": f"eq.{kill_id}"},
            json={"status": "enriched", "retry_count": 0},
            timeout=15.0,
        )
        return r.status_code in (200, 204)
    except Exception as e:
        print(f"  [error] status reset threw : {e}")
        return False


def _print_row(label: str, row: dict | None) -> None:
    print(f"--- {label} ---")
    if row is None:
        print("  (none)")
        return
    print(json.dumps(row, indent=2, default=str, sort_keys=True))


async def _amain(kill_id: str, override_priority: int | None) -> int:
    db = get_db()
    if db is None:
        print("FATAL : Supabase env vars missing.")
        return 2

    print("=" * 60)
    print(f"  reenqueue_one_kill : {kill_id}")
    print("=" * 60)
    print()

    # 1. BEFORE — what does the kill look like ?
    try:
        before = _fetch_kill(db, kill_id)
    except Exception as e:
        print(f"FATAL : kill fetch failed : {e}")
        return 1

    if before is None:
        print(f"FATAL : kill {kill_id} not found.")
        return 1

    _print_row("BEFORE  (kills row)", before)
    print()

    score = before.get("highlight_score")
    priority = (
        override_priority
        if override_priority is not None
        else _priority_from_score(score)
    )
    print(f"  highlight_score = {score!r}  ->  priority = {priority}")
    print()

    # 2. ENQUEUE
    print(f"--- ENQUEUE clip.create ---")
    payload = {"kill_id": kill_id, "game_id": before.get("game_id")}
    jid = await asyncio.to_thread(
        job_queue.enqueue,
        "clip.create",
        "kill",
        kill_id,
        payload,
        priority,
        None,
        3,
    )
    if jid is None:
        print("  enqueue() returned None.")
        print("  (Either an active job already exists for this kill —")
        print("  unique partial index on (type, entity_type, entity_id)")
        print("  WHERE status IN ('pending','claimed') — or the call")
        print("  failed. Continuing with status reset anyway so the")
        print("  legacy dispatcher stops retrying.)")
    else:
        print(f"  job_id = {jid}")
        try:
            new_job = _fetch_job(db, jid)
        except Exception as e:
            print(f"  [warn] could not re-fetch job : {e}")
            new_job = None
        _print_row("NEW JOB  (pipeline_jobs row)", new_job)
    print()

    # 3. RESET
    print("--- STATUS RESET ---")
    ok = await asyncio.to_thread(_reset_status, db, kill_id)
    if ok:
        print(f"  status -> 'enriched', retry_count -> 0  : OK")
    else:
        print(f"  status reset FAILED — manual intervention needed")

    # 4. AFTER
    try:
        after = _fetch_kill(db, kill_id)
    except Exception as e:
        print(f"  [warn] could not re-fetch kill : {e}")
        after = None
    print()
    _print_row("AFTER  (kills row)", after)

    # Exit code : 0 if both enqueue (or already-enqueued) AND reset worked.
    return 0 if ok else 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("kill_id", help="UUID of the kill to re-enqueue")
    ap.add_argument(
        "--priority",
        type=int,
        default=None,
        help="Override the priority (default : floor(highlight_score*10))",
    )
    args = ap.parse_args()

    return asyncio.run(_amain(args.kill_id, args.priority))


if __name__ == "__main__":
    sys.exit(main())
