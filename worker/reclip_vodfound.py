"""
Re-clip all kills in vod_found status using full-VOD strategy.
Groups by game, downloads each VOD once, re-clips all kills.
"""
import asyncio
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

from scheduler import scheduler
scheduler.DELAYS["ytdlp"] = 5.0
scheduler.DELAYS["ffmpeg_cooldown"] = 1.0  # faster for batch re-clip

from services.supabase_client import safe_select, safe_update
from modules import clipper

import structlog
structlog.configure(processors=[
    structlog.processors.TimeStamper(fmt="iso"),
    structlog.processors.add_log_level,
    structlog.dev.ConsoleRenderer(),
])


async def main():
    kills = safe_select(
        "kills",
        "id, game_id, game_time_seconds, multi_kill, killer_champion, victim_champion",
        status="vod_found",
    )
    print(f"Kills to re-clip: {len(kills)}")
    if not kills:
        return

    # Group by game
    by_game: dict[str, list[dict]] = {}
    for k in kills:
        gid = k.get("game_id", "")
        by_game.setdefault(gid, []).append(k)

    print(f"Games: {len(by_game)}")
    total_done = 0
    total_fail = 0

    for gid, game_kills in by_game.items():
        game_rows = safe_select("games", "vod_youtube_id, vod_offset_seconds, game_number", id=gid)
        if not game_rows:
            print(f"  No game row for {gid[:8]}, skipping {len(game_kills)}")
            continue
        g = game_rows[0]
        yt_id = g.get("vod_youtube_id")
        if not yt_id:
            print(f"  No VOD for game {gid[:8]}, skipping")
            continue

        vod_offset = int(g.get("vod_offset_seconds") or 0)
        game_num = g.get("game_number", "?")

        # Download VOD
        local_vod = await clipper.download_full_vod(yt_id)
        if not local_vod:
            print(f"  VOD {yt_id} download failed")
            total_fail += len(game_kills)
            continue

        print(f"\n  Game {gid[:8]} (#{game_num}, {len(game_kills)} kills, VOD {yt_id[:11]})")

        for k in game_kills:
            gt = int(k.get("game_time_seconds") or 0)
            urls = await clipper.clip_kill(
                kill_id=k["id"],
                youtube_id=yt_id,
                vod_offset_seconds=vod_offset,
                game_time_seconds=gt,
                multi_kill=k.get("multi_kill"),
                killer_champion=k.get("killer_champion"),
                victim_champion=k.get("victim_champion"),
                match_context=f"Game {game_num}  T+{gt//60:02d}:{gt%60:02d}",
                local_vod_path=local_vod,
            )
            if urls and urls.get("clip_url_horizontal"):
                urls.pop("_local_h_path", None)
                safe_update("kills", {**urls, "status": "published"}, "id", k["id"])
                total_done += 1
            else:
                safe_update("kills", {"status": "clip_error"}, "id", k["id"])
                total_fail += 1

        print(f"    done: {total_done} ok, {total_fail} fail")

    print(f"\nFinal: {total_done} re-clipped, {total_fail} failed")


if __name__ == "__main__":
    asyncio.run(main())
