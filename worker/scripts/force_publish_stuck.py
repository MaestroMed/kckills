"""
force_publish_stuck.py — One-shot fix for kills stuck at status='analyzed'
when their game_event is is_publishable=true.

Symptom : event_publisher skips these because they have `published_at`
already stamped (the BEFORE UPDATE trigger fires when qc_described flips
true → auto-stamps published_at). But kills.status is still 'analyzed'.

The publisher's query `published_at IS NULL` excludes them as a result.
This script bypasses the publisher and flips kills.status directly for
every analyzed kill whose linked event is publishable.

Idempotent : skips kills already at 'published'.
"""

from __future__ import annotations

import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv

_WORKER_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_WORKER_ROOT))
load_dotenv(_WORKER_ROOT / ".env")

from services.supabase_client import get_db  # noqa


def main() -> None:
    db = get_db()
    if db is None:
        print("ERROR: no DB connection")
        sys.exit(1)

    print("=" * 60)
    print("  force-publish stuck-at-analyzed kills")
    print("=" * 60)

    # Pull every publishable event with a kill_id
    page = 0
    page_size = 500
    seen_kill_ids: set[str] = set()

    while True:
        offset = page * page_size
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
        if not events:
            break
        for e in events:
            kid = e.get("kill_id")
            if kid:
                seen_kill_ids.add(kid)
        page += 1
        if len(events) < page_size:
            break

    print(f"  {len(seen_kill_ids)} publishable kills total")

    # For each kill, check status. If 'analyzed', flip to 'published'.
    # Batch in chunks of 100 to keep PostgREST URLs sane.
    flipped = 0
    already_published = 0
    other_status = 0

    ids = list(seen_kill_ids)
    for i in range(0, len(ids), 100):
        chunk = ids[i:i + 100]
        in_filter = ",".join(chunk)
        # Get current status
        r2 = httpx.get(
            f"{db.base}/kills",
            headers=db.headers,
            params={"select": "id,status", "id": f"in.({in_filter})"},
            timeout=30.0,
        )
        r2.raise_for_status()
        rows = r2.json() or []

        analyzed_ids = [k["id"] for k in rows if k["status"] == "analyzed"]
        already_published += sum(1 for k in rows if k["status"] == "published")
        other_status += sum(1 for k in rows if k["status"] not in ("analyzed", "published"))

        if analyzed_ids:
            # Bulk update — PATCH with id=in.(...)
            ids_filter = ",".join(analyzed_ids)
            r3 = httpx.patch(
                f"{db.base}/kills",
                headers={**db.headers, "Prefer": "return=minimal"},
                params={"id": f"in.({ids_filter})"},
                json={"status": "published"},
                timeout=30.0,
            )
            if r3.status_code in (200, 204):
                flipped += len(analyzed_ids)
            else:
                print(f"  PATCH failed: {r3.status_code} {r3.text[:200]}")

        print(f"  Chunk {i//100}: flipped {flipped} so far")

    print()
    print(f"DONE.")
    print(f"  Flipped to published : {flipped}")
    print(f"  Already published    : {already_published}")
    print(f"  Other status         : {other_status}")


if __name__ == "__main__":
    main()
