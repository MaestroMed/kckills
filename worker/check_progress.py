"""Quick health-check script — print kill pipeline status counts.

Uses raw HTTP against Supabase REST API to avoid the supabase-py dep
(which has heavy transitive imports like pyiceberg that don't always
build cleanly on Windows / Python 3.14).

Usage:  python check_progress.py
"""

from __future__ import annotations

import os
import urllib.request

from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]


def head_count(url: str) -> int:
    """HEAD request that returns the Content-Range total — Supabase pattern
    for `select=id&count=exact` queries."""
    req = urllib.request.Request(url, method="HEAD", headers={
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Prefer": "count=exact",
        "Range-Unit": "items",
        "Range": "0-0",
    })
    with urllib.request.urlopen(req, timeout=15) as r:
        cr = r.headers.get("Content-Range", "0-0/0")
        # Format: "0-0/12345" → take the part after the slash
        return int(cr.split("/")[-1])


def main() -> None:
    print("\n=== KCKILLS pipeline status (kills table) ===\n")
    statuses = ["raw", "vod_found", "clipping", "clipped", "analyzed", "published",
                "clip_error", "manual_review", "no_vod"]
    rows = []
    base = f"{SUPABASE_URL}/rest/v1/kills?select=id"
    for s in statuses:
        n = head_count(f"{base}&status=eq.{s}")
        rows.append((s, n))
        print(f"  {s:<16}  {n:>6}")
    total = sum(n for _, n in rows)
    print(f"  {'TOTAL':<16}  {total:>6}")

    # KC team-killer published clips with thumbnail = the actual scroll feed
    visible = head_count(
        f"{base}&status=eq.published"
        "&kill_visible=eq.true"
        "&tracked_team_involvement=eq.team_killer"
        "&clip_url_vertical=not.is.null"
        "&thumbnail_url=not.is.null"
    )
    print(f"\n  /scroll feed candidates: {visible}\n")


if __name__ == "__main__":
    main()
