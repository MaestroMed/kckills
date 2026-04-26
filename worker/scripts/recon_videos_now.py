"""
recon_videos_now.py — One-shot trigger for the channel reconciler.

Useful for kicking the reconciler manually after fixing it (PR25),
or when you've just seeded new channels and want immediate matching
without waiting up to an hour for the daemon cycle.

Prints a 3-line summary :
  - rows_processed
  - rows_matched
  - rows_left_unmatched

Usage :
    python scripts/recon_videos_now.py
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

from dotenv import load_dotenv

_WORKER_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_WORKER_ROOT))
load_dotenv(_WORKER_ROOT / ".env")


async def _amain() -> int:
    import httpx

    from modules import channel_reconciler
    from services.supabase_client import get_db

    db = get_db()
    if db is None:
        print("FATAL : Supabase env vars missing.")
        return 2

    # Snapshot the backlog before/after so the summary is meaningful.
    def _count(label: str) -> int:
        params: list[tuple[str, str]] = [
            ("select", "id"),
            ("matched_match_external_id", "is.null"),
        ]
        if label == "pending":
            params.append((
                "status",
                f"in.({','.join(channel_reconciler.RECONCILE_STATUSES)})",
            ))
        elif label == "matched":
            params = [
                ("select", "id"),
                ("status", "eq.matched"),
                ("matched_match_external_id", "not.is.null"),
            ]
        r = httpx.get(
            f"{db.base}/channel_videos",
            headers={**db.headers, "Prefer": "count=exact"},
            params=params + [("limit", "1")],
            timeout=15.0,
        )
        cr = r.headers.get("content-range") or "0/0"
        try:
            return int(cr.split("/")[-1])
        except ValueError:
            return 0

    before_pending = _count("pending")
    before_matched = _count("matched")

    print(f"[before] pending={before_pending} already_matched={before_matched}")

    matched_now = await channel_reconciler.run()

    after_pending = _count("pending")
    after_matched = _count("matched")

    print()
    print(f"rows_processed       : {before_pending - after_pending + matched_now}")
    print(f"rows_matched         : {after_matched - before_matched}")
    print(f"rows_left_unmatched  : {after_pending}")
    print()
    print(f"reconciler.run() returned : {matched_now}")

    return 0 if matched_now > 0 else 1


def main() -> None:
    rc = asyncio.run(_amain())
    sys.exit(rc)


if __name__ == "__main__":
    main()
