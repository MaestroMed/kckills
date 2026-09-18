# -*- coding: utf-8 -*-
"""
OBJECTIVE JUDGE v2.1 — pour chaque « moment » détecté dans les stats (objectifs,
swings de gold, rafales de kills, survies / kills à bas PV côté KC), découpe le
segment de VOD (yt-dlp sections, 720p 16:9), VÉRIFIE la synchro en faisant lire
le chrono in-game par Gemini sur un crop de la ligne du timer (appel image,
quasi gratuit — l'OCR local ne segmente pas ce HUD), corrige la découpe si la
VOD a dérivé (co-stream coupé, offset faux mais constant…), puis fait juger le
moment par Gemini 3.8 Flash : steal ? clutch ? retournement ? escape ?
Sortie : objectives_judged.jsonl (une ligne par segment, chemin du clip 16:9).
Usage : python objective_judge.py [--limit N] [--per-game 8] [--match <ext_id,...>] [--types baron,soul,...]
"""
import argparse, asyncio, io, json, os, statistics, subprocess, sys, time, urllib.request

sys.path.insert(0, r"C:\Users\Matter1\Karmine_Stats\worker")
os.chdir(r"C:\Users\Matter1\Karmine_Stats\worker")
from dotenv import load_dotenv  # noqa: E402
load_dotenv()
from config import config  # noqa: E402
from scheduler import scheduler  # noqa: E402
from services import gemini_client  # noqa: E402
from services.gemini_client import get_client, _wait_for_file_active, handle_gemini_exception  # noqa: E402

EVENTS = [r"D:\kckills_worker\edit_summer\objectives.jsonl", r"D:\kckills_worker\edit_summer\hp_events.jsonl"]
OUT = r"D:\kckills_worker\edit_summer\objectives_judged.jsonl"
CLIPS = r"D:\kckills_worker\edit_summer\obj"
PY = r"C:\Users\Matter1\Karmine_Stats\worker\.venv\Scripts\python.exe"
WIN = {"multikill": (24, 10), "baron": (28, 14), "elder": (28, 14), "soul": (28, 14), "dragon": (26, 12), "kill_burst": (24, 14), "gold_swing": (30, 12),
       "low_hp_survival": (16, 12), "low_hp_kill": (16, 12)}
PRIO = {"multikill": 6, "soul": 5, "elder": 5, "baron": 4, "low_hp_survival": 4, "low_hp_kill": 3, "kill_burst": 3, "gold_swing": 2, "dragon": 1}
MAX_DRIFT = 300     # au-delà : lecture incohérente, sauf si 2 lectures concordantes (offset faux mais constant)
TOL = 8             # dérive tolérée (s) avant re-découpe
TIMER_MODEL = "gemini-3.5-flash-lite"

PROMPT = """Tu es un monteur esport. Ce segment (~{dur} s, 16:9) d'un match pro League of Legends encadre un MOMENT
détecté dans les stats : {what}. L'équipe suivie est la Karmine Corp (KC).
Juge le moment comme un chasseur de highlights TikTok : STEAL d'objectif (smite volé), objectif clutch sous
pression, retournement de teamfight, engage parfait, ace, défense héroïque, ESCAPE à 1 HP / outplay de survie,
kill à 1 HP ? Ou routine (objectif pris tranquillement, poke, rien de visuel) ?
Réponds UNIQUEMENT en JSON valide :
{{
  "gameplay_visible": <bool, false si plateau/casters/replay/écran de fin>,
  "spectacle_score": <float 1-10, 9-10 = moment de saison>,
  "kind": "<steal|clutch_objective|teamfight_turnaround|ace|engage|defense|escape|low_hp_kill|routine>",
  "actor": "<pseudo ou champion KC clé, ex: Yike>",
  "peak_seconds": <float, seconde du pic dans le segment>,
  "punch_seconds": <float, l'instant exact de l'impact (smite, kill décisif, flash de survie)>,
  "cut_start": <float>, "cut_end": <float>,
  "hype_fr": "<max 60 caractères, titre TikTok, sans emoji>",
  "why": "<max 100 caractères>"
}}"""

TIMER_PROMPT = ('Cette image est un crop du bandeau central du HUD d\'un match de League of Legends (broadcast). '
                'Lis le CHRONO de la partie (format MM:SS, chiffres blancs). Réponds UNIQUEMENT en JSON : '
                '{"timer": "MM:SS"} ou {"timer": null} si aucun chrono lisible.')


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


def cut_vod(youtube_id, start, end, dest):
    if os.path.exists(dest) and os.path.getsize(dest) > 500_000:
        return True
    from services import youtube_cookies
    cmd = [PY, "-m", "yt_dlp", *youtube_cookies.cli_args(), "--no-playlist", "--no-warnings",
           "--download-sections", f"*{start}-{end}", "-f", "bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720]",
           "--force-keyframes-at-cuts", "-o", dest, f"https://www.youtube.com/watch?v={youtube_id}"]
    for attempt in range(2):
        r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=600)
        if r.returncode == 0 and os.path.exists(dest):
            return True
        time.sleep(45)
    return False


def parse_mmss(s):
    try:
        m, sec = str(s).strip().split(":")
        return int(m) * 60 + int(sec)
    except Exception:
        return None


async def read_timer(clip, at=2.0):
    """Chrono in-game à `at` s dans le clip → secondes, via Gemini sur le crop de la ligne du timer."""
    zone = clip[:-4] + f"_t{int(at)}_zone.png"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(at), "-i", clip, "-frames:v", "1",
                    "-vf", "crop=iw*0.14:ih*0.05:iw*0.43:ih*0.055,scale=iw*4:ih*4", zone], capture_output=True, timeout=60)
    if not os.path.exists(zone):
        return None
    if not await scheduler.wait_for("gemini"):
        return None
    try:
        from google.genai import types  # type: ignore
        client = get_client()
        if client is None:
            return None
        img = await asyncio.to_thread(client.files.upload, file=zone, config=types.UploadFileConfig(mime_type="image/png"))
        if not await _wait_for_file_active(client, img, timeout=30):
            return None
        resp = await asyncio.to_thread(client.models.generate_content, model=TIMER_MODEL, contents=[TIMER_PROMPT, img],
                                       config=types.GenerateContentConfig(response_mime_type="application/json"))
        return parse_mmss((json.loads((resp.text or "{}").strip()) or {}).get("timer"))
    except Exception as e:
        handle_gemini_exception(e, where="edit_timer_read")
        return None


async def judge(clip, what, dur):
    res = await gemini_client.analyze(PROMPT.format(what=what, dur=dur), video_path=clip, model="gemini-3.8-flash", thinking_budget="low")
    usage = (res or {}).pop("_usage", {}) if isinstance(res, dict) else {}
    cost = ((usage.get("prompt_tokens") or 0) * 0.75 + (usage.get("candidates_tokens") or 0) * 3.75) / 1e6
    return (res or {}), cost


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--min-swing", type=int, default=3000)
    ap.add_argument("--limit", type=int, default=80)
    ap.add_argument("--per-game", type=int, default=8)
    ap.add_argument("--match", default=None, help="ext ids séparés par des virgules")
    ap.add_argument("--types", default=None, help="filtre de types, ex: low_hp_survival,baron")
    a = ap.parse_args()
    os.makedirs(CLIPS, exist_ok=True)
    url, hdr = env_db()
    events = []
    for path in EVENTS:
        if os.path.exists(path):
            events += [json.loads(l) for l in io.open(path, encoding="utf-8") if l.strip()]
    # multi-kills confirmés par le feed (multikill_scan.py) : événements de premier rang
    mk_path = r"D:\kckills_worker\edit_summer\multikills.jsonl"
    if os.path.exists(mk_path):
        for l in io.open(mk_path, encoding="utf-8"):
            if not l.strip():
                continue
            m = json.loads(l)
            if m.get("side") != "kc" or m.get("count", 0) < 4:
                continue
            events.append({"t": int(m["t_last"]), "type": "multikill", "side": "kc", "detail": f"{m['count']} kills {m['player']} ({m['champion']})",
                           "n": m["count"], "actor": m["player"], "match": m["match"], "match_ext": m["match_ext"],
                           "game_number": m["game_number"], "game_ext": m["game_ext"]})
    only = set(a.match.split(",")) if a.match else None
    types = set(a.types.split(",")) if a.types else None
    keep = []
    for e in events:
        if e.get("side") != "kc" or (only and e["match_ext"] not in only):
            continue
        if types and e["type"] not in types:
            continue
        if e["type"] in ("multikill", "baron", "elder", "soul", "low_hp_survival", "low_hp_kill"):
            keep.append(e)
        elif e["type"] == "gold_swing" and e["n"] >= a.min_swing:
            keep.append(e)
        elif e["type"] == "kill_burst" and int(str(e["detail"]).strip("+") or 0) >= 3:
            keep.append(e)
    keep.sort(key=lambda e: (e["game_ext"], e["t"]))
    dedup = []
    for e in keep:
        if dedup and dedup[-1]["game_ext"] == e["game_ext"] and e["t"] - dedup[-1]["t"] < 30:
            prev = dedup[-1]
            if PRIO.get(e["type"], 0) > PRIO.get(prev["type"], 0):
                e["detail"] = f"{e['detail']} (+{prev['type']})"
                dedup[-1] = e
            else:
                prev["detail"] = f"{prev['detail']} (+{e['type']})"
            continue
        dedup.append(e)
    by_game = {}
    for e in dedup:
        by_game.setdefault(e["game_ext"], []).append(e)
    sel = []
    for g, lst in by_game.items():
        lst.sort(key=lambda e: (-PRIO.get(e["type"], 0), e["t"]))
        sel += lst[:a.per_game]
    sel.sort(key=lambda e: (e["match"], e["game_number"], e["t"]))
    print(f"{len(events)} événements -> {len(dedup)} moments KC -> {len(sel)} après cap {a.per_game}/game (limite {a.limit})", flush=True)
    done = set()
    if os.path.exists(OUT):
        for l in io.open(OUT, encoding="utf-8"):
            try:
                done.add(json.loads(l)["id"])
            except Exception:
                pass
    gexts = sorted({e["game_ext"] for e in sel})
    games = {}
    for i in range(0, len(gexts), 60):
        for g in q(url, hdr, "games?select=external_id,vod_youtube_id,vod_offset_seconds,game_number&external_id=in.(%s)" % ",".join(gexts[i:i + 60])):
            games[g["external_id"]] = g
    drift, bad = {}, {}     # game_ext -> correction courante (s) à ajouter à la position VOD ; lectures incohérentes
    cost, n, nd = 0.0, 0, 0
    with io.open(OUT, "a", encoding="utf-8") as out:
        for e in sel:
            if n >= a.limit:
                break
            eid = f"{e['game_ext']}_{e['t']}"
            if eid in done:
                continue
            g = games.get(e["game_ext"])
            if not g or not g.get("vod_youtube_id") or g.get("vod_offset_seconds") is None:
                print("  (pas de VOD)", e["match"], "G%s" % e["game_number"], e["type"], flush=True)
                continue
            pre, post = WIN.get(e["type"], (26, 12))
            what = f"{e['type']} pour KC à T+{e['t']//60}:{e['t']%60:02d} ({e.get('detail','')}{' — ' + e['actor'] if e.get('actor') else ''})"
            t0 = time.time()
            corr = drift.get(e["game_ext"], 0)
            expected = e["t"] - pre
            start = max(0, int(g["vod_offset_seconds"]) + expected + corr)
            dest = os.path.join(CLIPS, f"{eid}_{start}.mp4")
            if not cut_vod(g["vod_youtube_id"], start, start + pre + post, dest):
                print("  ECHEC découpe", e["match"], what, flush=True)
                continue
            time.sleep(6)
            measured = await read_timer(dest)
            note = ""
            if measured is not None:
                dd = measured - (expected + 2)          # >0 : la VOD montre un temps de jeu plus avancé -> reculer
                if abs(dd) > MAX_DRIFT:
                    bad.setdefault(e["game_ext"], []).append(dd)
                    b = bad[e["game_ext"]]
                    if len(b) >= 2 and abs(b[-1] - b[-2]) < 60:
                        dd = int(statistics.median(b[-2:]))
                        note = f" offset faux mais constant ({dd:+})"
                    else:
                        print(f"  lecture incohérente {e['match']} G{e['game_number']} T+{e['t']//60}:{e['t']%60:02d} : chrono {measured//60}:{measured%60:02d} vs attendu {expected//60}:{expected%60:02d} -> on passe", flush=True)
                        continue
                if abs(dd) > TOL:
                    corr = corr - dd
                    drift[e["game_ext"]] = corr
                    start2 = max(0, int(g["vod_offset_seconds"]) + expected + corr)
                    dest2 = os.path.join(CLIPS, f"{eid}_{start2}.mp4")
                    if cut_vod(g["vod_youtube_id"], start2, start2 + pre + post, dest2):
                        nd += 1
                        dest, start = dest2, start2
                        time.sleep(6)
                        m2 = await read_timer(dest)
                        note += f" re-découpe {-dd:+} -> chrono {m2//60}:{m2%60:02d}" if m2 is not None else f" re-découpe {-dd:+} (chrono illisible)"
                        measured = m2 if m2 is not None else measured
            d, c = await judge(dest, what, pre + post)
            cost += c
            rec = {"id": eid, "match": e["match"], "match_ext": e["match_ext"], "game_number": e["game_number"], "t": e["t"],
                   "type": e["type"], "detail": e.get("detail", ""), "clip": dest, "aspect": "16:9", "vod": g["vod_youtube_id"],
                   "vod_start": start, "drift": drift.get(e["game_ext"], 0), "timer_read": measured, "expected": expected,
                   "game_ext": e["game_ext"], "actor_hint": e.get("actor"),
                   "label": (d.get("actor") or e.get("actor") or "KC").replace("KC ", "").upper(),
                   "tag": ({5: "PENTAKILL", 4: "QUADRA"}.get(e.get("n"), "MULTI") if e["type"] == "multikill" else None) or {"steal": "STEAL", "clutch_objective": "CLUTCH", "teamfight_turnaround": "RETOURNEMENT", "ace": "ACE",
                           "engage": "ENGAGE", "defense": "DEFENSE", "escape": "ESCAPE", "low_hp_kill": "KILL A 1 HP"}.get(d.get("kind"), "OBJECTIF"),
                   "judge": d}
            out.write(json.dumps(rec, ensure_ascii=False) + "\n")
            out.flush()
            n += 1
            mm = f"{measured//60}:{measured%60:02d}" if measured is not None else "?"
            print(f"  {e['match']} G{e['game_number']} T+{e['t']//60}:{e['t']%60:02d} {e['type']:16} -> spectacle {d.get('spectacle_score')} {d.get('kind')} @{d.get('punch_seconds')}s "
                  f"— {d.get('hype_fr')} [chrono {mm} / attendu {expected//60}:{expected%60:02d}{note}] [{time.time()-t0:.0f}s]", flush=True)
    print(f"jugés : {n} (re-découpes {nd}) | coût ${cost:.3f}", flush=True)

asyncio.run(main())
