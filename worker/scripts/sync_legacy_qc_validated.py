"""
One-shot : sync legacy `game_events.qc_clip_validated` from new
`kills.publication_status / asset_status / qc_status`.

THE PROBLEM
-----------
Migration 027 introduced 4 split status columns on `kills`
(pipeline_status, publication_status, qc_status, asset_status) and a
trigger that derives them from the legacy `kills.status` column.

But there's a SEPARATE legacy flag on `game_events.qc_clip_validated`
that the event_publisher uses to decide `is_publishable`. Migration 027
did NOT propagate to it, so we end up with rows where :

    kills.publication_status = 'publishable'   (new system : OK to publish)
    kills.asset_status       = 'ready'         (new system : clip exists)
    kills.qc_status          = 'passed'        (new system : QC OK)
    BUT
    game_events.qc_clip_validated = false      (legacy : never validated)
    => game_events.is_publishable = false      (derived from the legacy flag)
    => event_publisher RETRACTS the kill on every cycle (33 of them)

THE FIX
-------
Walk those 33 events. For each, fetch the linked kill row and verify
all 3 new-system flags are green. If yes, flip qc_clip_validated to
true. The event_publisher's next cycle will see is_publishable=true
and re-publish the kill.

This is a one-shot — won't re-run after migration 035 (or whenever)
ports the propagation into a real DB trigger.

USAGE
-----
    python scripts/sync_legacy_qc_validated.py            # default 90-day window
    python scripts/sync_legacy_qc_validated.py --dry-run  # report only
    python scripts/sync_legacy_qc_validated.py --all      # no time window
"""

from __future__ import annotations

import argparse
import os
import sys

import httpx
from dotenv import load_dotenv

load_dotenv()


def _supabase_client() -> tuple[httpx.Client, str]:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get(
        "SUPABASE_SERVICE_KEY"
    )
    if not url or not key:
        print("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        sys.exit(1)
    base = url.rstrip("/") + "/rest/v1"
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
        "Content-Type": "application/json",
        # Prefer header on PATCH so we get the row back to confirm the
        # write landed — useful debug; harmless in prod.
        "Prefer": "return=representation",
    }
    return httpx.Client(headers=headers, timeout=30.0), base


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true",
                    help="Report what would change without writing.")
    ap.add_argument("--all", action="store_true",
                    help="Skip the 90-day recency filter (default: only "
                         "events created in the last 90 days).")
    ap.add_argument("--limit", type=int, default=500,
                    help="Cap rows scanned per page (default 500, max 1000 "
                         "per PostgREST).")
    args = ap.parse_args()

    client, base = _supabase_client()

    print("=" * 60)
    print("  sync_legacy_qc_validated — heal new/legacy status drift")
    print("=" * 60)
    print(f"  dry_run : {args.dry_run}")
    print(f"  window  : {'all-time' if args.all else 'last 90 days'}")
    print()

    # 1. Find candidate game_events.
    #
    # Filter matches event_publisher's retract query EXACTLY :
    #   is_publishable=false AND published_at IS NOT NULL.
    # Without `published_at IS NOT NULL` we'd pick up events that
    # were never publishable to begin with (correctly blocked, no
    # drift to heal). The retract loop only fires on events that
    # WERE published before — so those are the ones that need the
    # legacy flag flipped.
    params = {
        "select": "id,kill_id,qc_clip_validated,is_publishable,published_at",
        "is_publishable": "eq.false",
        "published_at": "not.is.null",
        "kill_id": "not.is.null",
        "limit": str(args.limit),
        "order": "created_at.desc",
    }
    if not args.all:
        # PostgREST: 90 days back via inline now() expression isn't
        # supported — use a precomputed date via Python
        from datetime import datetime, timedelta, timezone
        cutoff = (datetime.now(timezone.utc) - timedelta(days=90)).isoformat()
        params["created_at"] = f"gte.{cutoff}"

    r = client.get(f"{base}/game_events", params=params)
    r.raise_for_status()
    candidates = r.json()
    print(f"  scanned game_events : {len(candidates)}")

    if not candidates:
        print("  no candidates — nothing to do")
        client.close()
        return 0

    # 2. Bulk-fetch the linked kills with the new-system flags.
    #    PostgREST `in` filter — chunk by 100 to keep URL length reasonable.
    by_kill_id: dict[str, dict] = {}
    chunk = 100
    kill_ids = [ev["kill_id"] for ev in candidates if ev.get("kill_id")]
    for i in range(0, len(kill_ids), chunk):
        batch = kill_ids[i : i + chunk]
        ids_csv = ",".join(batch)
        kr = client.get(
            f"{base}/kills",
            params={
                "select": "id,publication_status,asset_status,qc_status,status",
                "id": f"in.({ids_csv})",
                "limit": str(chunk),
            },
        )
        kr.raise_for_status()
        for k in kr.json():
            by_kill_id[k["id"]] = k

    # 3. Decide who passes the gate.
    to_flip: list[str] = []        # game_events.id
    skip_reasons: dict[str, int] = {
        "missing_kill": 0,
        "publication_not_publishable": 0,
        "asset_not_ready": 0,
        "qc_not_passed": 0,
    }
    for ev in candidates:
        kill = by_kill_id.get(ev.get("kill_id") or "")
        if not kill:
            skip_reasons["missing_kill"] += 1
            continue
        if kill.get("publication_status") != "publishable":
            skip_reasons["publication_not_publishable"] += 1
            continue
        if kill.get("asset_status") != "ready":
            skip_reasons["asset_not_ready"] += 1
            continue
        if kill.get("qc_status") != "passed":
            skip_reasons["qc_not_passed"] += 1
            continue
        to_flip.append(ev["id"])

    print(f"  to flip            : {len(to_flip)}")
    for reason, n in skip_reasons.items():
        if n:
            print(f"  skipped ({reason:32s}) : {n}")
    print()

    if args.dry_run:
        print("  dry-run — no writes performed")
        client.close()
        return 0

    if not to_flip:
        print("  nothing to flip — done")
        client.close()
        return 0

    # 4. Flip qc_clip_validated to true. PostgREST doesn't support bulk
    #    UPDATE by id-list with a single PATCH cleanly, so we PATCH per id
    #    or use a `.in.` filter. The latter is cleaner.
    flipped = 0
    for i in range(0, len(to_flip), chunk):
        batch = to_flip[i : i + chunk]
        ids_csv = ",".join(batch)
        upd = client.patch(
            f"{base}/game_events",
            params={"id": f"in.({ids_csv})"},
            json={"qc_clip_validated": True},
        )
        if upd.status_code in (200, 204):
            flipped += len(batch)
        else:
            print(
                f"  ! patch failed batch {i//chunk}: "
                f"status={upd.status_code} body={upd.text[:200]}"
            )

    print(f"  flipped            : {flipped}")
    print()
    print("  next event_publisher cycle will re-publish these kills")
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
