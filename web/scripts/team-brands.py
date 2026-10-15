"""
Équipes du Mondial 2026 : logos officiels (API lolesports getTeams) téléchargés
dans public/images/teams/, couleurs d'étendard tirées des logos (couleur
dominante saturée ; logo monochrome → drap noir, fil argent), puis génération de
src/lib/team-brands.ts.

Liste des 19 équipes : Wikipédia « 2026 League of Legends World Championship »
(lu le 15/10/2026), cohérente avec le calendrier officiel (Play-ins : KC, C9,
MVK, FUR).

Usage : python scripts/team-brands.py
"""
import colorsys
import io
import json
import os

import httpx
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "images", "teams")
os.makedirs(OUT, exist_ok=True)
H = {"x-api-key": "0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z"}

# code site → (nom affiché, région, phase de départ, noms possibles dans l'API)
TEAMS = [
    ("KC", "Karmine Corp", "LEC", "Play-ins", ["Karmine Corp"]),
    ("C9", "Cloud9", "LCS", "Play-ins", ["Cloud9 Kia", "Cloud9"]),
    ("MVK", "MVK Esports", "LCP", "Play-ins", ["MVK Esports"]),
    ("FUR", "FURIA", "CBLOL", "Play-ins", ["FURIA"]),
    ("GEN", "Gen.G", "LCK", "Système suisse", ["Gen.G Esports", "Gen.G"]),
    ("HLE", "Hanwha Life Esports", "LCK", "Système suisse", ["Hanwha Life Esports"]),
    ("T1", "T1", "LCK", "Système suisse", ["T1"]),
    ("DK", "Dplus KIA", "LCK", "Système suisse", ["Dplus KIA", "Dplus Kia"]),
    ("AL", "Anyone's Legend", "LPL", "Système suisse", ["Anyone's Legend"]),
    ("BLG", "Bilibili Gaming", "LPL", "Système suisse", ["Bilibili Gaming"]),
    ("TES", "Top Esports", "LPL", "Système suisse", ["Top Esports"]),
    ("IG", "Invictus Gaming", "LPL", "Système suisse", ["Invictus Gaming"]),
    ("G2", "G2 Esports", "LEC", "Système suisse", ["G2 Esports"]),
    ("MKOI", "Movistar KOI", "LEC", "Système suisse", ["Movistar KOI"]),
    ("TLAW", "Team Liquid", "LCS", "Système suisse", ["Team Liquid Alienware", "Team Liquid"]),
    ("LYON", "LYON", "LCS", "Système suisse", ["LYON"]),
    ("TSW", "Team Secret Whales", "LCP", "Système suisse", ["Team Secret Whales"]),
    ("CFO", "CTBC Flying Oyster", "LCP", "Système suisse", ["CTBC Flying Oyster"]),
    ("LOS", "Los Grandes", "CBLOL", "Système suisse", ["LOS", "Los Grandes"]),
]

api = httpx.get("https://esports-api.lolesports.com/persisted/gw/getTeams", headers=H, params={"hl": "en-US"}, timeout=60).json()["data"]["teams"]


def find(names):
    for n in names:
        cands = [t for t in api if t["name"].lower() == n.lower() and t.get("image")]
        if cands:
            act = [t for t in cands if t.get("status") == "active"]
            return (act or cands)[0]
    return None


def dominant(im: Image.Image):
    im = im.convert("RGBA").resize((96, 96))
    buckets = {}
    for r, g, b, a in im.get_flattened_data():
        if a < 160:
            continue
        h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
        if s < 0.28 or l < 0.12 or l > 0.9:
            continue
        key = round(h * 24) % 24
        w = s * (1 - abs(l - 0.5))
        acc = buckets.setdefault(key, [0, 0, 0, 0])
        acc[0] += r * w
        acc[1] += g * w
        acc[2] += b * w
        acc[3] += w
    opaque = sum(1 for p in im.get_flattened_data() if p[3] >= 160) or 1
    if not buckets:
        return None
    k, (r, g, b, w) = max(buckets.items(), key=lambda kv: kv[1][3])
    if w / opaque < 0.04:
        return None
    return (r / w, g / w, b / w)


def hexi(rgb):
    return "0x%02x%02x%02x" % tuple(max(0, min(255, round(c))) for c in rgb)


def mixc(rgb, f, to=(0, 0, 0)):
    return tuple(c * (1 - f) + t * f for c, t in zip(rgb, to))


rows = []
for code, name, region, phase, names in TEAMS:
    t = find(names)
    if not t:
        print("INTROUVABLE", code, names)
        continue
    url = t["image"].replace("http://", "https://")
    raw = httpx.get(url, timeout=60, follow_redirects=True).content
    im = Image.open(io.BytesIO(raw)).convert("RGBA")
    im.thumbnail((512, 512))
    path = os.path.join(OUT, f"{code}.png")
    im.save(path)
    dom = dominant(im)
    if dom is None:
        look = {"fabricA": "0x0d0f14", "fabricB": "0x262a33", "sheen": "0x9aa3b5", "glow": "0xc9d2e6", "thread": "silver"}
    else:
        h, l, s = colorsys.rgb_to_hls(*(c / 255 for c in dom))
        yellow = 0.09 < h < 0.19
        base = tuple(c * 255 for c in colorsys.hls_to_rgb(h, min(0.5, max(0.32, l)), min(1, s)))
        look = {
            "fabricA": hexi(mixc(base, 0.62)),
            "fabricB": hexi(mixc(base, 0.18)),
            "sheen": hexi(mixc(base, 0.45, (255, 255, 255))),
            "glow": hexi(base),
            "thread": "silver" if yellow else "gold",
        }
    bbox = im.getbbox()
    rows.append({"code": code, "name": name, "region": region, "phase": phase, "logo": f"/images/teams/{code}.png", "remote": url, "apiName": t["name"], **look, "dominant": hexi(dom) if dom else None, "size": im.size, "bbox": bbox})
    print(code, t["name"], im.size, bbox, "dominante", hexi(dom) if dom else "aucune (monochrome)", look["thread"])

ts = ['/**',
      ' * Équipes du Mondial 2026 — généré par scripts/team-brands.py (ne pas éditer à la main).',
      ' * Logos : API lolesports getTeams, copiés dans public/images/teams/. Couleurs d\'étendard :',
      ' * couleur dominante saturée du logo (logo monochrome → drap noir, fil argent).',
      ' * Liste : Wikipédia « 2026 League of Legends World Championship », lue le 15/10/2026.',
      ' */',
      '',
      'export interface TeamBrand {',
      '  code: string;',
      '  name: string;',
      '  region: string;',
      '  /** Phase de départ au Mondial 2026. */',
      '  phase: string;',
      '  /** Logo local (même origine : peint dans la broderie de l\'étendard). */',
      '  logo: string;',
      '  fabricA: number;',
      '  fabricB: number;',
      '  sheen: number;',
      '  glow: number;',
      '  thread: "gold" | "silver";',
      '}',
      '',
      'export const WORLDS_2026_TEAMS: readonly TeamBrand[] = [']
for r in rows:
    ts.append(f'  {{ code: "{r["code"]}", name: {json.dumps(r["name"])}, region: "{r["region"]}", phase: "{r["phase"]}", logo: "{r["logo"]}", fabricA: {r["fabricA"]}, fabricB: {r["fabricB"]}, sheen: {r["sheen"]}, glow: {r["glow"]}, thread: "{r["thread"]}" }},')
ts += ['];', '', 'export function teamBrand(code: string): TeamBrand | undefined {', '  return WORLDS_2026_TEAMS.find((t) => t.code === code);', '}', '']
open(os.path.join(ROOT, "src", "lib", "team-brands.ts"), "w", encoding="utf-8", newline="\n").write("\n".join(ts))
print(len(rows), "équipes écrites")
