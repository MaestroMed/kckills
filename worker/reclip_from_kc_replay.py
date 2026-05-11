"""reclip_from_kc_replay — Wave 27.28

Re-clip needs_reclip=TRUE kills from the KC Replay alt_vod source.

Eligibility:
  * kill.needs_reclip = TRUE
  * kill.status = 'published'
  * parent game.alt_vod_youtube_id IS NOT NULL
  * parent game.vod_youtube_id == alt_vod_youtube_id  (= "aligned" — the
    stored vod_offset_seconds was calibrated against KC Replay, not LEC)
  * parent game.vod_offset_seconds IS NOT NULL

For each eligible kill:
  1. Call modules.clipper.clip_kill() with (alt_vod_youtube_id, offset, gt)
  2. On success, UPDATE the kill : new clip_url_* values, needs_reclip=FALSE
  3. Increment a per-game cache so we don't re-download the same VOD per kill
     (clipper.clip_kill takes local_vod_path to bypass yt-dlp re-downloads)

Usage :
    python reclip_from_kc_replay.py            # all eligible
    python reclip_from_kc_replay.py --limit 20 # smoke test
    python reclip_from_kc_replay.py --game GAME_EXT_ID  # one game only
    python reclip_from_kc_replay.py --no-write # dry-run, just print

The --no-write flag still downloads + re-encodes (so the cost happens) but
skips the DB UPDATE — useful for visually inspecting a few re-clipped
files in deep_qc/ before committing to the full pass.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, os.path.dirname(__file__))
from dotenv import load_dotenv
load_dotenv()

import httpx

from modules.clipper import clip_kill, download_full_vod
from services.supabase_client import safe_update

import structlog
structlog.configure(processors=[
    structlog.processors.add_log_level,
    structlog.dev.ConsoleRenderer(),
])
log = structlog.get_logger()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
HEADERS = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}


def fetch_eligible() -> list[dict]:
    """Pull (kill, game) pairs where kill needs reclip + game has aligned alt_vod."""
    # 1. All needs_reclip=TRUE published kills
    r = httpx.get(SUPABASE_URL + "/rest/v1/kills", params={
        "select": "id,game_id,killer_champion,victim_champion,game_time_seconds,multi_kill,is_first_blood",
        "needs_reclip": "eq.true",
        "status": "eq.published",
        "limit": "5000",
    }, headers=HEADERS, timeout=30)
    r.raise_for_status()
    kills = r.json() or []
    if not kills:
        return []

    # 2. Bulk-fetch all parent games (one round trip per game_id; could be
    # batched with PostgREST `in.()` but the count is bounded ~30-100)
    game_cache: dict[str, dict | None] = {}
    eligible = []
    for k in kills:
        gid = k["game_id"]
        if gid not in game_cache:
            rg = httpx.get(SUPABASE_URL + "/rest/v1/games", params={
                "select": "id,external_id,vod_youtube_id,alt_vod_youtube_id,vod_offset_seconds",
                "id": f"eq.{gid}",
            }, headers=HEADERS, timeout=15)
            rows = rg.json() if rg.status_code == 200 else []
            game_cache[gid] = rows[0] if rows else None
        g = game_cache[gid]
        if not g:
            continue
        # Aligned-only: offset must be for KC Replay (vod_youtube_id == alt_vod)
        if (g["alt_vod_youtube_id"]
            and g["vod_youtube_id"] == g["alt_vod_youtube_id"]
            and g["vod_offset_seconds"] is not None):
            eligible.append({**k, "_game": g})
    return eligible


def write_back_clip(kid: str, clip_result: dict) -> bool:
    """Apply re-clip URLs back to the kills row + clear needs_reclip flag."""
    patch = {
        "clip_url_horizontal":   clip_result.get("clip_url_horizontal"),
        "clip_url_vertical":     clip_result.get("clip_url_vertical"),
        "clip_url_vertical_low": clip_result.get("clip_url_vertical_low"),
        "thumbnail_url":         clip_result.get("thumbnail_url"),
        "needs_reclip":          False,
        # Reset kill_visible — the next QC pass will re-evaluate against
        # the new clip. Leaving the old (stale) kill_visible would lie.
        "kill_visible":          None,
    }
    patch = {k: v for k, v in patch.items() if v is not None or k in ("kill_visible", "needs_reclip")}
    return bool(safe_update("kills", patch, "id", kid))


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--game", type=str, default=None,
                        help="Limit to one game external_id (smoke test)")
    parser.add_argument("--no-write", action="store_true",
                        help="Re-clip but don't update DB")
    parser.add_argument("--dry-run", action="store_true",
                        help="List eligible kills then exit. No clipping.")
    args = parser.parse_args()

    print("Fetching eligible kills...")
    eligible = fetch_eligible()
    print(f"  Eligible needs_reclip kills: {len(eligible)}")
    if args.game:
        eligible = [e for e in eligible if e["_game"]["external_id"] == args.game]
        print(f"  Filtered to game {args.game}: {len(eligible)}")
    if args.limit:
        eligible = eligible[: args.limit]
        print(f"  Capped to {args.limit}: {len(eligible)}")
    if not eligible:
        print("Nothing to do.")
        return

    # Group by game so we download each VOD once. Clipper supports a
    # local_vod_path arg — passing it bypasses yt-dlp on subsequent kills.
    by_game: dict[str, list[dict]] = {}
    for e in eligible:
        by_game.setdefault(e["game_id"], []).append(e)

    print(f"\n  Distinct games to re-clip from: {len(by_game)}")
    for gid, kills in by_game.items():
        g = kills[0]["_game"]
        print(f"    {g['external_id'][:25]:<25} alt={g['alt_vod_youtube_id']:<12} offset={g['vod_offset_seconds']:<5} kills={len(kills)}")

    if args.dry_run:
        print("\n--dry-run set, exiting without clipping.")
        return

    # Process game-by-game. Within a game, kills can run in parallel BUT
    # the local VOD download is serial (one full download per game).
    started = time.time()
    ok = 0
    fail = 0
    for gid, kills in by_game.items():
        g = kills[0]["_game"]
        yt = g["alt_vod_youtube_id"]
        offset = int(g["vod_offset_seconds"])
        ext = g["external_id"]
        print(f"\n=== Game {ext[:20]} (yt={yt}, offset={offset}s, {len(kills)} kills) ===", flush=True)
        # Wave 27.31 — skip the full-VOD pre-download. yt-dlp's mux step
        # on Windows produces corrupted moov atoms when stitching the
        # video stream (3.5 GB H.264 .mp4) with the audio stream (130 MB
        # .webm). Four smoke attempts all failed (some with audio-only
        # output, some with truncated video). The daemon's clipper uses
        # per-kill `--download-sections` against the HLS m3u8 manifest
        # and that path WORKS reliably (clip_done version=3,4,5 visible
        # in daemon.log on Wave 27.31 morning). We follow the same
        # working pattern here.
        local_vod = None

        for kill in kills:
            kid = kill["id"]
            print(f"  -> {kid[:8]} {kill['killer_champion']:>10} -> {kill['victim_champion']:<10} gt={kill['game_time_seconds']}s ", end="", flush=True)
            try:
                result = await clip_kill(
                    kill_id=kid,
                    youtube_id=yt,
                    vod_offset_seconds=offset,
                    game_time_seconds=int(kill["game_time_seconds"] or 0),
                    multi_kill=kill.get("multi_kill"),
                    killer_champion=kill["killer_champion"],
                    victim_champion=kill["victim_champion"],
                    match_context=ext,
                    local_vod_path=local_vod,
                    game_id=gid,
                )
            except Exception as e:
                print(f"EXC {str(e)[:60]}")
                fail += 1
                continue
            if not result:
                print("FAIL")
                fail += 1
                continue
            print("OK", end="")
            if not args.no_write:
                if write_back_clip(kid, result):
                    print(" + DB updated")
                else:
                    print(" (DB write FAILED)")
            else:
                print(" (no-write)")
            ok += 1

    elapsed = time.time() - started
    print(f"\n{'='*60}")
    print(f"  Re-clipped OK   : {ok}")
    print(f"  Failed          : {fail}")
    print(f"  Runtime         : {elapsed/60:.1f} min")
    print(f"  Rate            : {ok / max(1, elapsed/60):.1f}/min")


if __name__ == "__main__":
    asyncio.run(main())
