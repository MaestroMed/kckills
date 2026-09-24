# Détecteur de moves d'exception — 2e passe Gemini 3.8 Flash sur des clips 16:9.
# Usage : python move_detector.py <n_clips> [match_ext_ids séparés par des virgules]
import asyncio, io, json, os, sys, time, urllib.request
sys.path.insert(0, r"C:\Users\Matter1\Karmine_Stats\worker")
os.chdir(r"C:\Users\Matter1\Karmine_Stats\worker")
from dotenv import load_dotenv
load_dotenv()
from services import gemini_client

N = int(sys.argv[1]) if len(sys.argv) > 1 else 6
ONLY = sys.argv[2].split(",") if len(sys.argv) > 2 else None
env = {}
for line in io.open(r"C:\Users\Matter1\Karmine_Stats\worker\.env", encoding="utf-8"):
    line = line.strip()
    if "=" in line and not line.startswith("#"):
        k, v = line.split("=", 1); env[k.strip()] = v.strip().strip('"')
URL, KEY = env["SUPABASE_URL"], env["SUPABASE_SERVICE_KEY"]
H = {"apikey": KEY, "Authorization": "Bearer " + KEY}
def q(p):
    r = urllib.request.Request(URL + "/rest/v1/" + p, headers=H)
    return json.load(urllib.request.urlopen(r))

SRC = r"D:\kckills_worker\edit_summer\src"
OUT = r"D:\kckills_worker\edit_summer\detector.jsonl"
UA = {"User-Agent": "Mozilla/5.0"}

PROMPT = """Tu es un monteur esport qui prépare un EDIT TikTok des meilleurs moments de la Karmine Corp (LEC Summer 2026).
Ce clip de ~40 s vient d'un match pro League of Legends ; la KC est l'équipe suivie.
Analyse le clip comme un chasseur de moves d'exception : outplay mécanique, flash/dodge décisif, esquive de skillshot,
1v2 / 1v3, retournement de teamfight, tower dive, steal d'objectif, escape impossible, combo parfait, snipe longue portée.
Réponds UNIQUEMENT en JSON valide :
{
  "gameplay_visible": <bool>,
  "spectacle_score": <float 1-10, 9-10 = rarissime>,
  "move_type": "<outplay|flash_dodge|1vX|teamfight_turnaround|tower_dive|steal|escape|combo|snipe|routine>",
  "actor": "<champion qui fait le move>",
  "peak_seconds": <float, seconde du pic d'action dans le clip>,
  "cut_start": <float, début du meilleur segment de 2 à 4 s>,
  "cut_end": <float>,
  "punch_seconds": <float, l'instant exact de l'impact (pour le zoom-punch)>,
  "hype_fr": "<max 60 caractères, style titre TikTok, sans emoji>",
  "why": "<max 100 caractères : ce qui rend le move exceptionnel>"
}
Sois sévère sur spectacle_score : un kill propre en teamfight = 5 ; un vrai outplay = 8+."""

async def main():
    filt = ""
    if ONLY:
        ms = q("matches?select=id&external_id=in.(%s)" % ",".join(ONLY))
        gs = q("games?select=id&match_id=in.(%s)" % ",".join('"%s"' % m["id"] for m in ms))
        filt = "&game_id=in.(%s)" % ",".join('"%s"' % g["id"] for g in gs)
    kills = q(f"kills?select=id,killer_champion,victim_champion,highlight_score,ai_tags,multi_kill,assets_manifest,clip_url_horizontal,game_time_seconds"
              f"&status=eq.published&kill_visible=eq.true&tracked_team_involvement=eq.team_killer&created_at=gte.2026-07-20{filt}&order=highlight_score.desc.nullslast&limit={N}")
    print(f"{len(kills)} clips candidats")
    done = set()
    if os.path.exists(OUT):
        for line in io.open(OUT, encoding="utf-8"):
            try: done.add(json.loads(line)["kill_id"])
            except Exception: pass
    total_cost = 0.0
    with io.open(OUT, "a", encoding="utf-8") as out:
        for k in kills:
            if k["id"] in done: continue
            url = ((k.get("assets_manifest") or {}).get("horizontal") or {}).get("url") or k.get("clip_url_horizontal")
            if not url: continue
            path = os.path.join(SRC, k["id"] + "_h.mp4")
            if not os.path.exists(path):
                rq = urllib.request.Request(url, headers=UA)
                with urllib.request.urlopen(rq) as r, open(path, "wb") as f:
                    while True:
                        c = r.read(1 << 20)
                        if not c: break
                        f.write(c)
            t0 = time.time()
            try:
                res = await gemini_client.analyze(PROMPT, video_path=path, model="gemini-3.8-flash", thinking_budget="low")
            except Exception as e:
                print("  ECHEC", k["id"][:8], str(e)[:120]); continue
            usage = (res or {}).pop("_usage", {}) if isinstance(res, dict) else {}
            cost = ((usage.get("prompt_tokens") or 0) * 0.75 + (usage.get("candidates_tokens") or 0) * 3.75) / 1e6
            total_cost += cost
            rec = {"kill_id": k["id"], "matchup": f"{k['killer_champion']}->{k['victim_champion']}", "ia_score": k["highlight_score"],
                   "tags": k.get("ai_tags"), "multi": k.get("multi_kill"), "detector": res, "cost": round(cost, 5)}
            out.write(json.dumps(rec, ensure_ascii=False) + "\n"); out.flush()
            d = res or {}
            print(f"  {k['killer_champion']}->{k['victim_champion']} (IA {k['highlight_score']}) : spectacle {d.get('spectacle_score')} {d.get('move_type')} @{d.get('punch_seconds')}s — {d.get('hype_fr')} | {d.get('why')} [{time.time()-t0:.0f}s]")
    print(f"coût total : ${total_cost:.3f}")
asyncio.run(main())
