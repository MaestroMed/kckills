# Analytics & Ops setup — KCKills (Wave 13d, 2026-04-28)

This doc captures the manual steps the operator (Mehdi) needs to do
ONCE so the new Wave 13d analytics + ops infrastructure actually fires
in production. Everything below is OUTSIDE the code commits — env vars
on Vercel, cron schedules, dashboard config.

---

## 1. 🔥 Apply migration 050 (security fixes — CRITICAL)

The Supabase advisor flagged 4 critical issues. Migration 050 fixes
them all. Apply ASAP — `kill_tags` is currently writable by any
visitor with the anon key.

**Steps :**
1. Open https://supabase.com/dashboard/project/guasqaistzpeapxoyxrc/sql/new
2. Paste the contents of `supabase/migrations/050_security_advisor_fixes.sql`
3. Click **Run**
4. Verify the advisor count drops from 10 → 6 (the 4 critical items
   should disappear)

---

## 2. 📊 Vercel env vars (Umami + sanity check)

The 2026-04-28 audit found Umami isn't loaded on the live page because
the env vars aren't set on Vercel.

**Steps :**
1. Go to https://vercel.com/<your-project>/settings/environment-variables
2. Add the following for **Production** environment :

```
NEXT_PUBLIC_UMAMI_SRC = https://cloud.umami.is/script.js
NEXT_PUBLIC_UMAMI_WEBSITE_ID = <your website ID from cloud.umami.is dashboard>
```

3. Save → trigger a redeploy from the Vercel dashboard (or push any
   commit to `main` since the project is gated to deploy only on `main`)
4. Visit https://www.kckills.com in a fresh browser tab → open DevTools
   → Network → search for `umami` → you should see a request to
   `cloud.umami.is/script.js` succeed
5. The Umami dashboard should start counting your sessions immediately

**While you're in the env vars panel, verify these are set too** :
- `SUPABASE_URL` (public)
- `NEXT_PUBLIC_SUPABASE_URL` (same value)
- `SUPABASE_SERVICE_ROLE_KEY` (server-only)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_SITE_URL = https://www.kckills.com`
- `NEXT_PUBLIC_SENTRY_DSN` (if you've set up Sentry)
- `SENTRY_AUTH_TOKEN` (server-only, for source-map upload)
- `SENTRY_ORG`, `SENTRY_PROJECT`

---

## 3. 🔁 Vercel Analytics (auto-enabled, just verify)

Wave 13d shipped `@vercel/analytics` + `@vercel/speed-insights`. Vercel
auto-enables them when the package is detected.

**Verify :**
1. Go to https://vercel.com/<your-project>/analytics
2. Within ~10 min of the next deploy you should see real-time
   pageview counts + Web Vitals (LCP, CLS, FCP, INP)
3. Speed Insights tab → core web vitals over time

Both are FREE on hobby tier (up to 2.5k events/month each).

---

## 4. 🛡 Cloudflare cache rules (push hit rate 68% → 90%)

Cloudflare audit shows 86 GB served / 30 days, 68.7 % cached. We can
push that to 85-90% by aggressively caching static assets + clip MP4s.

**Steps :**
1. Cloudflare dashboard → kckills.com → Caching → Cache Rules
2. Add a rule named "Cache static + clips aggressively" :
   - **If incoming requests match :** URI Path matches one of :
     - `/_next/static/*` (Next.js static chunks — already immutable)
     - `*.mp4`
     - `*.webm`
     - `*.jpg` `*.jpeg` `*.png` `*.webp` `*.avif` `*.gif`
     - `*.woff` `*.woff2` `*.ttf`
     - `/api/og/*` (OG images already on R2 but Cloudflare can edge-cache too)
   - **Then take action :** Cache eligibility = Eligible for cache
   - **Edge TTL :** 30 days (`2592000`)
   - **Browser TTL :** 7 days (`604800`)
3. Save + deploy
4. After ~1 hour the analytics should show the cache hit % climbing

Skip ANY rule for `/api/track`, `/api/track/pixel`, `/api/v1/*`, and
`/scroll` — those need fresh responses.

---

## 5. 💾 Postgres weekly backup (Sunday 04:00 UTC)

Wave 13d added `worker/scripts/backup_supabase.py`. Run weekly to keep
8 backups (~2 months of recovery history) on R2.

### Required env vars (in `worker/.env`)

```
SUPABASE_DB_URL=postgres://postgres.guasqaistzpeapxoyxrc:<password>@aws-0-eu-west-1.pooler.supabase.com:5432/postgres
R2_ACCOUNT_ID=...        # from Cloudflare dashboard
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=kckills-clips
DISCORD_WATCHDOG_URL=... # optional, for backup status pings
```

`SUPABASE_DB_URL` : Supabase dashboard → Settings → Database →
Connection string → **Session** mode (NOT Transaction — pg_dump
needs multi-statement sessions). Replace `[YOUR-PASSWORD]` with the
DB password (visible once on project creation, can be reset).

### Install pg_dump 17

The script needs `pg_dump` ≥ 17 in PATH (matches the Postgres version
once we upgrade Supabase to PG 17 per the SOTA roadmap).

- **Windows** : download Postgres 17 from postgresql.org → installer
  adds `pg_dump.exe` to PATH automatically
- **macOS** : `brew install libpq && brew link --force libpq`
- **Linux (Debian/Ubuntu)** : `sudo apt install postgresql-client-17`

### Run manually first (verify it works)

```bash
cd worker
python scripts/backup_supabase.py --dry-run
```

You should see :
```
=== Supabase backup → R2 : backups/supabase/2026-04-28-...dump.gz ===
  Mode : DRY-RUN
  Running pg_dump (custom format, no owner/privileges)...
  Dump complete : XX MB raw
  Gzipped : YY MB (Z% saved)
  [--dry-run] Skipping R2 upload + retention.
```

If that works, drop `--dry-run` and run a real one to upload :
```bash
python scripts/backup_supabase.py
```

Verify on the R2 dashboard (`kckills-clips` bucket → `backups/supabase/`)
that the file landed.

### Schedule weekly (Sunday 04:00 UTC)

**Windows Task Scheduler :**
1. Open Task Scheduler → Create Task
2. Triggers → New : Weekly, Sundays, 04:00
3. Actions → New : Start a program
   - Program : `python.exe` (or full path to your Python)
   - Arguments : `worker/scripts/backup_supabase.py`
   - Start in : `C:\Users\Matter1\Karmine_Stats\`
4. Conditions → uncheck "Start the task only if computer is on AC power"
   (so backups still run on a laptop)
5. Save

**Linux/macOS cron :**
```bash
crontab -e
# Add :
0 4 * * 0 cd /path/to/Karmine_Stats && python worker/scripts/backup_supabase.py >> /var/log/kckills-backup.log 2>&1
```

### Restore (in case of disaster)

```bash
# Download from R2 dashboard or via aws-cli
aws s3 cp s3://kckills-clips/backups/supabase/2026-04-28-040000.dump.gz . \
  --endpoint-url https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com

# Decompress
gunzip 2026-04-28-040000.dump.gz

# Restore into a fresh Supabase project (recreate schema first if needed)
pg_restore --no-owner --no-privileges --dbname=$NEW_DB_URL \
  --jobs=4 2026-04-28-040000.dump
```

---

## 6. 📈 Cleaner analytics signal — what's now in place

After Wave 13d deploys, your visibility into who-visits-what should
jump from ~6 % to ~90 % :

| Source | What it captures | When to check |
|---|---|---|
| **Vercel Analytics** | Every edge request, real & bots, FREE | https://vercel.com/<project>/analytics |
| **Vercel Speed Insights** | Core Web Vitals over time | Same place, Speed tab |
| **Umami** (once env vars set) | Real users only (filters bots), GDPR-safe | https://cloud.umami.is/dashboard |
| **`user_events` table** | Custom events (clip.viewed, etc.) — bot-filtered | Supabase SQL editor |
| **`/api/track/pixel`** | Visitors with adblockers — fallback | Same `user_events` with `metadata->>source = 'pixel'` |
| **Cloudflare Analytics** | Edge requests, bot vs human, bandwidth | Cloudflare dashboard |
| **R2 access logs** (if enabled) | Per-clip download counts (ENGAGEMENT signal) | R2 → bucket → settings → enable logs |

The combination tells you :
- **Vercel Analytics** : raw traffic
- **`user_events`** : actual user behaviour (clipped, voted, scrolled)
- **R2 access logs** : what clips actually get watched (BEST engagement signal)

---

## 7. ⚠️ Action items checklist

Copy this into your todo app :

- [ ] Apply migration 050 in Supabase SQL editor (5 min, **DO FIRST**)
- [ ] Add `NEXT_PUBLIC_UMAMI_SRC` + `NEXT_PUBLIC_UMAMI_WEBSITE_ID` on Vercel + redeploy
- [ ] Verify Vercel Analytics tab shows data within 24h
- [ ] Add Cloudflare cache rule for static + MP4
- [ ] Install pg_dump 17 locally
- [ ] Add `SUPABASE_DB_URL` to `worker/.env`
- [ ] Test `python worker/scripts/backup_supabase.py --dry-run`
- [ ] Test real `python worker/scripts/backup_supabase.py`
- [ ] Schedule weekly via Task Scheduler / cron
- [ ] Enable R2 access logs on `clips.kckills.com` bucket
- [ ] Upgrade Supabase to Postgres 17 (per SOTA roadmap, off-hours)
- [ ] Upgrade R2 to paid plan (per the standing pending action)

---

*Last updated 2026-04-28 by Wave 13d. Next review : after the first
backup runs successfully + Umami env vars land in prod.*
