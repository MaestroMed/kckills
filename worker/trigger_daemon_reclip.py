"""trigger_daemon_reclip — Wave 27.31

Find every kill where :
  * needs_reclip = TRUE
  * parent game has alt_vod_youtube_id == vod_youtube_id (= aligned, KC
    Replay-routed and vof2-calibrated)
  * status = 'published' or 'analyzed' (won't be retried by daemon)

... and PATCH status = 'clip_error'. The daemon's clipper module queries
`status IN ('clip_error', 'analyzed', 'manual_review')` on its 5 min
cycle and retries each — using the game's vod_youtube_id which we've
already pointed at KC Replay. Retry is parallel (8-worker semaphore)
and survives transient yt-dlp failures (clip_error gets another retry
on the NEXT cycle), so unattended bulk reclipping is robust.

This sidesteps the bespoke reclip_from_kc_replay.py script's sequential
per-game flow. Trade-off : the daemon will also re-encode + re-upload
artefacts already on R2 for kills where the underlying VOD changed
(now KC Replay vs. legacy LEC) — but that's exactly the goal.

Usage :
    python trigger_daemon_reclip.py             # dry-run
    python trigger_daemon_reclip.py --apply     # commit the status flip
    python trigger_daemon_reclip.py --apply --limit 50
                                                 # cap the trigger so the
                                                 # daemon's queue doesn't
                                                 # balloon
"""
from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from dotenv import load_dotenv
load_dotenv()

import httpx

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal",
}


def find_eligible() -> list[dict]:
    """needs_reclip kills in aligned games with offset set."""
    # All needs_reclip kills, batched
    r = httpx.get(SUPABASE_URL + "/rest/v1/kills", params={
        "select": "id,game_id,status",
        "needs_reclip": "eq.true",
        "status": "in.(published,analyzed)",
        "limit": "5000",
    }, headers=HEADERS, timeout=30)
    r.raise_for_status()
    kills = r.json() or []
    if not kills:
        return []

    # Bulk-fetch parent games
    game_cache: dict[str, dict | None] = {}
    eligible = []
    for k in kills:
        gid = k["game_id"]
        if gid not in game_cache:
            rg = httpx.get(SUPABASE_URL + "/rest/v1/games", params={
                "select": "id,vod_youtube_id,alt_vod_youtube_id,vod_offset_seconds",
                "id": f"eq.{gid}",
            }, headers=HEADERS, timeout=15)
            rows = rg.json() if rg.status_code == 200 else []
            game_cache[gid] = rows[0] if rows else None
        g = game_cache[gid]
        if not g:
            continue
        if (g["alt_vod_youtube_id"]
            and g["vod_youtube_id"] == g["alt_vod_youtube_id"]
            and g["vod_offset_seconds"] is not None):
            eligible.append(k)
    return eligible


def trigger(kill_id: str) -> bool:
    r = httpx.patch(
        SUPABASE_URL + f"/rest/v1/kills?id=eq.{kill_id}",
        json={"status": "clip_error"},
        headers=HEADERS,
        timeout=15,
    )
    return r.status_code in (200, 204)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--limit", type=int, default=None,
                        help="Cap how many kills to flip per run (lets you "
                             "feed the daemon's queue gradually)")
    args = parser.parse_args()

    print("Scanning aligned needs_reclip kills (status=published/analyzed)...")
    kills = find_eligible()
    print(f"  Found {len(kills)} eligible kills\n")

    if args.limit:
        kills = kills[: args.limit]
        print(f"  Capped to {args.limit}\n")

    if not kills:
        return

    # Group by game for the per-game count
    by_game: dict[str, int] = {}
    for k in kills:
        by_game[k["game_id"]] = by_game.get(k["game_id"], 0) + 1

    print(f"Distribution by game ({len(by_game)} games) :")
    for gid, n in sorted(by_game.items(), key=lambda x: -x[1])[:10]:
        print(f"  game={gid[:8]}  kills={n}")
    if len(by_game) > 10:
        print(f"  ...and {len(by_game) - 10} more games")

    if not args.apply:
        print("\n(dry-run; pass --apply to flip status -> clip_error)")
        return

    print(f"\nFlipping {len(kills)} kills -> status='clip_error'...")
    ok = 0
    fail = 0
    for k in kills:
        if trigger(k["id"]):
            ok += 1
        else:
            fail += 1
    print(f"  OK={ok} FAIL={fail}")
    print()
    print("The daemon's clipper picks these up on its next cycle (default")
    print("5 min interval). Each kill clips from the parent game's KC Replay")
    print("vod_youtube_id (pre-promoted). Daemon parallelism handles 8")
    print("concurrent downloads ; failed downloads come back to clip_error")
    print("automatically for another retry.")


if __name__ == "__main__":
    main()
