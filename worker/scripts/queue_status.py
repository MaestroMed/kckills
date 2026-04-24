"""
Quick pipeline_jobs status snapshot.

Run after a backfill / restart to see per-kind / per-status counts
without opening the admin UI. Useful for terminal-only monitoring.
"""

from __future__ import annotations

import os
import sys
from collections import Counter

import httpx
from dotenv import load_dotenv

load_dotenv()


def main() -> int:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get(
        "SUPABASE_SERVICE_KEY"
    )
    if not url or not key:
        print("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        return 1

    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
    }
    base = url.rstrip("/") + "/rest/v1"

    with httpx.Client(headers=headers, timeout=20.0) as client:
        # Pull all non-terminal + recent terminal rows. Cap at 5k for safety.
        r = client.get(
            f"{base}/pipeline_jobs",
            params={
                "select": "type,status",
                "limit": "5000",
                "order": "created_at.desc",
            },
        )
        r.raise_for_status()
        rows = r.json()

        # DLQ count
        dr = client.get(
            f"{base}/dead_letter_jobs",
            params={"select": "type", "limit": "5000"},
        )
        dr.raise_for_status()
        dlq_rows = dr.json()

    by_status: Counter[str] = Counter()
    by_kind_status: Counter[tuple[str, str]] = Counter()
    for row in rows:
        by_status[row["status"]] += 1
        by_kind_status[(row["type"], row["status"])] += 1

    dlq_by_kind: Counter[str] = Counter()
    for row in dlq_rows:
        dlq_by_kind[row["type"]] += 1

    print("=" * 60)
    print(f"  pipeline_jobs snapshot ({len(rows)} rows pulled, cap 5000)")
    print("=" * 60)
    print()
    print("  by status:")
    for s in ("pending", "claimed", "succeeded", "failed", "cancelled"):
        n = by_status.get(s, 0)
        marker = "*" if n > 0 else " "
        print(f"    {marker} {s:12s} {n:5d}")
    print()

    print("  by (kind, status):")
    kinds = sorted({k for k, _ in by_kind_status})
    for kind in kinds:
        line = f"    {kind:24s}"
        for s in ("pending", "claimed", "succeeded", "failed"):
            n = by_kind_status.get((kind, s), 0)
            line += f"  {s[:4]}={n:4d}"
        print(line)
    print()

    if dlq_rows:
        print(f"  dead_letter_jobs ({len(dlq_rows)} rows):")
        for kind, n in sorted(dlq_by_kind.items(), key=lambda x: -x[1]):
            print(f"    {kind:24s}  {n:5d}")
    else:
        print("  dead_letter_jobs: empty")
    print()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
