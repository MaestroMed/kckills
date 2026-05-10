"""promote_misaligned — Wave 27.29

Promote "misaligned" games to use the KC Replay alt_vod as their primary VOD.

Before :
    games.vod_youtube_id      = <LEC official>
    games.alt_vod_youtube_id  = <KC Replay>
    games.vod_offset_seconds  = <offset for LEC>

After :
    games.vod_youtube_id      = <KC Replay>  (== alt_vod_youtube_id)
    games.alt_vod_youtube_id  = <KC Replay>  (unchanged)
    games.vod_offset_seconds  = NULL          (so vod_offset_finder_v2 re-runs)

Why : the user's directive is to use only Kameto's KC Replay VODs going
forward. For misaligned games we still have the legacy LEC pointer + offset,
which the clipper would use by default. Promoting forces the worker to
re-calibrate against KC Replay and re-clip from that source. The kills
themselves are NOT touched here — the reclip pass (reclip_from_kc_replay.py)
handles those once vod_offset_finder_v2 fills the new offset back in.

Usage :
    python promote_misaligned.py                 # dry-run, prints diff
    python promote_misaligned.py --apply         # commit the change
    python promote_misaligned.py --apply --skip-empty
                                                  # skip games with 0 kills
                                                  # (those need a separate
                                                  # live-stats retry instead)
"""
from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from dotenv import load_dotenv
load_dotenv()

import httpx

import structlog
structlog.configure(processors=[
    structlog.processors.add_log_level,
    structlog.dev.ConsoleRenderer(),
])
log = structlog.get_logger()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal",
}


def find_misaligned() -> list[dict]:
    """All games where vod_youtube_id != alt_vod_youtube_id AND alt is set."""
    r = httpx.get(SUPABASE_URL + "/rest/v1/games", params={
        "select": "id,external_id,vod_youtube_id,alt_vod_youtube_id,vod_offset_seconds,match_id",
        "alt_vod_youtube_id": "not.is.null",
        "limit": "200",
    }, headers=HEADERS, timeout=30)
    r.raise_for_status()
    rows = r.json() or []
    return [g for g in rows
            if g["vod_youtube_id"] != g["alt_vod_youtube_id"]]


def count_kills(game_id: str) -> int:
    r = httpx.get(SUPABASE_URL + "/rest/v1/kills", params={
        "select": "id",
        "game_id": f"eq.{game_id}",
        "limit": "1",
    }, headers={**HEADERS, "Prefer": "count=exact"}, timeout=15)
    return int(r.headers.get("content-range", "0/0").split("/")[-1])


def promote(game_id: str, alt_vod: str) -> bool:
    """Apply the swap. PATCH on /rest/v1/games?id=eq.<id>."""
    payload = {
        "vod_youtube_id":     alt_vod,
        "vod_offset_seconds": None,
    }
    r = httpx.patch(
        SUPABASE_URL + f"/rest/v1/games?id=eq.{game_id}",
        json=payload,
        headers=HEADERS,
        timeout=15,
    )
    return r.status_code in (200, 204)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true",
                        help="Actually PATCH the games. Without this, dry-run.")
    parser.add_argument("--skip-empty", action="store_true",
                        help="Skip games with 0 kills attached (those need "
                             "live-stats feed retry, not VOD promotion)")
    args = parser.parse_args()

    print("Scanning for misaligned games...")
    games = find_misaligned()
    print(f"  Found {len(games)} misaligned games\n")
    if not games:
        return

    # Annotate with kill count
    for g in games:
        g["_kill_count"] = count_kills(g["id"])

    # Filter
    if args.skip_empty:
        games = [g for g in games if g["_kill_count"] > 0]
        print(f"  After --skip-empty: {len(games)} games\n")

    # Print plan
    print(f"{'EXT_ID':<25}  {'OLD_VOD':<13} {'NEW_VOD':<13} OLD_OFFSET  KILLS")
    print("-" * 80)
    for g in games:
        old_off = g["vod_offset_seconds"] if g["vod_offset_seconds"] is not None else "NULL"
        print(f"{g['external_id'][:25]:<25}  {g['vod_youtube_id']:<13} {g['alt_vod_youtube_id']:<13} {str(old_off):<11} {g['_kill_count']}")

    if not args.apply:
        print("\n(dry-run; pass --apply to commit)")
        return

    # Apply
    print(f"\nApplying changes to {len(games)} games...")
    ok = 0
    fail = 0
    for g in games:
        if promote(g["id"], g["alt_vod_youtube_id"]):
            ok += 1
            print(f"  OK   {g['external_id']}")
        else:
            fail += 1
            print(f"  FAIL {g['external_id']}")
    print(f"\nDone. OK={ok} FAIL={fail}")
    print()
    print("Next steps :")
    print("  1. vod_offset_finder_v2 will pick up the promoted games on its")
    print("     next cycle (KCKILLS_INTERVAL_VOD_OFFSET_FINDER=3600s by default).")
    print("     To accelerate :")
    print("       .venv/Scripts/python.exe -m modules.vod_offset_finder_v2")
    print("  2. After offsets are set, run :")
    print("       .venv/Scripts/python.exe reclip_from_kc_replay.py --dry-run")
    print("     to confirm the promoted games now appear as 'eligible'.")


if __name__ == "__main__":
    main()
