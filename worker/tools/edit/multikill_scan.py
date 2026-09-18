# -*- coding: utf-8 -*-
"""
MULTIKILL SCAN — vrais multi-kills depuis le feed livestats (frames 1 s) :
un joueur enchaîne k kills avec <= 10 s entre deux kills consécutifs (règle LoL).
Les deux camps sont scannés (un penta ADVERSE contre KC est aussi un moment).
Sortie : multikills.jsonl {game_ext, match, game_number, side (kc|opp), player,
champion, count, t_first, t_last, kills: [t...]}
Usage : python multikill_scan.py [--min 3] [--match <ext_id,...>]
"""
import argparse, asyncio, io, json
from datetime import datetime, timedelta
import httpx

MATCHES = [
    ("2026-07-24 VIT", "115548681803406199"), ("2026-07-25 MKOI", "115548681803406271"), ("2026-07-26 G2", "115548681803406287"),
    ("2026-08-01 NAVI", "115548681803406171"), ("2026-08-03 TH", "115548681803406139"), ("2026-08-09 FNC", "115548681803406279"),
    ("2026-08-17 GX", "115548681803406243"), ("2026-08-23 SHFT", "115548681803406223"), ("2026-08-29 SK", "115548681803406259"),
    ("2026-09-05 GX PO", "115548681803406291"), ("2026-09-06 G2 PO", "115548681803406303"),
]
OUT = r"D:\kckills_worker\edit_summer\multikills.jsonl"
BASE = "https://feed.lolesports.com/livestats/v1/window/"
STEP, GAP = 40, 10.5


def iso(dt):
    dt = dt.replace(microsecond=0)
    dt = dt - timedelta(seconds=dt.second % 10)
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


async def probe(client, gid, ts=None):
    try:
        r = await client.get(BASE + gid, params={"startingTime": ts} if ts else None, timeout=20)
        if r.status_code != 200 or not r.content:
            return None
        return r.json()
    except Exception:
        return None


def pts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


async def scan_game(client, label, match_ext, gnum, gid, out, kmin):
    first = await probe(client, gid)
    if not first or not first.get("frames"):
        return None
    meta = first.get("gameMetadata") or {}
    bm = (meta.get("blueTeamMetadata") or {}).get("participantMetadata") or []
    rm = (meta.get("redTeamMetadata") or {}).get("participantMetadata") or []
    kc_side = "blue" if any(str(p.get("summonerName", "")).upper().startswith("KC ") for p in bm) else "red"
    names = {p["participantId"]: (p.get("summonerName", ""), p.get("championId", ""), "blue" if p in bm else "red") for p in (bm + rm)}
    anchor = pts(first["frames"][0]["rfc460Timestamp"])
    last_kills = {}      # pid -> kills count
    runs = {}            # pid -> list of kill times (run courant)
    found, t, misses, state = [], anchor, 0, None

    def handle(fr):
        nonlocal state
        state = fr.get("gameState")
        tg = (pts(fr["rfc460Timestamp"]) - anchor).total_seconds()
        for team in ("blueTeam", "redTeam"):
            for p in (fr.get(team) or {}).get("participants") or []:
                pid, k = p["participantId"], p.get("kills") or 0
                prev = last_kills.get(pid)
                if prev is not None and k > prev:
                    run = runs.setdefault(pid, [])
                    if run and tg - run[-1] > GAP:
                        if len(run) >= kmin:
                            found.append((pid, list(run)))
                        run.clear()
                    run.extend([tg] * (k - prev))
                last_kills[pid] = k

    for fr in first["frames"]:
        handle(fr)
    while misses < 3 and (t - anchor) < timedelta(minutes=70):
        t += timedelta(seconds=STEP)
        w = await probe(client, gid, iso(t))
        await asyncio.sleep(0.4)
        if not w or not w.get("frames"):
            misses += 1
            continue
        misses = 0
        for fr in w["frames"]:
            handle(fr)
        if state == "finished":
            break
    for pid, run in runs.items():
        if len(run) >= kmin:
            found.append((pid, list(run)))
    n = 0
    for pid, run in found:
        nm, champ, side = names[pid]
        rec = {"game_ext": gid, "match": label, "match_ext": match_ext, "game_number": gnum, "side": "kc" if side == kc_side else "opp",
               "player": nm, "champion": champ, "count": len(run), "t_first": round(run[0]), "t_last": round(run[-1]), "kills": [round(x) for x in run]}
        out.write(json.dumps(rec, ensure_ascii=False) + "\n")
        n += 1
        tag = {3: "TRIPLE", 4: "QUADRA", 5: "PENTA"}.get(min(len(run), 5), "MULTI")
        print(f"  {label} G{gnum} {tag} {nm} ({champ}) T+{round(run[0])//60}:{round(run[0])%60:02d} -> T+{round(run[-1])//60}:{round(run[-1])%60:02d} x{len(run)}", flush=True)
    out.flush()
    print(f"{label} G{gnum} : {n} multi-kills", flush=True)
    return True


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--min", type=int, default=3)
    ap.add_argument("--match", default=None)
    a = ap.parse_args()
    only = set(a.match.split(",")) if a.match else None
    out = io.open(OUT, "a" if only else "w", encoding="utf-8")
    async with httpx.AsyncClient(headers={"User-Agent": "Mozilla/5.0"}) as client:
        for label, mext in MATCHES:
            if only and mext not in only:
                continue
            base, gnum = int(mext), 0
            for k in range(1, 6):
                gid = str(base + k)
                gnum += 1
                ok = await scan_game(client, label, mext, gnum, gid, out, a.min)
                if ok is None:
                    if k >= 3:
                        break
                    continue
    out.close()
    print("MULTIKILL SCAN TERMINÉ")

asyncio.run(main())
