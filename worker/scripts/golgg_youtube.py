"""golgg_youtube.py — clippe les kills gol.gg seuls (sans horloge feed) depuis YouTube.

Pour une game gol.gg : télécharge la VOD YouTube (cookies Firefox), lit le
chrono in-game toutes les STEP_S secondes (lecteurs locaux engine_v2), garde
le segment dont le chrono max colle à games.duration_seconds, puis place
chaque kill à la position où le chrono affiche son game_time (les pauses sont
absorbées : on part de l'échantillon le plus proche avant le kill). Le clip,
les portes QC et la publication sont ceux de twitch_backfill.clip_one.

  python scripts/golgg_youtube.py --game golgg_game_78398 --vod JhzqXwQKGxc [--apply]
  (--vod facultatif si games.vod_youtube_id est rempli ; --start/--end pour
   ne télécharger qu'une fenêtre de la VOD, en secondes)
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT))
sys.path.insert(0, str(_ROOT / "scripts"))
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
from dotenv import load_dotenv  # noqa: E402
load_dotenv(_ROOT / ".env")

import twitch_backfill as tb  # noqa: E402
from modules import feed_clock, twitch_sync  # noqa: E402
from services import youtube_cookies  # noqa: E402
from services.local_paths import LocalPaths  # noqa: E402
from services.supabase_client import safe_select, safe_update  # noqa: E402
from services.twitch_vod import _ytdlp  # noqa: E402

STEP_S = 15
TODO = tb.MISSING_STATUSES | tb.REVIEW_STATUSES


def segments(samples: list[tuple[float, int]]) -> list[list[tuple[float, int]]]:
    """Coupe la suite (pos, chrono) en games : un chrono qui recule de >60 s = nouvelle game."""
    segs: list[list[tuple[float, int]]] = []
    for pos, t in samples:
        if segs and t >= segs[-1][-1][1] - 60:
            segs[-1].append((pos, t))
        else:
            segs.append([(pos, t)])
    return [s for s in segs if len(s) >= 10]


def locate(seg: list[tuple[float, int]], kt: int) -> float:
    """Position fichier où le chrono affiche kt (dernier échantillon <= kt + écart)."""
    before = [(p, t) for p, t in seg if t <= kt]
    p, t = before[-1] if before else seg[0]
    return p + (kt - t)


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--game", required=True)
    ap.add_argument("--vod", default="")
    ap.add_argument("--start", type=int, default=0)
    ap.add_argument("--end", type=int, default=0)
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()

    g = safe_select("games", "id,external_id,game_number,duration_seconds,vod_youtube_id", external_id=a.game)[0]
    vid = a.vod or g["vod_youtube_id"]
    kills = [k for k in (safe_select("kills", tb.KILL_COLS, game_id=g["id"]) or [])
             if k["status"] != "duplicate" and k.get("game_time_seconds") is not None]
    targets = [k for k in kills if k["status"] in TODO]
    print(a.game, "VOD", vid, "kills", len(kills), "à clipper", len(targets), flush=True)
    if not targets:
        return

    path = os.path.join(LocalPaths.vods_dir(), f"golgg_{vid}_{a.start}.mp4")
    if not os.path.exists(path):
        sect = ["--download-sections", f"*{a.start}-{a.end}"] if a.end else []
        rc, _o, err = await _ytdlp(*youtube_cookies.cli_args(), "-f", "bv*[height<=1080]+ba/b[height<=1080]",
                                   "--merge-output-format", "mp4", "--concurrent-fragments", "8", *sect,
                                   "-o", path, f"https://www.youtube.com/watch?v={vid}", timeout=5400)
        if rc != 0 or not os.path.exists(path):
            print("téléchargement raté", err[-400:])
            return

    dur = twitch_sync.media_duration(path)
    samples = []
    for i in range(int(dur // STEP_S)):
        t = await asyncio.to_thread(twitch_sync._read_timer_local, path, i * STEP_S)
        if t is not None:
            samples.append((float(i * STEP_S), t))
    segs = segments(samples)
    print("lectures", len(samples), "segments", [(round(s[0][0]), s[-1][1]) for s in segs], flush=True)
    want = int(g["duration_seconds"] or 0)
    segs = [s for s in segs if abs(s[-1][1] - want) <= 45]
    if len(segs) != 1:
        print(f"segment ambigu ou absent (durée cherchée {want}s) : {len(segs)}")
        return
    seg = segs[0]
    start_pos = locate(seg, 0)
    print("game trouvée, chrono 0 à", round(start_pos), "s du fichier", flush=True)
    if not a.apply:
        return
    safe_update("games", {"vod_youtube_id": vid, "vod_offset_seconds": int(a.start + start_pos)}, "id", g["id"])

    # Horloge fictive : epoch = game_time en ms, ancre 0, sans pause ; la
    # position fichier de chaque kill passe par sync.c = pos - game_time.
    clock = feed_clock.FeedClock(game_ext_id=a.game, anchor_ms=0)
    fake = [{**k, "event_epoch": int(k["game_time_seconds"]) * 1000} for k in kills]
    outcomes: dict[str, int] = {}
    for k in fake:
        if k["status"] not in TODO:
            continue
        kt = int(k["game_time_seconds"])
        sync = twitch_sync.SectionSync(path=path, c=locate(seg, kt) - kt, ok=True)
        try:
            res = await tb.clip_one(k, g, clock, sync, f"yt-{vid}", fake, apply=True)
        except Exception as e:  # un kill raté ne bloque pas les autres
            res = f"exception {str(e)[:120]}"
        outcomes[res] = outcomes.get(res, 0) + 1
        print("kill", k["id"][:8], kt, res, flush=True)
    print("BILAN", json.dumps(outcomes, ensure_ascii=False))
    os.remove(path)


if __name__ == "__main__":
    # selftest segments/locate
    s = segments([(i * 15.0, i * 15) for i in range(20)] + [(400.0, 5)] + [(400 + i * 15.0, 5 + i * 15) for i in range(1, 12)])
    assert len(s) == 2 and abs(locate(s[0], 100) - 100) < 1e-6
    asyncio.run(main())
