"""youtube_sections.py — pont YouTube -> pipeline Twitch (twitch_backfill).

Pour chaque game d'un match ayant vod_youtube_id + vod_offset_seconds et une
horloge feed : télécharge la section YouTube (cookies Firefox + PO token),
la cale sur le chrono (twitch_sync.calibrate_section) et écrit le
.sync.json au nom `twitch_yt-<id>_<game>.mp4` que cached_game_section()
retrouve. Ensuite twitch_backfill --match <id> clippe depuis cette section
sans toucher à Twitch.

Usage : python scripts/youtube_sections.py --match 116855104460702360,...
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT))
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
from dotenv import load_dotenv  # noqa: E402
load_dotenv(_ROOT / ".env")

from modules import feed_clock, twitch_sync  # noqa: E402
from services import youtube_cookies  # noqa: E402
from services.local_paths import LocalPaths  # noqa: E402
from services.twitch_vod import _ytdlp  # noqa: E402
from services.supabase_client import safe_select  # noqa: E402

MARGIN_S = 240


async def prepare(game: dict) -> dict:
    gext, vid, off = game["external_id"], game.get("vod_youtube_id"), game.get("vod_offset_seconds")
    rep = {"game": gext, "n": game.get("game_number"), "vod": vid}
    if not vid or off is None:
        rep["skip"] = "pas de VOD"
        return rep
    todo = [k for k in (safe_select("kills", "status", game_id=game["id"]) or [])
            if k["status"] not in ("published", "duplicate")]
    if not todo:
        rep["skip"] = "rien à reclipper"
        return rep
    clock = await feed_clock.get_clock(gext)
    if not clock or clock.end_ms is None:
        rep["skip"] = "pas d'horloge feed"
        return rep
    if twitch_sync.cached_game_section(clock):
        rep["ok"] = "déjà calée"
        return rep
    dur = (clock.end_ms - clock.anchor_ms) / 1000.0
    start, end = max(0, int(off) - MARGIN_S), int(off + dur + MARGIN_S)
    path = os.path.join(LocalPaths.vods_dir(), f"twitch_yt-{vid}_{gext}.mp4")
    if not os.path.exists(path):
        rc, _o, err = await _ytdlp(
            *youtube_cookies.cli_args(),
            "-f", "bv*[height<=1080]+ba/b[height<=1080]", "--merge-output-format", "mp4",
            "--download-sections", f"*{start}-{end}", "--concurrent-fragments", "8",
            "-o", path, f"https://www.youtube.com/watch?v={vid}", timeout=3600)
        if rc != 0 or not os.path.exists(path):
            rep["error"] = f"téléchargement: {err[-300:]}"
            return rep
    sync = await twitch_sync.calibrate_section(path, clock, guess_c=float(off - start),
                                               tmp_dir=os.path.join(LocalPaths.vods_dir(), "sync_tmp"))
    with open(path + ".sync.json", "w", encoding="utf-8") as f:
        json.dump({"vod": {"video_id": f"yt-{vid}", "title": f"YouTube {vid}", "channel": "youtube"},
                   "section_start_s": start, "calibrated_at": int(time.time()),
                   "clock": clock.to_json(), **sync.to_json()}, f, indent=1)
    rep.update(c=sync.c, spread=sync.spread_s, ok=sync.ok, reason=sync.reason)
    if not sync.ok:
        os.remove(path)
    return rep


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--match", required=True)
    args = ap.parse_args()
    for mext in args.match.split(","):
        m = safe_select("matches", "id", external_id=mext)
        if not m:
            print(mext, "match introuvable")
            continue
        games = safe_select("games", "id,external_id,game_number,vod_youtube_id,vod_offset_seconds",
                            match_id=m[0]["id"]) or []
        for g in sorted(games, key=lambda g: g["game_number"] or 0):
            print(mext, json.dumps(await prepare(g), ensure_ascii=False), flush=True)


if __name__ == "__main__":
    asyncio.run(main())
