"""
Re-clip corrupted kills (tiny files from the -c copy bug).

Finds all published kills whose clip_url_vertical points to a file < 10 KB,
resets them to 'vod_found', then re-clips using the fixed code (re-encode
with libx264 ultrafast, not -c copy).

Uses the full-VOD strategy so it only downloads each VOD once.
"""

import asyncio
import sys
import os

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

from scheduler import scheduler
scheduler.DELAYS["livestats"] = 0.3
scheduler.DELAYS["ytdlp"] = 5.0

import httpx
from config import config
from services.supabase_client import safe_select, safe_update
from modules import clipper

import structlog
structlog.configure(
    processors=[
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.add_log_level,
        structlog.dev.ConsoleRenderer(),
    ]
)


async def main():
    kills = safe_select(
        "kills",
        "id, game_id, clip_url_vertical, clip_url_horizontal, game_time_seconds, "
        "multi_kill, killer_champion, victim_champion",
        status="published",
    )
    print(f"Total published: {len(kills)}")

    # Find corrupted clips
    print("Scanning for corrupted clips...")
    corrupted = []
    for i, k in enumerate(kills):
        url = k.get("clip_url_vertical")
        if not url:
            continue
        try:
            r = httpx.head(url, timeout=10, follow_redirects=True)
            size = int(r.headers.get("content-length", 0))
            if size < 10000:
                corrupted.append(k)
        except Exception:
            corrupted.append(k)
        if (i + 1) % 100 == 0:
            print(f"  scanned {i+1}/{len(kills)}...")

    print(f"\nCorrupted: {len(corrupted)} / {len(kills)}")
    if not corrupted:
        print("No corrupted clips found!")
        return

    # Group by game_id to download VODs efficiently
    games_needed: dict[str, list[dict]] = {}
    for k in corrupted:
        gid = k.get("game_id", "")
        if gid not in games_needed:
            games_needed[gid] = []
        games_needed[gid].append(k)

    # Get VOD info for each game
    game_vods: dict[str, str] = {}
    for gid in games_needed:
        rows = safe_select("games", "id, vod_youtube_id, vod_offset_seconds", id=gid)
        if rows and rows[0].get("vod_youtube_id"):
            game_vods[gid] = rows[0]["vod_youtube_id"]

    print(f"VODs needed: {len(set(game_vods.values()))}")

    # Download VODs and re-clip
    reclipped = 0
    for gid, kill_list in games_needed.items():
        yt_id = game_vods.get(gid)
        if not yt_id:
            print(f"  No VOD for game {gid[:8]}, skipping {len(kill_list)} kills")
            continue

        # Download full VOD
        local_vod = await clipper.download_full_vod(yt_id)
        if not local_vod:
            print(f"  VOD download failed for {yt_id}, skipping")
            continue

        # Get game offset
        game_rows = safe_select("games", "vod_offset_seconds", id=gid)
        vod_offset = int((game_rows[0] if game_rows else {}).get("vod_offset_seconds") or 0)

        for k in kill_list:
            gt = int(k.get("game_time_seconds") or 0)
            gt_str = f"T+{gt//60:02d}:{gt%60:02d}"

            urls = await clipper.clip_kill(
                kill_id=k["id"],
                youtube_id=yt_id,
                vod_offset_seconds=vod_offset,
                game_time_seconds=gt,
                multi_kill=k.get("multi_kill"),
                killer_champion=k.get("killer_champion"),
                victim_champion=k.get("victim_champion"),
                match_context=f"Re-clip {gt_str}",
                local_vod_path=local_vod,
            )

            if urls and urls.get("clip_url_horizontal"):
                urls.pop("_local_h_path", None)
                safe_update("kills", {**urls, "status": "published"}, "id", k["id"])
                reclipped += 1
                print(f"  [{reclipped}] {k['killer_champion']:>10} -> {k['victim_champion']:<10} OK")
            else:
                print(f"  FAIL: {k['id'][:8]}")

    print(f"\nDone: {reclipped} / {len(corrupted)} re-clipped")


if __name__ == "__main__":
    asyncio.run(main())
