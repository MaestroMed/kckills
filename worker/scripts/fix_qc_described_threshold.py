"""
fix_qc_described_threshold.py — One-shot fix for the qc_described threshold bug.

The migration 014 seeded `qc_described=false` for any kill whose
ai_description is < 80 characters. But the analyzer prompt explicitly
asks Gemini for "max 120 chars, percutant" — perfectly valid
descriptions land at 50-79 chars and get blocked from publishing.

This script :
  1. Finds every game_event where qc_described=false AND the linked
     kill has a non-trivial ai_description (>= 30 chars).
  2. Patches qc_described=true for those events.
  3. The is_publishable GENERATED column auto-recomputes.
  4. The event_publisher daemon picks them up on its next 5-min cycle.

Idempotent : re-running is a no-op once everything is fixed.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv

_WORKER_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_WORKER_ROOT))
load_dotenv(_WORKER_ROOT / ".env")

from services.supabase_client import get_db  # noqa


MIN_DESCRIPTION_LENGTH = 30  # New, more permissive threshold.


def main() -> None:
    db = get_db()
    if db is None:
        print("ERROR: no DB connection (check SUPABASE_URL / SUPABASE_SERVICE_KEY)")
        sys.exit(1)

    print("=" * 60)
    print("  qc_described threshold fix")
    print("=" * 60)

    # Step 1 : pull every event where qc_described=false. We then look up
    # the linked kill's description length and decide.
    page = 0
    page_size = 1000
    fixed = 0
    skipped_no_desc = 0
    skipped_too_short = 0
    skipped_no_kill = 0

    while True:
        offset = page * page_size
        r = httpx.get(
            f"{db.base}/game_events",
            headers=db.headers,
            params={
                "select": "id,kill_id,qc_described",
                "qc_described": "eq.false",
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

        # Batch-fetch the kill descriptions
        kill_ids = [e["kill_id"] for e in events if e.get("kill_id")]
        if not kill_ids:
            break

        # PostgREST in.() filter chunked to avoid URL-too-long
        kill_descs: dict[str, str] = {}
        for i in range(0, len(kill_ids), 50):
            chunk = kill_ids[i:i + 50]
            in_filter = ",".join(chunk)
            r2 = httpx.get(
                f"{db.base}/kills",
                headers=db.headers,
                params={
                    "select": "id,ai_description",
                    "id": f"in.({in_filter})",
                    "limit": "100",
                },
                timeout=30.0,
            )
            r2.raise_for_status()
            for k in r2.json() or []:
                kill_descs[k["id"]] = k.get("ai_description") or ""

        # Decide which events to fix
        to_fix: list[str] = []
        for ev in events:
            kid = ev.get("kill_id")
            if not kid:
                skipped_no_kill += 1
                continue
            desc = kill_descs.get(kid, "")
            if not desc:
                skipped_no_desc += 1
                continue
            if len(desc.strip()) < MIN_DESCRIPTION_LENGTH:
                skipped_too_short += 1
                continue
            to_fix.append(ev["id"])

        # Batch-patch in chunks of 50 — PostgREST supports updating
        # multiple rows by id=in.(...) but the URL gets long fast.
        for i in range(0, len(to_fix), 50):
            chunk = to_fix[i:i + 50]
            in_filter = ",".join(chunk)
            r3 = httpx.patch(
                f"{db.base}/game_events",
                headers={**db.headers, "Prefer": "return=minimal"},
                params={"id": f"in.({in_filter})"},
                json={"qc_described": True},
                timeout=30.0,
            )
            if r3.status_code in (200, 204):
                fixed += len(chunk)
            else:
                print(f"  PATCH failed status={r3.status_code} body={r3.text[:200]}")
                break

        print(f"  Page {page} : processed {len(events)}, fixed_so_far={fixed}")
        page += 1

    print()
    print(f"DONE.")
    print(f"  Events fixed         : {fixed}")
    print(f"  Skipped (no desc)    : {skipped_no_desc}")
    print(f"  Skipped (too short)  : {skipped_too_short}")
    print(f"  Skipped (no kill_id) : {skipped_no_kill}")
    print()
    print("The event_publisher daemon will pick up these now-publishable")
    print("events on its next 5-min cycle and flip status=published.")


if __name__ == "__main__":
    main()
