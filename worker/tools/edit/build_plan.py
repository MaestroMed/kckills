# -*- coding: utf-8 -*-
"""
BUILD_PLAN v2 — transforme la détection (detector.jsonl = kills jugés sur le clip,
objectives_judged.jsonl = objectifs / swings / survies à 1 HP jugés sur la VOD)
en plan de montage pour assemble.py, calé sur la grille de la musique.

Structure (92 BPM, temps = 0.652 s) :
  hook (cold open, 2 temps : l'impact du meilleur moment, sans texte)
  → intro 3 temps (logo + SUMMER 2026)
  → montée : shots 2 temps (score 6-7.5), impact sur le 2e temps
  → rafale : jusqu'à 8 shots de 1 temps (impact sur le cut)
  → gros moves : 4 temps (score ≥ 7.5), impact sur le 3e temps ; ≥ 8.5 → slow-mo (ramp)
  → le meilleur en dernier → outro 3 temps (KCKILLS.COM)
Règles : gameplay_visible obligatoire, jamais 2 fois le même fight (même game,
< 35 s d'écart), jamais 3 shots consécutifs du même joueur, durée cible.
Usage : python build_plan.py --min-spectacle 6 --target 60 --music path.mp3 --music-offset 12.3 --out plan.json
"""
import argparse, io, json, os, urllib.request

BPM = 92
BEAT = 60.0 / BPM
RAMP_EPS = 0.15
V_DIR = r"D:\kckills_worker\edit_summer\v"
TAG_FR = {"outplay": "OUTPLAY", "flash_dodge": "FLASH PREDICT", "1vX": "1 VS TOUS", "teamfight_turnaround": "RETOURNEMENT",
          "tower_dive": "TOWER DIVE", "steal": "STEAL", "escape": "ESCAPE", "combo": "COMBO PARFAIT", "snipe": "SNIPE",
          "clutch": "CLUTCH", "ace": "ACE", "engage": "ENGAGE"}
MULTI_FR = {"penta": "PENTAKILL", "quadra": "QUADRA", "triple": "TRIPLE", "double": "DOUBLE"}


def env_db():
    env = {}
    for line in io.open(r"C:\Users\Matter1\Karmine_Stats\worker\.env", encoding="utf-8"):
        line = line.strip()
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"')
    return env["SUPABASE_URL"], {"apikey": env["SUPABASE_SERVICE_KEY"], "Authorization": "Bearer " + env["SUPABASE_SERVICE_KEY"]}


def q(url, hdr, path):
    r = urllib.request.Request(url + "/rest/v1/" + path, headers=hdr)
    return json.load(urllib.request.urlopen(r))


def download(url, dest):
    if os.path.exists(dest) and os.path.getsize(dest) > 1_000_000:
        return
    rq = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(rq) as r, open(dest, "wb") as f:
        while True:
            c = r.read(1 << 20)
            if not c:
                break
            f.write(c)


def load_candidates(a):
    cands = []
    for line in io.open(a.detector, encoding="utf-8"):
        if not line.strip():
            continue
        rec = json.loads(line)
        d = rec.get("detector") or {}
        if not d.get("gameplay_visible", True):
            continue
        sc = float(d.get("spectacle_score") or 0)
        if rec.get("multi") in ("penta", "quadra"):
            sc = max(sc, 8.6)
        if rec.get("multi") == "triple":
            sc = max(sc, 7.0)
        cands.append({"kind": "kill", "id": rec["kill_id"], "score": sc, "d": d, "multi": rec.get("multi"), "matchup": rec.get("matchup")})
    if os.path.exists(a.objectives):
        for line in io.open(a.objectives, encoding="utf-8"):
            if not line.strip():
                continue
            rec = json.loads(line)
            d = rec.get("judge") or {}
            if not d.get("gameplay_visible", False) or not rec.get("clip") or not os.path.exists(rec["clip"]):
                continue
            sc = float(d.get("spectacle_score") or 0)
            opp = " ".join((rec.get("match") or "").split(" ")[1:]).replace(" PO", "")
            cands.append({"kind": "objective", "id": rec["id"], "score": sc, "d": d, "src": rec["clip"], "aspect": "16:9",
                          "label": (rec.get("label") or "KC").replace("KC ", ""),
                          "tag": (rec.get("tag", "OBJECTIF") + (f"  vs {opp}" if opp else "")).strip(),
                          "game_ext": rec.get("game_ext") or rec["id"].rsplit("_", 1)[0], "t": rec.get("t"),
                          "matchup": rec.get("match", "")})
    return cands


def enrich_kills(cands):
    url, hdr = env_db()
    kill_ids = [c["id"] for c in cands if c["kind"] == "kill"]
    info = {}
    sel = ("kills?select=id,killer_champion,victim_champion,multi_kill,is_first_blood,assets_manifest,clip_url_vertical,game_time_seconds,"
           "killer:players!kills_killer_player_id_fkey(ign),"
           "games(external_id,game_number,matches(scheduled_at,team_blue:teams!matches_team_blue_id_fkey(code),team_red:teams!matches_team_red_id_fkey(code)))")
    for i in range(0, len(kill_ids), 60):
        chunk = ",".join('"%s"' % k for k in kill_ids[i:i + 60])
        for r in q(url, hdr, sel + f"&id=in.({chunk})"):
            info[r["id"]] = r
    # IGN de secours : game_participants (game_id + champion) quand killer_player_id est vide
    sel2 = "kills?select=id,game_id&id=in.(%s)"
    gids = {}
    for i in range(0, len(kill_ids), 60):
        chunk = ",".join('"%s"' % k for k in kill_ids[i:i + 60])
        for r in q(url, hdr, sel2 % chunk):
            gids[r["id"]] = r["game_id"]
    parts = {}
    ug = sorted(set(gids.values()))
    for i in range(0, len(ug), 40):
        chunk = ",".join('"%s"' % g for g in ug[i:i + 40])
        for r in q(url, hdr, f"game_participants?select=game_id,champion,players(ign)&game_id=in.({chunk})"):
            parts[(r["game_id"], (r.get("champion") or "").lower())] = ((r.get("players") or {}).get("ign") or "")
    for c in cands:
        if c["kind"] != "kill":
            continue
        r = info.get(c["id"], {})
        ign = ((r.get("killer") or {}).get("ign") or "").strip()
        if not ign:
            ign = (parts.get((gids.get(c["id"]), (r.get("killer_champion") or "").lower())) or "").strip()
        if not ign:
            ign = roster_ign(((r.get("games") or {}).get("external_id")), r.get("killer_champion") or "")
        g = r.get("games") or {}
        m = g.get("matches") or {}
        codes = [((m.get("team_blue") or {}).get("code")), ((m.get("team_red") or {}).get("code"))]
        opp = next((x for x in codes if x and x not in ("KC", "KCB")), "")
        c["label"] = (ign or r.get("killer_champion") or "KC").upper()
        d = c["d"]
        tag = MULTI_FR.get(r.get("multi_kill") or "", "") or TAG_FR.get(d.get("move_type") or "", "") or ("FIRST BLOOD" if r.get("is_first_blood") else "")
        # multi-kill vu par le détecteur (le harvester rate parfois les pentas) : le clip montre
        # l'auteur réel -> label = son pseudo (actor = pseudo KC ou champion -> roster livestats)
        blob = ((d.get("hype_fr") or "") + " " + (d.get("why") or "")).lower()
        seen_multi = "PENTAKILL" if "penta" in blob else ("QUADRA" if "quadra" in blob else ("TRIPLE" if "triple" in blob else ""))
        if seen_multi and seen_multi != MULTI_FR.get(r.get("multi_kill") or "", ""):
            # garde-fou anti-hallucination : les compteurs de kills du feed sont fiables ->
            # un joueur doit avoir >= N kills dans la même game à +/- 25 s
            need = {"PENTAKILL": 5, "QUADRA": 4, "TRIPLE": 3}[seen_multi]
            gid, t = gids.get(c["id"]), r.get("game_time_seconds")
            best_champ, best_n = None, 0
            if gid and t is not None:
                for k in same_game_kills(url, hdr, gid):
                    if k.get("game_time_seconds") is None or abs(k["game_time_seconds"] - t) > 25:
                        continue
                    n = sum(1 for x in same_game_kills(url, hdr, gid) if x.get("killer_champion") == k.get("killer_champion")
                            and x.get("game_time_seconds") is not None and abs(x["game_time_seconds"] - t) <= 25)
                    if n > best_n:
                        best_champ, best_n = k.get("killer_champion"), n
            if best_n >= need and best_champ:
                a_ign = roster_ign(((r.get("games") or {}).get("external_id")), best_champ) or best_champ
                c["label"] = a_ign.upper()
                tag = seen_multi
            else:
                c["score"] = min(c["score"], 7.5)   # claim non confirmé par les stats : on dégonfle
                c["d"]["hype_fr"] = (d.get("hype_fr") or "") + " [multi non confirmé]"
        c["src"] = os.path.join(V_DIR, c["id"] + "_v.mp4")
        c["url"] = ((r.get("assets_manifest") or {}).get("vertical") or {}).get("url") or r.get("clip_url_vertical")
        c["game_ext"] = g.get("external_id")
        c["t"] = r.get("game_time_seconds")
        # source de vérité des multi-kills : multikills.jsonl (compteurs du feed, règle des 10 s)
        mk = true_multikill(c["game_ext"], c["t"])
        if mk:
            c["label"] = mk["player"].replace("KC ", "").upper()
            tag = {5: "PENTAKILL", 4: "QUADRA", 3: "TRIPLE"}.get(min(mk["count"], 5), "MULTI")
            c["score"] = max(c["score"], {5: 9.3, 4: 8.6, 3: 7.2}.get(min(mk["count"], 5), c["score"]))
        elif tag in ("PENTAKILL", "QUADRA") and os.path.exists(MK_FILE):
            tag = "TRIPLE" if tag == "QUADRA" else "QUADRA"   # base non confirmée par le feed : un cran en dessous
        c["tag"] = (tag + (f"  vs {opp}" if opp else "")).strip()
        c["date"] = (m.get("scheduled_at") or "")[:10]


_ROSTER = {}
_GAME_KILLS = {}
MK_FILE = r"D:\kckills_worker\edit_summer\multikills.jsonl"
_MK = None


def true_multikill(game_ext, t):
    """multi-kill KC confirmé par le feed autour de t (±6 s de la fenêtre)."""
    global _MK
    if _MK is None:
        _MK = {}
        if os.path.exists(MK_FILE):
            for line in io.open(MK_FILE, encoding="utf-8"):
                if line.strip():
                    r = json.loads(line)
                    if r.get("side") == "kc" and r.get("count", 0) >= 3:
                        _MK.setdefault(r["game_ext"], []).append(r)
    if not game_ext or t is None:
        return None
    best = None
    for r in _MK.get(game_ext, []):
        if r["t_first"] - 6 <= t <= r["t_last"] + 6 and (best is None or r["count"] > best["count"]):
            best = r
    return best


def same_game_kills(url, hdr, game_id):
    if game_id not in _GAME_KILLS:
        _GAME_KILLS[game_id] = q(url, hdr, f"kills?select=killer_champion,game_time_seconds&game_id=eq.{game_id}&tracked_team_involvement=eq.team_killer")
    return _GAME_KILLS[game_id]


def roster_ign(game_ext, champion):
    """Pseudo depuis le feed livestats (gameMetadata) : champion -> 'KC Canna' -> Canna."""
    if not game_ext or not champion:
        return ""
    if game_ext not in _ROSTER:
        m = {}
        try:
            rq = urllib.request.Request(f"https://feed.lolesports.com/livestats/v1/window/{game_ext}", headers={"User-Agent": "Mozilla/5.0"})
            meta = json.load(urllib.request.urlopen(rq, timeout=20)).get("gameMetadata") or {}
            for side in ("blueTeamMetadata", "redTeamMetadata"):
                for p in (meta.get(side) or {}).get("participantMetadata") or []:
                    m[str(p.get("championId", "")).lower().replace("'", "").replace(" ", "")] = str(p.get("summonerName", ""))
        except Exception:
            pass
        _ROSTER[game_ext] = m
    name = _ROSTER[game_ext].get(champion.lower().replace("'", "").replace(" ", ""), "")
    return name.split(" ", 1)[1] if " " in name else name


def same_fight(a, b):
    return a.get("game_ext") and a.get("game_ext") == b.get("game_ext") and a.get("t") is not None and b.get("t") is not None and abs(a["t"] - b["t"]) < 35


def make_shot(c, beats, ramp=False, hook=False):
    d = c["d"]
    punch = float(d.get("punch_seconds") or d.get("peak_seconds") or 20.0)
    if hook:
        tin = punch - BEAT
    elif beats == 1:
        tin = punch - 0.1
    elif beats == 2:
        tin = punch - BEAT
    elif ramp:
        tin = punch - RAMP_EPS - (BEAT - RAMP_EPS / 2)
    else:
        tin = punch - 2 * BEAT
    tin = max(0.0, tin)
    if ramp:
        tout = punch + (beats - 2) * BEAT
    else:
        tout = tin + beats * BEAT
    s = {"src": c["src"], "in": round(tin, 3), "out": round(tout, 3), "punch": round(punch, 3), "speed": 1.0,
         "score": c["score"], "hype": d.get("hype_fr", ""), "id": c["id"], "beats": beats}
    if not hook:
        s["label"] = c["label"]
        s["tag"] = c["tag"]
    if ramp:
        s["ramp"] = True
    if c.get("aspect"):
        s["aspect"] = c["aspect"]
    return s


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--detector", default=r"D:\kckills_worker\edit_summer\detector.jsonl")
    ap.add_argument("--objectives", default=r"D:\kckills_worker\edit_summer\objectives_judged.jsonl")
    ap.add_argument("--min-spectacle", type=float, default=6.0)
    ap.add_argument("--rafale-min", type=float, default=5.0, help="score min des shots 1 temps")
    ap.add_argument("--rafale", type=int, default=8, help="nb max de shots 1 temps")
    ap.add_argument("--target", type=float, default=60.0, help="durée cible (s)")
    ap.add_argument("--music", default=None)
    ap.add_argument("--music-offset", type=float, default=0.0)
    ap.add_argument("--out", default=r"D:\kckills_worker\edit_summer\plan.json")
    ap.add_argument("--dry", action="store_true")
    a = ap.parse_args()

    cands = load_candidates(a)
    enrich_kills(cands)
    cands = [c for c in cands if c.get("src")]
    # dédup : même fight (même game, < 35 s) → on garde le meilleur score
    cands.sort(key=lambda c: c["score"], reverse=True)
    uniq = []
    for c in cands:
        if any(same_fight(c, u) for u in uniq):
            continue
        uniq.append(c)
    print(f"{len(cands)} candidats visibles -> {len(uniq)} fights distincts")

    main_pool = [c for c in uniq if c["score"] >= a.min_spectacle]
    rafale_pool = [c for c in uniq if a.rafale_min <= c["score"] < a.min_spectacle]
    fixed = 2 + 3 + 3                      # hook + intro + outro (temps)
    budget = a.target / BEAT - fixed
    picked, used, labels = [], 0, []
    for c in main_pool:                    # déjà trié par score desc
        beats = 4 if c["score"] >= 8.0 else 2
        if used + beats > budget:
            continue
        if labels[-2:] == [c["label"], c["label"]]:
            continue
        c["beats"] = beats
        c["ramp"] = c["score"] >= 8.5 and c["kind"] == "kill"
        picked.append(c)
        used += beats
        labels.append(c["label"])
    rafale = []
    for c in rafale_pool[: a.rafale]:
        if used + 1 > budget:
            break
        c["beats"] = 1
        rafale.append(c)
        used += 1
    if not picked:
        print("aucun candidat — baisse --min-spectacle")
        return
    # ordre : 2 temps (asc) → rafale (asc) → 4 temps (asc), le meilleur en dernier
    small = sorted([c for c in picked if c["beats"] == 2], key=lambda c: c["score"])
    big = sorted([c for c in picked if c["beats"] == 4], key=lambda c: c["score"])
    rafale.sort(key=lambda c: c["score"])
    order = small + rafale + big
    best = big[-1] if big else small[-1]
    print(f"{len(order)} shots ({len(small)}×2t, {len(rafale)}×1t, {len(big)}×4t) = {used*BEAT:.1f}s + fixes {fixed*BEAT:.1f}s (cible {a.target}s)")

    if not a.dry:
        for c in order:
            if c["kind"] == "kill" and c.get("url") and not os.path.exists(c["src"]):
                download(c["url"], c["src"])
    shots = []
    for c in order:
        s = make_shot(c, c["beats"], ramp=c.get("ramp", False))
        shots.append(s)
        print(f"  [{c['score']:.1f}] {c['beats']}t {'ramp ' if c.get('ramp') else ''}{c['label']:10} {c['tag']:26} @{s['punch']:.1f}s  {c['d'].get('hype_fr', '')}")
    hook = make_shot(best, 2, hook=True)
    plan = {"bpm": BPM, "music": a.music, "music_offset": a.music_offset, "caster_db": -13,
            "logo": r"D:\kckills_worker\edit_summer\assets\kc-logo.png",
            "hook": hook, "hook_caption": "LE SUMMER DE LA KC",
            "intro": {"title": "SUMMER 2026", "sub": "KARMINE CORP", "beats": 3},
            "shots": shots, "outro": {"title": "KCKILLS.COM", "sub": "EVERY KILL. RATED.", "beats": 3}}
    json.dump(plan, io.open(a.out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("plan ->", a.out)


if __name__ == "__main__":
    main()
