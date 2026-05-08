"""
QUARANTINE_OFFSET_ZERO — One-shot cleanup for the vod_offset_seconds=0 bug.

Symptom : 91 games out of 94 in production have vod_offset_seconds=0 with
a VOD assigned. The clipper used that 0 offset to pull clips from the
START of the YouTube video — which on a full LEC broadcast is the panel
+ champion select + intro phase, not the actual gameplay. Result : a
chunk of /scroll clips show drafts / interviews / casters talking instead
of kills.

Root cause (now fixed in sentinel.py PR7-A) : `vod_offset = int(vod.get("offset") or 0)`
defaulted missing API values to 0 instead of NULL. The lolesports API
omits the offset field for many matches.

This script :
  1. Lists all games where vod_offset_seconds=0 AND vod_youtube_id IS NOT NULL
  2. For each, sets vod_offset_seconds=NULL (so the future vod_offset_finder
     module — or admin manual — knows it needs computation)
  3. Quarantines published clips from those games :
     - status='published' -> 'analyzed' (drops them from /scroll RPC)
     - sets `clip_validated=false` so the admin sees them flagged
     - keeps the clip URLs so we can re-clip in place once offsets are real
  4. Reports per-game counts and total impact

Run :
  python scripts/quarantine_offset_zero.py             # dry-run
  python scripts/quarantine_offset_zero.py --commit    # apply

Idempotent : re-runs after --commit are no-ops because the games no longer
have vod_offset_seconds=0 (they're NULL).
"""

from __future__ import annotations

import argparse
import os
import sys

import httpx
from dotenv import load_dotenv

load_dotenv()

URL = os.getenv("SUPABASE_URL")
KEY = os.getenv("SUPABASE_SERVICE_KEY")
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}


def fetch_offset_zero_games() -> list[dict]:
    r = httpx.get(
        f"{URL}/rest/v1/games",
        headers=H,
        params={
            "select": "id,external_id,vod_youtube_id,vod_offset_seconds,"
                      "matches:matches!games_match_id_fkey(scheduled_at,external_id)",
            "vod_offset_seconds": "eq.0",
            "vod_youtube_id": "not.is.null",
            "order": "created_at.desc",
            "limit": 500,
        },
        timeout=30.0,
    )
    r.raise_for_status()
    return r.json() or []


def fetch_published_kills_in_game(game_id: str) -> list[dict]:
    r = httpx.get(
        f"{URL}/rest/v1/kills",
        headers=H,
        params={
            "select": "id,killer_champion,victim_champion,clip_url_vertical,status",
            "game_id": f"eq.{game_id}",
            "status": "in.(published,analyzed,clipped)",
            "limit": 200,
        },
        timeout=15.0,
    )
    r.raise_for_status()
    return r.json() or []


def patch_game_offset_null(game_id: str) -> bool:
    """Set vod_offset_seconds=NULL so the game is re-eligible for offset
    discovery. Also reset state so it doesn't look 'completed' from a
    bad clipper run.
    """
    r = httpx.patch(
        f"{URL}/rest/v1/games?id=eq.{game_id}",
        headers={**H, "Content-Type": "application/json"},
        # Use null literal in JSON to clear the column
        json={"vod_offset_seconds": None, "state": "pending"},
        timeout=15.0,
    )
    return r.status_code in (200, 204)


def quarantine_kill(kill_id: str) -> bool:
    """Drop a kill from the public surface by flipping status='analyzed'
    and marking clip_validated=false. /scroll RPC filters on status='published'
    so this hides it instantly. Admin /audit will list these via the
    not-validated filter.
    """
    r = httpx.patch(
        f"{URL}/rest/v1/kills?id=eq.{kill_id}",
        headers={**H, "Content-Type": "application/json"},
        json={
            "status": "analyzed",
            "clip_validated": False,
            "needs_reclip": True,
            "retry_count": 0,
        },
        timeout=15.0,
    )
    return r.status_code in (200, 204)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true",
                    help="Actually apply the quarantine. Without this, dry-run only.")
    args = ap.parse_args()

    if not URL or not KEY:
        print("ERROR : SUPABASE_URL or SUPABASE_SERVICE_KEY missing in .env")
        sys.exit(1)

    games = fetch_offset_zero_games()
    print(f"Found {len(games)} games with vod_offset_seconds=0 and a VOD assigned.")
    print()

    total_kills_quarantined = 0
    total_games_patched = 0

    for g in games:
        gid = g["id"]
        sched = (g.get("matches") or {}).get("scheduled_at", "?")[:16]
        ext = g.get("external_id")
        vod = g.get("vod_youtube_id")

        kills = fetch_published_kills_in_game(gid)
        published = [k for k in kills if k["status"] == "published"]
        analyzed = [k for k in kills if k["status"] == "analyzed"]
        clipped = [k for k in kills if k["status"] == "clipped"]

        print(f"  {sched} game={ext} vod={vod}")
        print(f"      kills published={len(published)} analyzed={len(analyzed)} clipped={len(clipped)}")

        if not args.commit:
            continue

        # Quarantine published kills
        for k in published:
            if quarantine_kill(k["id"]):
                total_kills_quarantined += 1

        # Patch the game to NULL offset
        if patch_game_offset_null(gid):
            total_games_patched += 1

    print()
    print("=" * 60)
    if args.commit:
        print(f"COMMITTED. games patched={total_games_patched} "
              f"published_kills_quarantined={total_kills_quarantined}")
        print()
        print("Next steps :")
        print("  1. Apply migration 014 if not done yet (canonical events).")
        print("  2. The pipeline will re-discover offsets when the games "
              "next come up (sentinel re-poll). For older games, write a "
              "vod_offset_finder script that uses Live Stats epoch alignment.")
        print("  3. Quarantined kills sit in status='analyzed' with "
              "needs_reclip=true — the clipper retry queue picks them up "
              "automatically once the game has a real offset.")
    else:
        print("DRY-RUN. Would patch", len(games), "games and quarantine "
              "their published kills. Re-run with --commit to apply.")


if __name__ == "__main__":
    main()
