"""Consumption report across all middlewares."""
import os, sys, json
from datetime import datetime, timezone, timedelta
sys.path.insert(0, '.')
from dotenv import load_dotenv
load_dotenv('.env')
import httpx

PAT = os.environ.get('SUPABASE_PAT')
REF = os.environ.get('SUPABASE_PROJECT_REF', 'guasqaistzpeapxoyxrc')
MGMT = f'https://api.supabase.com/v1/projects/{REF}/database/query'
HEADERS = {'Authorization': f'Bearer {PAT}', 'Content-Type': 'application/json'} if PAT else {}

if not PAT:
    print("WARNING: SUPABASE_PAT not set in .env — DB queries will be skipped.")
    print("         Set it in worker/.env to enable the DB size / table / index reports.")


def section(t: str):
    print(f"\n{'═' * 72}\n  {t}\n{'═' * 72}")


def query(sql: str, timeout: int = 60):
    try:
        r = httpx.post(MGMT, headers=HEADERS, json={"query": sql}, timeout=timeout)
        if r.status_code in (200, 201):
            return r.json()
    except Exception as e:
        return None
    return None


print("=" * 72)
print(f"  CONSOMMATION — kckills middlewares — {datetime.now(timezone.utc).isoformat()[:19]} UTC")
print("=" * 72)

# ─── SUPABASE STORAGE ────────────────────────────────────────────
section("SUPABASE — taille DB + egress")

# Total DB size
rows = query("""
    SELECT pg_size_pretty(pg_database_size(current_database())) AS db_size,
           pg_database_size(current_database()) AS bytes;
""")
if rows:
    print(f"  Taille DB totale : {rows[0]['db_size']}")
    bytes_used = rows[0]['bytes']
    pct = 100 * bytes_used / (500 * 1024 * 1024)  # 500 MB free tier
    bar = "█" * int(pct / 2)
    print(f"  Free tier (500 MB) : {pct:.1f}% utilisé {bar}")

# Top 10 tables by size
print("\n  Top 15 tables par taille :")
rows = query("""
    SELECT relname AS table_name,
           pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
           pg_size_pretty(pg_relation_size(relid)) AS table_size,
           pg_size_pretty(pg_total_relation_size(relid) - pg_relation_size(relid)) AS indexes_toast,
           pg_total_relation_size(relid) AS bytes
    FROM pg_catalog.pg_statio_user_tables
    ORDER BY pg_total_relation_size(relid) DESC
    LIMIT 15;
""")
if rows:
    for r in rows:
        print(f"    {r['table_name']:<30} total={r['total_size']:<10} table={r['table_size']:<10} idx/toast={r['indexes_toast']}")

# Index sizes
print("\n  Top 10 indexes par taille :")
rows = query("""
    SELECT indexrelname AS idx,
           pg_size_pretty(pg_relation_size(indexrelid)) AS size
    FROM pg_stat_user_indexes
    ORDER BY pg_relation_size(indexrelid) DESC
    LIMIT 10;
""")
if rows:
    for r in rows:
        print(f"    {r['idx']:<40} {r['size']}")

# Row counts on key tables
print("\n  Rows comptés (top 10 tables) :")
rows = query("""
    SELECT relname, n_live_tup AS rows
    FROM pg_stat_user_tables
    ORDER BY n_live_tup DESC
    LIMIT 12;
""")
if rows:
    for r in rows:
        print(f"    {r['relname']:<30} {r['rows']:>10,} rows")

# ─── R2 STORAGE ──────────────────────────────────────────────────
section("CLOUDFLARE R2 — taille bucket clips")

try:
    import boto3
    from botocore.config import Config
    s3 = boto3.client(
        's3',
        endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'],
        aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'],
        region_name='auto',
        config=Config(signature_version='s3v4', retries={'max_attempts': 1}),
    )
    bucket = os.environ['R2_BUCKET_NAME']

    # List + sum
    paginator = s3.get_paginator('list_objects_v2')
    total_bytes = 0
    total_count = 0
    by_prefix = {}
    for page in paginator.paginate(Bucket=bucket):
        for obj in page.get('Contents', []):
            total_bytes += obj['Size']
            total_count += 1
            # Categorize by prefix
            key = obj['Key']
            if '/' in key:
                prefix = key.split('/')[0]
            else:
                prefix = 'root'
            by_prefix.setdefault(prefix, {'bytes': 0, 'count': 0})
            by_prefix[prefix]['bytes'] += obj['Size']
            by_prefix[prefix]['count'] += 1
    print(f"  Total objets : {total_count:,}")
    gb_used = total_bytes / 1024 / 1024 / 1024
    print(f"  Total taille : {gb_used:.2f} GB")
    pct = 100 * gb_used / 10  # 10 GB free tier
    bar = "█" * int(pct / 2)
    print(f"  Free tier (10 GB) : {pct:.1f}% utilisé {bar}")
    print(f"\n  Par prefix (top 10) :")
    for prefix, data in sorted(by_prefix.items(), key=lambda x: -x[1]['bytes'])[:10]:
        gb = data['bytes'] / 1024 / 1024 / 1024
        print(f"    {prefix:<30} {gb:>6.2f} GB  ({data['count']:,} objects)")
except Exception as e:
    print(f"  ERROR : {str(e)[:200]}")

# ─── GEMINI / AI USAGE ───────────────────────────────────────────
section("GEMINI — appels API et coûts estimés")

# Count gemini calls from daemon log
import subprocess
try:
    log = 'logs/daemon.log'
    total_done = subprocess.run(['grep', '-c', 'gemini_analysis_done', log], capture_output=True, text=True).stdout.strip()
    total_errors = subprocess.run(['grep', '-c', 'gemini_error', log], capture_output=True, text=True).stdout.strip()
    total_qc = subprocess.run(['grep', '-c', 'qc_global_summary\\|quotes_extracted', log], capture_output=True, text=True).stdout.strip()
    print(f"  gemini_analysis_done logs : {total_done}")
    print(f"  gemini_error logs : {total_errors}")
    print(f"  quotes_extracted logs : {total_qc}")
except Exception as e:
    print(f"  Couldn't parse daemon log : {e}")

# Wave 33 — real cost breakdown from ai_annotations table (per-model
# spend). Group by `model_name`, sum `_cost` returned by analyzer.
# Falls back to estimated rates when DB unreachable.
print("\n  Breakdown réel par modèle (ai_annotations, 30 derniers jours) :")
try:
    sql = """
        SELECT model_name,
               COUNT(*) AS calls,
               COALESCE(SUM(cost_usd), 0) AS total_usd,
               COALESCE(AVG(cost_usd), 0) AS avg_usd
        FROM ai_annotations
        WHERE created_at > now() - interval '30 days'
        GROUP BY model_name
        ORDER BY total_usd DESC NULLS LAST
        LIMIT 10;
    """
    rows = query(sql, timeout=20) if PAT else None
    if rows:
        print(f"    {'Model':<32} {'Calls':>8} {'Total $':>10} {'Avg $':>10}")
        grand = 0.0
        for r in rows:
            m = (r.get('model_name') or '?')[:32]
            n = int(r.get('calls') or 0)
            t = float(r.get('total_usd') or 0)
            a = float(r.get('avg_usd') or 0)
            grand += t
            print(f"    {m:<32} {n:>8,} {t:>10.3f} {a:>10.5f}")
        print(f"    {'-'*32} {'-'*8} {'-'*10}")
        print(f"    {'TOTAL':<32} {'':>8} {grand:>10.3f}")
    else:
        print("    (DB unreachable or no rows — falling back to estimates)")
        print("    - Gemini 3.1 Flash-Lite : $0.10 in / $0.40 out per 1M tokens")
        print("    - Gemini 3.5 Flash      : $1.50 in / $9.00 out per 1M tokens")
        print("    - Per-clip analyzer at lite : ~$0.0004 ; at 3.5-flash : ~$0.045")
except Exception as e:
    print(f"    ERROR : {str(e)[:200]}")

# Count QC artifacts
from pathlib import Path
qc_files = list(Path('deep_qc').glob('qc_global_results_*.json'))
total_qc_runs = 0
for f in qc_files:
    try:
        data = json.loads(f.read_text(encoding='utf-8'))
        total_qc_runs += len(data)
    except: pass
print(f"\n  Total QC runs (deep_qc/*.json) : {total_qc_runs:,}")
print(f"  (Coût détaillé visible dans le breakdown ai_annotations ci-dessus)")

# Try Gemini billing via API
print("\n  Pour le détail facturation, vérifier :")
print("    → https://aistudio.google.com/app/usage")
print("    → console.cloud.google.com (Billing → Reports)")

# ─── VERCEL ──────────────────────────────────────────────────────
section("VERCEL — Compute + Bandwidth")
print("  Free tier 'hobby' :")
print("    - Bandwidth : 100 GB/mois")
print("    - Function execution : 100 GB-Hours/mois")
print("    - Build minutes : 6 000 min/mois")
print()
print("  Vérifier sur https://vercel.com/maestromed/kckills/usage")
print()

# Count recent deploys via git log
import subprocess
deploys = subprocess.run(['git', 'log', '--oneline', '--since=7.days', '--', '.'],
                          capture_output=True, text=True, cwd='..').stdout.strip().split('\n')
print(f"  Commits (= deploys probables) ces 7 jours : {len(deploys)}")

# ─── ANTHROPIC CLAUDE (worker moderation) ────────────────────────
section("CLAUDE HAIKU — modération")
moder_count = subprocess.run(['grep', '-c', 'moderator_done', 'logs/daemon.log'],
                              capture_output=True, text=True).stdout.strip()
print(f"  moderator_done logs : {moder_count}")
print(f"  Tarif Haiku 4.5 input : $1/M tokens, output : $5/M tokens")
print(f"  Coût par commentaire modéré : ~$0.0001")
try:
    n = int(moder_count) if moder_count.isdigit() else 0
    print(f"  Coût total estimé : ~${n * 0.0001:.3f}")
except:
    pass

# ─── YOUTUBE / YT-DLP ────────────────────────────────────────────
section("YOUTUBE — yt-dlp + Data API")
dl_ok = subprocess.run(['grep', '-c', 'vod_download_done', 'logs/daemon.log'],
                       capture_output=True, text=True).stdout.strip()
dl_fail = subprocess.run(['grep', '-c', 'vod_download_failed\\|ytdlp_nonzero', 'logs/daemon.log'],
                          capture_output=True, text=True).stdout.strip()
yt_search = subprocess.run(['grep', '-c', 'youtube_search', 'logs/daemon.log'],
                            capture_output=True, text=True).stdout.strip()
print(f"  vod_download_done : {dl_ok}")
print(f"  vod_download_failed : {dl_fail}")
print(f"  youtube_search appels (Data API) : {yt_search}")
print(f"\n  YouTube Data API free tier : 10 000 units/jour")
print(f"  search.list = 100 units (1% du quotidien)")
print(f"  videos.list = 1 unit")
print(f"  → si on fait 50 searches/jour = 5 000 units = 50% du free tier")

# ─── DAEMON UPTIME ───────────────────────────────────────────────
section("DAEMON — uptime et activité")
import os.path
try:
    log_size = os.path.getsize('logs/daemon.log') / 1024 / 1024
    print(f"  logs/daemon.log : {log_size:.1f} MB")
    first_line = subprocess.run(['head', '-1', 'logs/daemon.log'],
                                 capture_output=True, text=True).stdout.strip()
    last_line = subprocess.run(['tail', '-1', 'logs/daemon.log'],
                                capture_output=True, text=True).stdout.strip()
    print(f"  premier log : {first_line[:120]}")
    print(f"  dernier log : {last_line[:120]}")
except Exception as e:
    print(f"  Couldn't read log : {e}")

# ─── RÉCAP ──────────────────────────────────────────────────────
section("RÉCAP COÛT MENSUEL ESTIMÉ")
print("""
  Service          | Free tier        | Notre conso     | Coût $/mois
  -----------------+------------------+-----------------+-------------
  Supabase         | 500MB DB + 5GB   | (voir au-dessus)| 0 si OK, sinon 25
  Cloudflare R2    | 10GB + 0 egress  | (voir au-dessus)| 0 si OK
  Vercel hobby     | 100GB bandwidth  | (vérifier en .) | 0 si OK
  Gemini paid      | pay-per-use      | ~3500 QC calls  | ~$1-2
  Claude Haiku     | pay-per-use      | (voir au-dessus)| <$1
  YouTube Data API | 10k units/jour   | (voir au-dessus)| 0
  -----------------+------------------+-----------------+-------------
  TOTAL ESTIMÉ                                          | ~$2-5/mois

  Le projet a coûté entre 5 et 20€ depuis le début (avril-mai 2026),
  principalement Gemini balanced tier pour le backfill historique.
""")
print("=" * 72)
