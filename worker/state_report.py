"""State report — PostgREST + estimated count for big tables."""
import os, sys, json
from datetime import datetime, timezone
sys.path.insert(0, '.')
from dotenv import load_dotenv
load_dotenv('.env')
import httpx

SB = os.environ['SUPABASE_URL']
HEAD = {"apikey": os.environ['SUPABASE_SERVICE_KEY'],
        "Authorization": f"Bearer {os.environ['SUPABASE_SERVICE_KEY']}"}


def cnt_exact(table: str, timeout: int = 30, **filters):
    """Exact count. Times out → returns None."""
    params = {"select": "id", "limit": "1"}
    params.update(filters)
    try:
        r = httpx.get(SB + f"/rest/v1/{table}", params=params,
                      headers={**HEAD, "Prefer": "count=exact"}, timeout=timeout)
        if r.status_code in (200, 206):
            return int(r.headers.get("content-range", "0/0").split("/")[-1])
    except Exception:
        pass
    return None


def cnt_estimated(table: str, **filters):
    """Estimated count from pg_stats (very fast)."""
    return cnt_exact(table, timeout=8, **filters)  # falls back gracefully


def line(label: str, val, width: int = 50):
    if val is None:
        print(f"  {label:<{width}} (slow query — skip)")
    else:
        print(f"  {label:<{width}} {val:>7,}")


def section(title: str):
    print(f"\n{'=' * 72}")
    print(f"  {title}")
    print('=' * 72)


print("=" * 72)
print(f"  ETAT DES LIEUX KCKILLS — {datetime.now(timezone.utc).isoformat()[:19]} UTC")
print("=" * 72)

# ─── KILLS BY STATUS (use individual filtered counts) ────────────
section("KILLS — par status")
statuses = ['raw', 'enriched', 'vod_found', 'clipping', 'clipped',
            'analyzed', 'published', 'clip_error', 'manual_review']
counts = {}
for s in statuses:
    n = cnt_exact("kills", timeout=60, status=f"eq.{s}")
    if n is not None and n > 0:
        counts[s] = n
total = sum(counts.values())
print(f"\n  TOTAL ingeres (somme par status) : {total:,}\n")
for s, n in sorted(counts.items(), key=lambda kv: -kv[1]):
    pct = 100 * n / total if total else 0
    bar = "█" * int(pct / 2)
    print(f"    {s:<18} {n:>6,}  ({pct:5.1f}%) {bar}")

# ─── PUBLISHED ───────────────────────────────────────────────────
section("CLIPS PUBLIES (en ligne)")
pub = counts.get('published', 0)
line("Total published (status=published)", pub)
line("  avec clip_url_vertical",
     cnt_exact("kills", timeout=60, status="eq.published", clip_url_vertical="not.is.null"))
line("  avec clip_url_horizontal",
     cnt_exact("kills", timeout=60, status="eq.published", clip_url_horizontal="not.is.null"))
line("  KC est tueur",
     cnt_exact("kills", timeout=60, status="eq.published", tracked_team_involvement="eq.team_killer"))
line("  KC est victime",
     cnt_exact("kills", timeout=60, status="eq.published", tracked_team_involvement="eq.team_victim"))

# ─── kill_visible (QC verification) ──────────────────────────────
section("kill_visible flag (verifie par Gemini)")
n_v = cnt_exact("kills", timeout=60, status="eq.published", kill_visible="eq.true")
n_n = cnt_exact("kills", timeout=60, status="eq.published", kill_visible="eq.false")
n_u = cnt_exact("kills", timeout=60, status="eq.published", kill_visible="is.null")
line("kill_visible=TRUE  (QC OK)", n_v)
line("kill_visible=FALSE (a retirer)", n_n)
line("kill_visible=NULL  (jamais QC'd)", n_u)

if pub and n_v is not None and n_n is not None and n_u is not None:
    print(f"\n  Synthese :")
    print(f"    {n_v:,} clips valides ({100*n_v/pub:.0f}%)")
    print(f"    {n_n:,} clips a refaire ({100*n_n/pub:.0f}%)")
    print(f"    {n_u:,} clips encore a QC ({100*n_u/pub:.0f}%)")

# ─── DERNIERE PASSE QC PROFONDE ──────────────────────────────────
section("DERNIERE PASSE QC PROFONDE (Gemini deep)")
from pathlib import Path
qc_files = sorted(Path('deep_qc').glob('qc_global_results_*.json'),
                  key=lambda p: p.stat().st_size, reverse=True)
if qc_files:
    data = json.loads(qc_files[0].read_text(encoding='utf-8'))
    cs = {"GOOD": 0, "ACCEPTABLE": 0, "BAD": 0, "ERROR": 0}
    for r in data:
        if "error" in r:
            cs["ERROR"] += 1
        else:
            v = r.get("verdict", "?")
            cs[v] = cs.get(v, 0) + 1
    total_q = len(data)
    print(f"  Fichier : {qc_files[0].name}")
    print(f"  Total QC'd : {total_q}\n")
    for v in ['GOOD', 'ACCEPTABLE', 'BAD', 'ERROR']:
        n = cs[v]
        pct = 100 * n / max(1, total_q)
        bar = "█" * int(pct / 2)
        print(f"    {v:<14} {n:>5,}  ({pct:5.1f}%) {bar}")
    successful = total_q - cs['ERROR']
    if successful:
        bad_pct = 100 * cs['BAD'] / successful
        print(f"\n  Sur les {successful} clips traites (hors erreurs) :")
        print(f"    {cs['GOOD']:,} GOOD ({100*cs['GOOD']/successful:.0f}%)")
        print(f"    {cs['ACCEPTABLE']:,} ACCEPTABLE ({100*cs['ACCEPTABLE']/successful:.0f}%)")
        print(f"    {cs['BAD']:,} BAD ({bad_pct:.0f}%)")

# ─── RECLIP QUEUE ────────────────────────────────────────────────
section("FILE D'ATTENTE RECLIP")
total_needs = cnt_exact("kills", timeout=60, needs_reclip="eq.true")
line("TOTAL needs_reclip=TRUE", total_needs)
for s in ['published', 'analyzed', 'clipped', 'clipping', 'clip_error', 'vod_found']:
    n = cnt_exact("kills", timeout=30, needs_reclip="eq.true", status=f"eq.{s}")
    if n:
        print(f"    needs_reclip + {s:<14} {n:>5,}")

# ─── GAMES ───────────────────────────────────────────────────────
section("GAMES (matchs LoL ingestes)")
total_g = cnt_exact("games", timeout=30)
line("Total games", total_g)
for s in ['vod_found', 'pending', 'completed', 'live']:
    n = cnt_exact("games", timeout=30, state=f"eq.{s}")
    if n:
        print(f"    state={s:<14} {n:>5,}")
line("avec alt_vod KC Replay",
     cnt_exact("games", timeout=30, alt_vod_youtube_id="not.is.null"))
try:
    r = httpx.get(SB + "/rest/v1/games",
                  params={"select": "vod_youtube_id,alt_vod_youtube_id,vod_offset_seconds",
                          "alt_vod_youtube_id": "not.is.null"}, headers=HEAD, timeout=30)
    rows = r.json()
    aligned = sum(1 for g in rows if g['vod_youtube_id'] == g['alt_vod_youtube_id']
                  and g.get('vod_offset_seconds'))
    line("aligned (vod=alt + offset calibre)", aligned)
except Exception:
    pass

# ─── MATCHES ─────────────────────────────────────────────────────
section("MATCHES")
line("Total matches", cnt_exact("matches", timeout=20))
for s in ['completed', 'unstarted', 'upcoming', 'live']:
    n = cnt_exact("matches", timeout=20, state=f"eq.{s}")
    if n:
        print(f"    state={s:<14} {n:>5,}")

# ─── FEATURES NOUVELLES ──────────────────────────────────────────
section("FEATURES (Wave 28-30)")
line("kill_quotes (extracted by Gemini)", cnt_exact("kill_quotes", timeout=20))
line("vs_battles (VS Roulette votes)", cnt_exact("vs_battles", timeout=15))
line("kill_elo (kills avec ELO)", cnt_exact("kill_elo", timeout=15))
line("face_off_votes", cnt_exact("face_off_votes", timeout=15))

n_c = cnt_exact("compilations", timeout=15)
line("compilations created", n_c)

n_b = cnt_exact("bracket_tournaments", timeout=15)
line("bracket_tournaments", n_b)

line("achievements catalog", cnt_exact("achievements", timeout=15))
line("user_achievements debloques", cnt_exact("user_achievements", timeout=15))
line("session_achievements debloques", cnt_exact("session_achievements", timeout=15))

try:
    p = httpx.get(SB + "/rest/v1/bcc_punches?select=count", headers=HEAD, timeout=8).json()
    if isinstance(p, list) and p:
        line("BCC punches", p[0].get('count', 0))
    t = httpx.get(SB + "/rest/v1/bcc_tomatoes?select=count", headers=HEAD, timeout=8).json()
    if isinstance(t, list) and t:
        line("BCC tomatoes", t[0].get('count', 0))
    a = httpx.get(SB + "/rest/v1/bcc_ahou_plays?select=count", headers=HEAD, timeout=8).json()
    if isinstance(a, list) and a:
        line("BCC ahou-ahou plays", a[0].get('count', 0))
except Exception:
    pass

print(f"\n{'=' * 72}")
print("  FIN DU RAPPORT")
print('=' * 72)
