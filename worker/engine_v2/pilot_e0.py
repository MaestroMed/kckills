"""Pilote E0 du moteur v2 — KC 3-2 C9, Worlds 2026 Play-Ins (15/10/2026).

Rejoue toute la chaîne sur les VOD HD locales de LoLscan, sans rien écrire
en base :
  1. kills officiels (feed live stats, harvester sans base)       → riot.py
  2. carte fichier ↔ chrono lue à l'écran (0 jeton)               → clockmap.py
  3. morts lues dans le HUD, vérification de chaque kill           → hud_deaths.py, verify.py
  4. clips verticaux cadrés par la caméra LoLscan, NVENC          → render.py
Sorties : D:/kckills_worker/engine_v2/pilot_e0/ (rapport.json + clips).

Usage : python -m engine_v2.pilot_e0 [--render N]   (N clips KC à rendre)
Les étapes coûteuses sont mises en cache dans le dossier de sortie.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import statistics

import numpy as np

from engine_v2 import clockmap as M
from engine_v2 import hud_deaths as H
from engine_v2 import riot, verify
from engine_v2.clockmap import ClockMap, Segment

OUT = "D:/kckills_worker/engine_v2/pilot_e0"
FILES = {"4": "E:/KCDS/vod_kc_c9/hd/full_15290.mp4", "5": "E:/KCDS/vod_kc_c9/hd/full_19000.mp4"}


def _cached_json(path, build):
    if os.path.exists(path):
        return json.load(open(path, encoding="utf-8"))
    data = build()
    json.dump(data, open(path, "w", encoding="utf-8"), indent=1, default=str)
    return data


def main(render: int = 0) -> dict:
    os.makedirs(OUT, exist_ok=True)

    async def fetch():
        ev = await riot.find_match("worlds", "2026-10-15", {"KC", "C9"})
        games = await riot.games_of(ev["match"]["id"])
        kills = {}
        for g in games:
            if str(g["number"]) in FILES:
                kills[str(g["number"])] = await riot.game_kills(g["id"])
        return {"match": ev["match"]["id"], "games": games, "kills": kills}

    rd = _cached_json(f"{OUT}/riot_kc_c9.json", lambda: asyncio.run(fetch()))
    report = {"match": rd["match"], "games": {}}

    for g, video in FILES.items():
        name = os.path.splitext(os.path.basename(video))[0]
        cj = _cached_json(f"{OUT}/clock_{name}.json", lambda: {**M.build(video).to_json(), "raw": []})
        cm = ClockMap(video=video, step=cj["step"])
        cm.segments = [Segment(**s) for s in cj["segments"]]
        npz = f"{OUT}/hud_{name}.npz"
        if not os.path.exists(npz):
            T, S = H.series(video, 0, 4000, 1.0)
            np.savez(npz, T=T, S=S)
        z = np.load(npz)
        res = verify.check(rd["kills"][g], cm, H.deaths(z["T"], z["S"]))
        seen = [r["delta_s"] for r in res if r["seen"]]
        shift = statistics.median(seen) if seen else 0.0
        for r in res:
            r["screen_pos"] = round(r["file_pos"] + shift, 1) if r["file_pos"] is not None else None
        report["games"][g] = {
            "video": video,
            "kills": len(res),
            "seen_on_screen": len(seen),
            "feed_to_screen_shift_s": shift,
            "pauses": cj.get("pauses", []),
            "chrono_reads": cj.get("reads"),
            "chrono_unreadable": cj.get("unreadable"),
            "rows": res,
        }

    if render:
        from engine_v2.render import render_vertical

        done = 0
        for g, info in report["games"].items():
            for r in info["rows"]:
                if done >= render or not r["seen"] or not (r["killer"] or "").startswith("KC "):
                    continue
                out = f"{OUT}/clip_G{g}_{r['chrono']}_v.mp4"
                if not os.path.exists(out):
                    render_vertical(info["video"], r["screen_pos"] - 9, r["screen_pos"] + 4, out)
                r["clip"] = out
                done += 1

    json.dump(report, open(f"{OUT}/rapport.json", "w", encoding="utf-8"), indent=1)
    return report


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--render", type=int, default=0)
    rep = main(ap.parse_args().render)
    for g, i in rep["games"].items():
        print(f"G{g} : {i['seen_on_screen']}/{i['kills']} kills vus à l'écran, décalage feed->écran {i['feed_to_screen_shift_s']} s, pauses {i['pauses']}")
