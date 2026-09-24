# -*- coding: utf-8 -*-
"""
CONVERT_GAME_TIME_CHRONO — kills.game_time_seconds passe du temps réel depuis
la 1re frame du feed au CHRONO affiché en jeu (pauses déduites).

Depuis le 23/09/2026, le harvester écrit le chrono dès que l'horloge de la
game est complète (harvester.apply_game_time). Ce script aligne les kills
déjà en base, pour toute game dont l'horloge complète est en cache
(D:/kckills_worker/feed_clock/) : game_time_seconds, et les deux champs qui
en dérivent (game_minute_bucket, lane_phase — mêmes formules que
KillEvent.to_db_dict).

Sans pause, chrono et temps réel coïncident : rien ne change. Après une
pause, le site affichait jusqu'à 5 min 30 de trop (penta de Canna « T+40:09 »
pour 34:37 de chrono).

--build-missing : construit l'horloge des games récentes qui n'en ont pas
(parcours du feed, ~5 min par game) avant de convertir.

Usage :
  python scripts/convert_game_time_chrono.py                 # rapport
  python scripts/convert_game_time_chrono.py --apply
  python scripts/convert_game_time_chrono.py --build-missing --since 2026-01-01 --apply
"""
from __future__ import annotations

import argparse
import asyncio
import glob
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("KCKILLS_LIVESTATS_DELAY", "0.5")
from dotenv import load_dotenv  # noqa: E402

load_dotenv()
from models.kill_event import lane_phase_from_seconds, minute_bucket_from_seconds  # noqa: E402
from modules import feed_clock  # noqa: E402
from services.supabase_client import get_db  # noqa: E402

REPORT = Path(r"D:\kckills_worker\convert_game_time")


def fetch_all(db, table: str, params: dict) -> list[dict]:
    client, rows, off = db._get_client(), [], 0
    while True:
        r = client.get(f"{db.base}/{table}", params={**params, "limit": "1000", "offset": str(off)})
        r.raise_for_status()
        page = r.json() or []
        rows += page
        if len(page) < 1000:
            return rows
        off += 1000


async def build_missing(db, since: str) -> int:
    """Horloges des games récentes (id numérique lolesports) sans cache."""
    games = fetch_all(db, "games", {"select": "external_id,created_at", "created_at": f"gte.{since}"})
    built = 0
    for g in games:
        ext = g.get("external_id") or ""
        if not ext.isdigit() or feed_clock.load_clock(ext):
            continue
        clock = await feed_clock.build_clock(ext)
        if clock and clock.end_ms:
            built += 1
            print(f"  horloge {ext} : {len(clock.pauses)} pause(s), {round(clock.total_paused_s)} s", flush=True)
    return built


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--build-missing", action="store_true")
    ap.add_argument("--since", default="2026-01-01")
    args = ap.parse_args()
    db = get_db()
    client = db._get_client()
    if args.build_missing:
        print("horloges construites :", asyncio.run(build_missing(db, args.since)), flush=True)

    clocks = {}
    for p in glob.glob(os.path.join(feed_clock.CLOCK_DIR, "*.json")):
        c = feed_clock.load_clock(Path(p).stem)
        if c:
            clocks[c.game_ext_id] = c
    games = {}
    ext_list = list(clocks)
    for i in range(0, len(ext_list), 80):
        chunk = ext_list[i:i + 80]
        for g in fetch_all(db, "games", {"select": "id,external_id", "external_id": f"in.({','.join(chunk)})"}):
            games[g["id"]] = g["external_id"]
    changes, max_shift = [], 0
    for gid, ext in games.items():
        clock = clocks[ext]
        for k in fetch_all(db, "kills", {"select": "id,event_epoch,game_time_seconds", "game_id": f"eq.{gid}"}):
            epoch = k.get("event_epoch") or 0
            if epoch <= 0:
                continue
            chrono = int(clock.ingame_seconds(int(epoch)))
            if chrono != k.get("game_time_seconds"):
                changes.append({"id": k["id"], "game": ext, "before": k.get("game_time_seconds"), "after": chrono})
                max_shift = max(max_shift, abs((k.get("game_time_seconds") or 0) - chrono))
    paused_games = sorted({c["game"] for c in changes if abs((c["before"] or 0) - c["after"]) > 2})
    REPORT.mkdir(parents=True, exist_ok=True)
    path = REPORT / f"report_{time.strftime('%Y%m%d_%H%M%S')}.json"
    path.write_text(json.dumps({"apply": args.apply, "clocks": len(clocks), "games": len(games),
                                "changes": changes}, indent=1), encoding="utf-8")
    print(f"horloges {len(clocks)} | games {len(games)} | kills à corriger {len(changes)} "
          f"(écart max {max_shift} s ; games avec pause : {len(paused_games)}) -> {path}", flush=True)
    if not args.apply:
        return
    done = 0
    for c in changes:
        body = {"game_time_seconds": c["after"], "game_minute_bucket": minute_bucket_from_seconds(c["after"]),
                "lane_phase": lane_phase_from_seconds(c["after"])}
        r = client.patch(f"{db.base}/kills", params={"id": f"eq.{c['id']}"}, json=body,
                         headers={**db.headers, "Prefer": "return=minimal"})
        if r.status_code < 400:
            done += 1
    print(f"appliqué : {done}/{len(changes)}", flush=True)


if __name__ == "__main__":
    main()
