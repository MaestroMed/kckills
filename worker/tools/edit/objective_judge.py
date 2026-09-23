# -*- coding: utf-8 -*-
"""
OBJECTIVE JUDGE v3 (2026-09-23) — juge les « moments » hors kills détectés
dans les stats (objectifs, swings de gold, rafales de kills, survies à 1 HP,
multi-kills confirmés par le feed) sur les VODs Twitch officielles LEC.

v2 découpait des sections YouTube puis vérifiait la synchro en lisant le
chrono (YouTube bloque maintenant l'IP, et les co-streams dérivaient après
chaque pause). v3 passe par modules/twitch_sync : la section 1080p60 de la
game est calée une fois pour toutes (c mesuré par lecture du chrono), et
tout instant réel E du feed tombe exactement à `sync.file_pos(E)`. Les
segments sont coupés en local (ffmpeg, 60 i/s conservés pour les ralentis),
puis jugés par Gemini 3.8 Flash.

Entrées (workspace D:/kckills_worker/edit_summer) :
  objectives.jsonl, hp_events.jsonl, multikills.jsonl (t = secondes réelles
  depuis la 1re frame de la game = FeedClock.anchor_ms)
Sortie : objectives_judged_v3.jsonl (une ligne par segment, clip 16:9 local)

Usage :
  python tools/edit/objective_judge.py [--limit 80] [--per-game 8] [--match <ids>]
                                       [--types baron,soul,...] [--only-cached] [--kills]
  --only-cached : ne juge que les games dont la section Twitch est déjà calée
                  (utile pendant qu'un twitch_backfill tourne en parallèle)
  --kills       : juge AUSSI les kills KC marquants (séries, first blood, gros
                  score, shutdown) découpés dans la même section 1080p60, à
                  l'instant exact du feed — multikills.jsonl n'est alors plus lu
                  (les libellés en base sont réconciliés avec le feed)
"""
from __future__ import annotations

import argparse
import asyncio
import io
import json
import os
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
os.chdir(str(Path(__file__).resolve().parents[2]))
from dotenv import load_dotenv  # noqa: E402

load_dotenv()
from modules import feed_clock, twitch_sync  # noqa: E402
from services import gemini_client  # noqa: E402
from services.ai_pricing import compute_gemini_cost  # noqa: E402

WS = r"D:\kckills_worker\edit_summer"
EVENTS = [os.path.join(WS, "objectives.jsonl"), os.path.join(WS, "hp_events.jsonl")]
MULTIKILLS = os.path.join(WS, "multikills.jsonl")
OUT = os.path.join(WS, "objectives_judged_v3.jsonl")
CLIPS = os.path.join(WS, "obj_v3")
# fenêtre (avant, après) autour de l'instant détecté dans les stats
WIN = {"kill": (10, 5), "multikill": (20, 8), "baron": (28, 12), "elder": (28, 12), "soul": (28, 12), "dragon": (26, 10),
       "kill_burst": (22, 10), "gold_swing": (28, 10), "low_hp_survival": (14, 10), "low_hp_kill": (14, 10)}
PRIO = {"kill": 3, "multikill": 6, "soul": 5, "elder": 5, "baron": 4, "low_hp_survival": 4, "low_hp_kill": 3,
        "kill_burst": 3, "gold_swing": 2, "dragon": 1}
MULTI_TAG = {"penta": "PENTAKILL", "quadra": "QUADRA", "triple": "TRIPLE", "double": "DOUBLE"}
MULTI_FLOOR = {"penta": 9.3, "quadra": 8.6, "triple": 7.2}
GAMES_FILE = os.path.join(WS, "objectives_games.json")
TAGS = {"outplay": "OUTPLAY", "solo_kill": "SOLO KILL", "steal": "STEAL", "clutch_objective": "CLUTCH", "teamfight_turnaround": "RETOURNEMENT", "ace": "ACE",
        "engage": "ENGAGE", "defense": "DEFENSE", "escape": "ESCAPE", "low_hp_kill": "KILL A 1 HP"}

PROMPT = """Tu es un monteur esport. Ce segment (~{dur} s, 16:9, 60 i/s) d'un match pro League of Legends encadre un MOMENT
détecté dans les stats : {what}. L'équipe suivie est la Karmine Corp (KC).
Juge le moment comme un chasseur de highlights TikTok : STEAL d'objectif (smite volé), objectif clutch sous
pression, retournement de teamfight, engage parfait, ace, défense héroïque, ESCAPE à 1 HP / outplay de survie,
kill à 1 HP, multi-kill ? Ou routine (objectif pris tranquillement, poke, rien de visuel) ?
Réponds UNIQUEMENT en JSON valide :
{{
  "gameplay_visible": <bool, false si plateau/casters/replay/écran de fin>,
  "spectacle_score": <float 1-10, 9-10 = moment de saison>,
  "kind": "<steal|clutch_objective|teamfight_turnaround|ace|engage|defense|escape|low_hp_kill|multikill|outplay|solo_kill|routine>",
  "actor": "<pseudo KC clé, ex: Yike>",
  "peak_seconds": <float, seconde du pic dans le segment>,
  "punch_seconds": <float, l'instant exact de l'impact (smite, kill décisif, flash de survie)>,
  "hype_fr": "<max 60 caractères, titre TikTok, sans emoji>",
  "why": "<max 100 caractères>"
}}"""


def load_events(types: set[str] | None, only_matches: set[str] | None, min_swing: int,
                use_multikill_file: bool = True, extra: list[dict] | None = None) -> list[dict]:
    events: list[dict] = []
    for path in EVENTS:
        if os.path.exists(path):
            events += [json.loads(line) for line in io.open(path, encoding="utf-8") if line.strip()]
    if use_multikill_file and os.path.exists(MULTIKILLS):
        for line in io.open(MULTIKILLS, encoding="utf-8"):
            if not line.strip():
                continue
            m = json.loads(line)
            if m.get("side") != "kc" or m.get("count", 0) < 3:
                continue
            events.append({"t": int(m["t_last"]), "type": "multikill", "side": "kc", "n": m["count"],
                           "detail": f"{m['count']} kills de {m['player']} ({m['champion']})",
                           "actor": m["player"], "match": m["match"], "match_ext": m["match_ext"],
                           "game_number": m["game_number"], "game_ext": m["game_ext"]})
    keep = []
    for e in events:
        if e.get("side") != "kc" or (only_matches and e["match_ext"] not in only_matches):
            continue
        if types and e["type"] not in types:
            continue
        if e["type"] in ("kill", "multikill", "baron", "elder", "soul", "low_hp_survival", "low_hp_kill"):
            keep.append(e)
        elif e["type"] == "gold_swing" and e.get("n", 0) >= min_swing:
            keep.append(e)
        elif e["type"] == "kill_burst" and int(str(e.get("detail", "0")).strip("+") or 0) >= 3:
            keep.append(e)
    keep += [e for e in (extra or []) if (not only_matches or e["match_ext"] in only_matches)
             and (not types or e["type"] in types)]
    # un moment = un fight : on fusionne les événements à < 30 s, le plus prioritaire gagne
    keep.sort(key=lambda e: (e["game_ext"], e["t"]))
    merged: list[dict] = []
    for e in keep:
        if merged and merged[-1]["game_ext"] == e["game_ext"] and e["t"] - merged[-1]["t"] < 30:
            if PRIO.get(e["type"], 0) > PRIO.get(merged[-1]["type"], 0):
                merged[-1] = e
            continue
        merged.append(e)
    return merged


def load_kill_events() -> list[dict]:
    """Kills KC marquants des games du Summer (objectives_games.json) : séries,
    first blood, score ≥ 7,5, shutdown ≥ 700. Instant exact = event_epoch."""
    from modules.twitch_source import sequence_start_ms
    from services.supabase_client import get_db

    if not os.path.exists(GAMES_FILE):
        return []
    games = {g["game_ext"]: g for g in json.load(io.open(GAMES_FILE, encoding="utf-8"))}
    db = get_db()
    client = db._get_client()
    rows = []
    exts = list(games)
    for i in range(0, len(exts), 40):
        r = client.get(f"{db.base}/games", params={"select": "id,external_id",
                                                     "external_id": f"in.({','.join(exts[i:i + 40])})"})
        rows += r.json() or []
    out: list[dict] = []
    for g in rows:
        clock = feed_clock.load_clock(g["external_id"])
        if not clock:
            continue
        ks = client.get(f"{db.base}/kills", params={
            "select": "id,event_epoch,killer_champion,victim_champion,multi_kill,is_first_blood,highlight_score,"
                      "shutdown_bounty,tracked_team_involvement,status,killer:players!kills_killer_player_id_fkey(ign)",
            "game_id": f"eq.{g['id']}", "status": "neq.duplicate"}).json() or []
        meta = games[g["external_id"]]
        for k in ks:
            if k.get("tracked_team_involvement") != "team_killer" or not k.get("event_epoch"):
                continue
            multi = k.get("multi_kill")
            notable = (multi in MULTI_TAG or k.get("is_first_blood") or (k.get("highlight_score") or 0) >= 7.5
                       or (k.get("shutdown_bounty") or 0) >= 700)
            if not notable:
                continue
            ign = ((k.get("killer") or {}).get("ign") or "").strip()
            span_s = (int(k["event_epoch"]) - sequence_start_ms(k, ks)) / 1000.0
            out.append({
                "t": round((int(k["event_epoch"]) - clock.anchor_ms) / 1000), "epoch": int(k["event_epoch"]),
                "type": "multikill" if multi in ("triple", "quadra", "penta") else "kill", "side": "kc",
                "kill_id": k["id"], "multi": multi, "first_blood": bool(k.get("is_first_blood")),
                "n": {"penta": 5, "quadra": 4, "triple": 3, "double": 2}.get(multi or "", 1),
                "pre": max(10, int(span_s) + 7),
                "actor": ign or k.get("killer_champion"),
                "detail": f"{ign or 'KC'} ({k.get('killer_champion')}) sur {k.get('victim_champion')}",
                "match": meta["match"], "match_ext": meta["match_ext"], "game_number": meta["game_number"],
                "game_ext": g["external_id"],
            })
    return out


def _calibrated(game_ext: str) -> bool:
    """Section Twitch déjà téléchargée ET calée (ok) pour cette game."""
    from services.local_paths import LocalPaths

    for meta in Path(LocalPaths.vods_dir()).glob(f"twitch_*_{game_ext}.mp4.sync.json"):
        try:
            if json.loads(meta.read_text(encoding="utf-8")).get("ok") and Path(str(meta)[:-10]).exists():
                return True
        except (OSError, ValueError):
            pass
    return False


def cut_local(section: str, start: float, dur: float, dest: str) -> bool:
    """Segment exact depuis la section locale (ré-encodé NVENC, 60 i/s gardés)."""
    if os.path.exists(dest) and os.path.getsize(dest) > 300_000:
        return True
    r = subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-ss", f"{max(0.0, start):.2f}", "-i", section, "-t", f"{dur:.2f}",
         "-c:v", "h264_nvenc", "-preset", "p5", "-cq", "18", "-c:a", "aac", "-b:a", "192k",
         "-movflags", "+faststart", dest],
        capture_output=True, timeout=300,
    )
    return r.returncode == 0 and os.path.exists(dest)


JUDGE_MODEL = "gemini-3.8-flash"


async def judge(clip: str, what: str, dur: float) -> tuple[dict, float]:
    res = await gemini_client.analyze(PROMPT.format(what=what, dur=int(dur)), video_path=clip,
                                      model=JUDGE_MODEL, thinking_budget="low")
    if isinstance(res, list):
        res = next((x for x in res if isinstance(x, dict)), {})
    usage = (res or {}).pop("_usage", {}) if isinstance(res, dict) else {}
    cost = compute_gemini_cost(JUDGE_MODEL, usage.get("prompt_tokens"), usage.get("candidates_tokens")) or 0.0
    return (res or {}), cost


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--min-swing", type=int, default=3000)
    ap.add_argument("--limit", type=int, default=80)
    ap.add_argument("--per-game", type=int, default=8)
    ap.add_argument("--match", default=None)
    ap.add_argument("--types", default=None)
    ap.add_argument("--only-cached", action="store_true")
    ap.add_argument("--kills", action="store_true", help="juge aussi les kills KC marquants")
    a = ap.parse_args()
    os.makedirs(CLIPS, exist_ok=True)
    kill_events = load_kill_events() if a.kills else []
    events = load_events(set(a.types.split(",")) if a.types else None,
                         set(a.match.split(",")) if a.match else None, a.min_swing,
                         use_multikill_file=not a.kills, extra=kill_events)
    by_game: dict[str, list[dict]] = {}
    for e in events:
        by_game.setdefault(e["game_ext"], []).append(e)
    done = set()
    if os.path.exists(OUT):
        for line in io.open(OUT, encoding="utf-8"):
            try:
                done.add(json.loads(line)["id"])
            except (ValueError, KeyError):
                pass
    print(f"{len(events)} moments KC sur {len(by_game)} games", flush=True)
    cost, n = 0.0, 0
    with io.open(OUT, "a", encoding="utf-8") as out:
        for gext, evs in sorted(by_game.items()):
            if n >= a.limit:
                break
            if a.only_cached and not _calibrated(gext):
                continue                      # section pas encore calée par le backfill
            clock = feed_clock.load_clock(gext) if a.only_cached else await feed_clock.get_clock(gext)
            if not clock:
                print(f"  {gext} : pas d'horloge feed", flush=True)
                continue
            section = await twitch_sync.prepare_game_section(clock)
            if not section:
                print(f"  {gext} : section Twitch indisponible", flush=True)
                continue
            evs.sort(key=lambda e: (-PRIO.get(e["type"], 0), e["t"]))
            for e in evs[:a.per_game]:
                if n >= a.limit:
                    break
                eid = e.get("kill_id") or f"{gext}_{e['t']}"
                if eid in done:
                    continue
                pre, post = WIN.get(e["type"], (24, 10))
                if e.get("kill_id"):
                    pre = max(pre, int(e.get("pre") or pre))
                epoch = int(e.get("epoch") or clock.anchor_ms + int(e["t"]) * 1000)
                pos = section.sync.file_pos(epoch, clock)
                ig = int(clock.ingame_seconds(epoch))
                if e.get("kill_id"):
                    what = (f"kill de {e.get('detail', '')} au chrono {ig // 60}:{ig % 60:02d}"
                            f"{' — ' + MULTI_TAG[e['multi']] if e.get('multi') in MULTI_TAG else ''}"
                            f"{' — first blood' if e.get('first_blood') else ''}")
                else:
                    what = (f"{e['type']} pour KC au chrono {ig // 60}:{ig % 60:02d} ({e.get('detail', '')}"
                            f"{' — ' + e['actor'] if e.get('actor') else ''})")
                dest = os.path.join(CLIPS, f"{eid}.mp4")
                t0 = time.time()
                if not cut_local(section.path, pos - pre, pre + post, dest):
                    print(f"  échec découpe {e['match']} G{e['game_number']} {what}", flush=True)
                    continue
                d, c = await judge(dest, what, pre + post)
                cost += c
                if e.get("kill_id"):
                    # kill : pseudo en base (le juge peut citer un coéquipier), palier du feed
                    label = (e.get("actor") or d.get("actor") or "KC").replace("KC ", "").upper()
                    tag = (MULTI_TAG.get(e.get("multi") or "") or ("FIRST BLOOD" if e.get("first_blood") else "")
                           or TAGS.get(d.get("kind"), "KILL"))
                    floor = MULTI_FLOOR.get(e.get("multi") or "")
                    if floor and isinstance(d, dict):
                        d["spectacle_score"] = max(float(d.get("spectacle_score") or 0), floor)
                        d["gameplay_visible"] = True if d.get("gameplay_visible") is None else d["gameplay_visible"]
                else:
                    label = (d.get("actor") or e.get("actor") or "KC").replace("KC ", "").upper()
                    tag = ({5: "PENTAKILL", 4: "QUADRA", 3: "TRIPLE"}.get(min(int(e.get("n", 0)), 5), "MULTI")
                           if e["type"] == "multikill" else TAGS.get(d.get("kind"), "OBJECTIF"))
                rec = {"id": eid, "kill_id": e.get("kill_id"), "match": e["match"], "match_ext": e["match_ext"],
                       "game_number": e["game_number"],
                       "game_ext": gext, "t": e["t"], "ingame": ig, "type": e["type"], "detail": e.get("detail", ""),
                       "clip": dest, "aspect": "16:9", "fps": 60, "source": f"twitch:{section.vod_id}",
                       "label": label, "tag": tag, "judge": d}
                out.write(json.dumps(rec, ensure_ascii=False) + "\n")
                out.flush()
                n += 1
                print(f"  {e['match']} G{e['game_number']} {ig // 60}:{ig % 60:02d} {e['type']:16} -> "
                      f"{d.get('spectacle_score')} {d.get('kind')} @{d.get('punch_seconds')}s — {d.get('hype_fr')} "
                      f"[{time.time() - t0:.0f}s]", flush=True)
    print(f"jugés : {n} | coût ${cost:.3f}", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
