"""Sample recent clip_error kills to see what's failing.

Usage:  python check_errors.py
"""

from __future__ import annotations

import json
import os
import urllib.request
from collections import Counter

from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]


def get_json(url: str) -> list[dict]:
    req = urllib.request.Request(url, headers={
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def main() -> None:
    # Pull last 50 clip_error rows with their retry_count + created_at
    url = (
        f"{SUPABASE_URL}/rest/v1/kills"
        "?select=id,killer_champion,victim_champion,retry_count,updated_at,game_id"
        "&status=eq.clip_error"
        "&order=updated_at.desc"
        "&limit=50"
    )
    rows = get_json(url)
    print(f"\n=== Last 50 clip_error kills ===\n")

    # Pattern: if multiple kills from same game hit error, it's probably
    # the VOD that's broken (YouTube taken down, geoblock, etc).
    game_counter: Counter[str] = Counter()
    retry_counter: Counter[int] = Counter()
    for r in rows:
        game_counter[r["game_id"]] += 1
        retry_counter[r.get("retry_count", 0)] += 1
        ts = (r.get("updated_at") or "")[:19]
        print(
            f"  {ts}  retry={r.get('retry_count',0):>2}  "
            f"{(r['killer_champion'] or '?'):<12} -> {(r['victim_champion'] or '?'):<12}  "
            f"game={r['game_id'][:8]}"
        )

    print(f"\n=== Aggregation ===\n")
    print("Top games with errors:")
    for g, n in game_counter.most_common(5):
        print(f"  {g[:8]}  {n} errors")
    print("\nRetry count distribution:")
    for rc, n in sorted(retry_counter.items()):
        print(f"  retry={rc}  {n}")


if __name__ == "__main__":
    main()
