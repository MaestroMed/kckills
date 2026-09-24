# -*- coding: utf-8 -*-
"""
OBJECTIVE SCANNER (stage 1) — timeline des objectifs + swings de gold par game
depuis le feed livestats (public, historique servi pour 2026).
Sortie : objectives.jsonl (1 événement par ligne) + objectives_games.json (ancres/side KC).
Événements : dragon (élément, soul au 4e), elder, baron, inhibitor, tower, gold_swing (>= 2500 en 40 s).
"""
import asyncio, io, json, os, sys, urllib.request
from datetime import datetime, timedelta, timezone
import httpx

MATCHES = [
    ("2026-07-24 VIT", "115548681803406199"), ("2026-07-25 MKOI", "115548681803406271"), ("2026-07-26 G2", "115548681803406287"),
    ("2026-08-01 NAVI", "115548681803406171"), ("2026-08-03 TH", "115548681803406139"), ("2026-08-09 FNC", "115548681803406279"),
    ("2026-08-17 GX", "115548681803406243"), ("2026-08-23 SHFT", "115548681803406223"), ("2026-08-29 SK", "115548681803406259"),
    ("2026-09-05 GX PO", "115548681803406291"), ("2026-09-06 G2 PO", "115548681803406303"),
]
OUT = r"D:\kckills_worker\edit_summer\objectives.jsonl"
GAMES_OUT = r"D:\kckills_worker\edit_summer\objectives_games.json"
BASE = "https://feed.lolesports.com/livestats/v1/window/"
STEP = 40  # s — un probe renvoie ~30-50 frames à 1 f/s

def iso(dt):  # RFC3339 aligné 10 s
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

def snap(frame):
    b, r = frame.get("blueTeam") or {}, frame.get("redTeam") or {}
    g = lambda t, k, d=0: t.get(k, d) if t.get(k) is not None else d
    return {"ts": frame.get("rfc460Timestamp"), "state": frame.get("gameState"),
            "b": {"gold": g(b, "totalGold"), "kills": g(b, "totalKills"), "dragons": list(b.get("dragons") or []), "barons": g(b, "barons"), "towers": g(b, "towers"), "inhib": g(b, "inhibitors")},
            "r": {"gold": g(r, "totalGold"), "kills": g(r, "totalKills"), "dragons": list(r.get("dragons") or []), "barons": g(r, "barons"), "towers": g(r, "towers"), "inhib": g(r, "inhibitors")}}

async def scan_game(client, label, match_ext, gnum, gid, out):
    first = await probe(client, gid)
    if not first or not first.get("frames"):
        return None
    meta = first.get("gameMetadata") or {}
    bm = (meta.get("blueTeamMetadata") or {}).get("participantMetadata") or []
    kc_side = "blue" if any(str(p.get("summonerName", "")).upper().startswith("KC ") for p in bm) else "red"
    anchor = datetime.fromisoformat(first["frames"][0]["rfc460Timestamp"].replace("Z", "+00:00"))
    prev, t, misses, events, last_state = snap(first["frames"][0]), anchor, 0, [], None
    while misses < 3 and (t - anchor) < timedelta(minutes=70):
        t += timedelta(seconds=STEP)
        w = await probe(client, gid, iso(t))
        await asyncio.sleep(0.45)
        if not w or not w.get("frames"):
            misses += 1; continue
        misses = 0
        for fr in w["frames"]:
            cur = snap(fr)
            last_state = cur["state"]
            tg = (datetime.fromisoformat(cur["ts"].replace("Z", "+00:00")) - anchor).total_seconds()
            for side in ("b", "r"):
                p, c = prev[side], cur[side]
                who = "kc" if (side == "blue"[0] and kc_side == "blue") or (side == "r" and kc_side == "red") else "opp"
                if len(c["dragons"]) > len(p["dragons"]):
                    el = c["dragons"][len(p["dragons"]):]
                    for e in el:
                        kind = "elder" if str(e).lower() == "elder" else ("soul" if len(c["dragons"]) >= 4 else "dragon")
                        events.append({"t": round(tg), "type": kind, "side": who, "detail": e, "n": len(c["dragons"])})
                if c["barons"] > p["barons"]:
                    events.append({"t": round(tg), "type": "baron", "side": who, "detail": "", "n": c["barons"]})
                if c["inhib"] > p["inhib"]:
                    events.append({"t": round(tg), "type": "inhibitor", "side": who, "detail": "", "n": c["inhib"]})
                if c["towers"] > p["towers"]:
                    events.append({"t": round(tg), "type": "tower", "side": who, "detail": "", "n": c["towers"]})
                if c["kills"] > p["kills"] + 2:
                    events.append({"t": round(tg), "type": "kill_burst", "side": who, "detail": f"+{c['kills']-p['kills']}", "n": c["kills"]})
            # swing de gold (diff blue-red) sur la fenêtre du probe
            d_prev, d_cur = prev["b"]["gold"] - prev["r"]["gold"], cur["b"]["gold"] - cur["r"]["gold"]
            swing = d_cur - d_prev
            if abs(swing) >= 2500:
                who = "kc" if (swing > 0) == (kc_side == "blue") else "opp"
                events.append({"t": round(tg), "type": "gold_swing", "side": who, "detail": f"{swing:+d}", "n": abs(swing)})
            prev = cur
        if last_state == "finished":
            break
    dur = (t - anchor).total_seconds()
    for e in events:
        e.update({"match": label, "match_ext": match_ext, "game_number": gnum, "game_ext": gid, "kc_side": kc_side})
        out.write(json.dumps(e, ensure_ascii=False) + "\n")
    out.flush()
    print(f"{label} G{gnum} ({gid}) : {len(events)} événements, KC={kc_side}, ~{dur/60:.0f} min, état final={last_state}", flush=True)
    return {"match": label, "match_ext": match_ext, "game_number": gnum, "game_ext": gid, "anchor": anchor.isoformat(), "kc_side": kc_side, "n_events": len(events)}

async def main():
    games_meta = []
    out = io.open(OUT, "w", encoding="utf-8")
    async with httpx.AsyncClient(headers={"User-Agent": "Mozilla/5.0"}) as client:
        for label, mext in MATCHES:
            base = int(mext)
            gnum = 0
            for k in range(1, 6):   # games = id du match + 1..5 (convention lolesports)
                gid = str(base + k)
                gnum += 1
                meta = await scan_game(client, label, mext, gnum, gid, out)
                if meta is None:
                    if k >= 3: break   # Bo3 fini / Bo5 fini : plus de games
                    continue
                games_meta.append(meta)
    out.close()
    json.dump(games_meta, io.open(GAMES_OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("SCAN TERMINÉ :", len(games_meta), "games")

asyncio.run(main())
