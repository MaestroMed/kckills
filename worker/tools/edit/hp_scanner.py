# -*- coding: utf-8 -*-
"""
HP SCANNER — détection de « moves » hors kills depuis le feed livestats :
  * low_hp_survival : un joueur KC descend sous 10 % de PV en plein combat
    (≥ 45 % de PV perdus dans les 12 s précédentes) et ne meurt PAS dans les
    15 s qui suivent → escape / outplay / sauvetage candidat.
  * low_hp_kill     : un joueur KC fait un kill alors qu'il est sous 20 % de PV
    (kill « à 1 HP », clutch).
Sortie : hp_events.jsonl (même schéma que objectives.jsonl + actor/champion).
Usage : python hp_scanner.py [--match <ext_id,...>]
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
OUT = r"D:\kckills_worker\edit_summer\hp_events.jsonl"
BASE = "https://feed.lolesports.com/livestats/v1/window/"
STEP = 40
LOW, PRIOR_HIGH, PRIOR_WIN, SURVIVE_WIN, KILL_LOW = 0.10, 0.45, 12, 15, 0.20


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


def parse_ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


async def scan_game(client, label, match_ext, gnum, gid, out):
    first = await probe(client, gid)
    if not first or not first.get("frames"):
        return None
    meta = first.get("gameMetadata") or {}
    bm = (meta.get("blueTeamMetadata") or {}).get("participantMetadata") or []
    rm = (meta.get("redTeamMetadata") or {}).get("participantMetadata") or []
    kc_side = "blue" if any(str(p.get("summonerName", "")).upper().startswith("KC ") for p in bm) else "red"
    names = {p["participantId"]: (p.get("summonerName", ""), p.get("championId", "")) for p in (bm + rm)}
    anchor = parse_ts(first["frames"][0]["rfc460Timestamp"])
    hist = {}      # pid -> list[(t, hp_ratio, deaths, kills)]
    pending = []   # survivals en attente de confirmation (pas de mort dans SURVIVE_WIN)
    events, t, misses, last_state, last_kill_evt = [], anchor, 0, None, {}

    def team_participants(fr):
        team = fr.get("blueTeam") if kc_side == "blue" else fr.get("redTeam")
        return (team or {}).get("participants") or []

    def handle_frame(fr):
        nonlocal last_state
        last_state = fr.get("gameState")
        tg = (parse_ts(fr["rfc460Timestamp"]) - anchor).total_seconds()
        for p in team_participants(fr):
            pid = p["participantId"]
            mx = p.get("maxHealth") or 0
            hp = (p.get("currentHealth") or 0) / mx if mx else 1.0
            deaths, kills = p.get("deaths") or 0, p.get("kills") or 0
            h = hist.setdefault(pid, [])
            # kill à bas PV
            if h and kills > h[-1][3]:
                recent = [x for x in h if tg - x[0] <= 4]
                low_recent = min([x[1] for x in recent] + [hp])
                if low_recent < KILL_LOW and tg - last_kill_evt.get(pid, -99) > 20:
                    last_kill_evt[pid] = tg
                    events.append({"t": round(tg), "type": "low_hp_kill", "side": "kc", "detail": f"hp {low_recent*100:.0f}%",
                                   "n": round(low_recent * 100), "actor": names[pid][0], "champion": names[pid][1]})
            # survie à bas PV : candidat quand on passe sous LOW après une grosse chute
            if 0 < hp < LOW and h:
                prior = [x[1] for x in h if tg - x[0] <= PRIOR_WIN]
                if prior and max(prior) >= PRIOR_HIGH and not any(c["pid"] == pid and tg - c["t"] < 30 for c in pending):
                    pending.append({"pid": pid, "t": tg, "deaths": deaths, "hp": hp, "min_hp": hp})
            for c in pending:
                if c["pid"] == pid:
                    c["min_hp"] = min(c["min_hp"], hp) if hp > 0 else c["min_hp"]
                    if deaths > c["deaths"]:
                        c["dead"] = True
            h.append((tg, hp, deaths, kills))
            if len(h) > 60:
                del h[:-60]
        # résolution des survies
        for c in list(pending):
            if c.get("dead"):
                pending.remove(c)
            elif tg - c["t"] >= SURVIVE_WIN:
                pending.remove(c)
                events.append({"t": round(c["t"]), "type": "low_hp_survival", "side": "kc", "detail": f"min hp {c['min_hp']*100:.0f}%",
                               "n": round(c["min_hp"] * 100), "actor": names[c["pid"]][0], "champion": names[c["pid"]][1]})

    for fr in first["frames"]:
        handle_frame(fr)
    while misses < 3 and (t - anchor) < timedelta(minutes=70):
        t += timedelta(seconds=STEP)
        w = await probe(client, gid, iso(t))
        await asyncio.sleep(0.45)
        if not w or not w.get("frames"):
            misses += 1
            continue
        misses = 0
        for fr in w["frames"]:
            handle_frame(fr)
        if last_state == "finished":
            break
    for e in events:
        e.update({"match": label, "match_ext": match_ext, "game_number": gnum, "game_ext": gid, "kc_side": kc_side})
        out.write(json.dumps(e, ensure_ascii=False) + "\n")
    out.flush()
    ns = sum(1 for e in events if e["type"] == "low_hp_survival")
    nk = sum(1 for e in events if e["type"] == "low_hp_kill")
    print(f"{label} G{gnum} ({gid}) : {ns} survies bas PV, {nk} kills bas PV, KC={kc_side}, ~{(t-anchor).total_seconds()/60:.0f} min", flush=True)
    return True


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--match", default=None)
    a = ap.parse_args()
    only = set(a.match.split(",")) if a.match else None
    out = io.open(OUT, "a" if only else "w", encoding="utf-8")
    async with httpx.AsyncClient(headers={"User-Agent": "Mozilla/5.0"}) as client:
        for label, mext in MATCHES:
            if only and mext not in only:
                continue
            base = int(mext)
            gnum = 0
            for k in range(1, 6):
                gid = str(base + k)
                gnum += 1
                ok = await scan_game(client, label, mext, gnum, gid, out)
                if ok is None:
                    if k >= 3:
                        break
                    continue
    out.close()
    print("HP SCAN TERMINÉ")

asyncio.run(main())
