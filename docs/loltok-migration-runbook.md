# LoLTok — Migration Runbook (KC pilot → Phase 1 multi-team Europe)

**Author:** Agent CA (Wave 10 swarm)
**Date:** 2026-04-25
**Audience:** Mehdi, executing the migration over a long weekend
**Estimated total time:** 6-12 hours (across 2-3 sessions, with bake periods)

> **Reading guide:** This is the playbook for going from KC-only to multi-team Europe. Follow it top to bottom. Each step has a `Verify` block — do not advance until verification passes. Each phase has a `Rollback` block — revert is always free if you keep the old env values.

---

## 0. Philosophy

- **The KC pilot must NOT regress.** Every change is feature-flagged with KC-only as the safe default.
- **Worker-first, frontend-second, feature-flag-third.** Deploy the worker code that supports new teams. Deploy the frontend that supports rendering new teams. THEN flip the env var to actually start ingesting new teams.
- **One league at a time.** Don't enable LFL + EU Masters in the same evening. Enable LFL, bake 24h, then EU Masters.
- **Rollback is free.** All changes are env-var driven. Reverting an env var takes 30 seconds.

---

## 1. Pre-migration checklist (do this 1 week before)

| Check | How | Pass condition |
|-------|-----|----------------|
| Phase 0 stability | `worker/scripts/status.sh` | 7 consecutive days, zero unrecovered DLQ |
| DB backup | Run `pg_dump` to R2 | Backup file > 100 KB, last_modified < 24h |
| Disk space on PC | `df -h` (or PowerShell equivalent) | > 50 GB free for new clips |
| R2 storage | Cloudflare dashboard | < 5 GB used (free tier headroom) |
| Supabase egress (current month) | Supabase dashboard | < 3 GB |
| Discord webhook auth | Send a test ping | 200 OK |
| `kckills.com` DNS | `dig kckills.com` | Resolves correctly |
| Cookie file freshness | Check Firefox profile timestamp | < 7 days old |
| Operator availability | Calendar | Free for 12h Friday-Sunday |
| EtoStark notified | Discord DM | "FYI infra change this weekend" |

**If any check fails → fix before proceeding. Do not migrate during instability.**

---

## 2. Backup checkpoint (always do this first)

```bash
# 2.1 Database backup
cd worker
python scripts/backup_db.py --to-r2 --tag "pre-phase1-$(date +%Y%m%d)"
# Verify
python scripts/list_backups.py | head -3

# 2.2 Local SQLite cache backup
cp local_cache.db local_cache.db.bak.pre-phase1

# 2.3 .env snapshot
cp .env .env.bak.pre-phase1

# 2.4 Save current Vercel env state
# (use Vercel CLI or dashboard screenshot)
vercel env pull .env.vercel.bak.pre-phase1
```

**Verify:**
- `r2 ls backups/` shows a fresh file dated today
- `local_cache.db.bak.pre-phase1` exists, > 1 MB
- `.env.bak.pre-phase1` exists with `KCKILLS_TRACKED_TEAMS=karmine-corp`

---

## 3. Code prerequisites (Wave 10 must be merged)

Before this runbook can be executed, the following Wave 10 PRs must be on `main`:

| PR | Owner | What it does | Status |
|----|-------|--------------|--------|
| PR-arch storage abstraction | Wave 10 | `StorageBackend` interface, R2 + local fs implementations | check `git log` |
| PR-arch multi-team config | Wave 10 | `KCKILLS_TRACKED_TEAMS` reads list of slugs, default `karmine-corp` | check `git log` |
| PR-arch multi-league sentinel | Wave 10 | `KCKILLS_TRACKED_LEAGUES` enables league filter | check `git log` |
| PR-arch feature flag `LOLTOK_PUBLIC` | Wave 10 | `NEXT_PUBLIC_LOLTOK_PUBLIC` toggles multi-team UI | check `git log` |
| PR-arch frontend `/team/[slug]` | Wave 10 | Team profile pages render for any team | check `git log` |

**Verify:**

```bash
git log --oneline | grep -E "(storage abstraction|multi-team config|multi-league sentinel|LOLTOK_PUBLIC|/team/\[slug\])"
```

All 5 lines should appear. If any are missing → wait for the swarm to ship them, then proceed.

---

## 4. Step-by-step: enable LFL (first new league)

### 4.1 Pre-checks (15 min)

```bash
# Verify schedule API returns LFL
cd worker
python -c "from services.lolesports_api import client; print([t for t in client.get_teams() if 'LFL' in t.get('league','')])"
# Should return ~10 teams with `is_tracked: false`
```

### 4.2 ENV var changes — worker

Edit `worker/.env`:

```diff
- KCKILLS_TRACKED_TEAMS=karmine-corp
+ KCKILLS_TRACKED_TEAMS=karmine-corp,bds-academy,gentle-mates,joblife,izi-dream,vitality-bee,solary,gameward,team-mce,m1ssion

- KCKILLS_TRACKED_LEAGUES=lec
+ KCKILLS_TRACKED_LEAGUES=lec,lfl

# NEW (storage layout)
+ KCKILLS_STORAGE_LAYOUT=multi_team   # values: legacy | multi_team
+ KCKILLS_STORAGE_BACKEND=r2          # values: r2 | local_fs (for tests)
```

**Verify:**

```bash
python -c "from config import settings; print(settings.tracked_teams)"
# Output: ['karmine-corp', 'bds-academy', ...]
```

### 4.3 Deploy order — worker first

```bash
# 4.3a Restart worker with new env (do NOT restart frontend yet)
cd worker
./scripts/restart.sh
# OR if running via systemd
sudo systemctl restart loltok-worker

# 4.3b Tail logs for 5 min
tail -f worker_startup.log
# Watch for:
#   "sentinel: tracking 10 teams across 2 leagues"
#   "harvester: ready"
#   No ERROR lines
```

**Smoke test:**

```bash
# Confirm sentinel detects an LFL match
python scripts/smoke_test_sentinel.py --league lfl
# Should output 1+ upcoming LFL matches
```

**If smoke test fails →** restore `.env.bak.pre-phase1` and restart worker. Investigate.

### 4.4 Deploy frontend (no behavior change yet)

```bash
cd web
git pull origin main
# Verify the team/[slug] page exists
ls src/app/team
# Should show: [slug]
vercel --prod
```

**Verify:**

- Visit `https://kckills.com/team/karmine-corp` → renders KC team page (existing behavior, no regression)
- Visit `https://kckills.com/scroll` → still shows KC kills only (because `LOLTOK_PUBLIC=false` not yet flipped)

### 4.5 Bake period (24h, MANDATORY)

Let the worker ingest LFL matches for 24 hours WITHOUT exposing them on the frontend. This validates the pipeline at 2× volume.

**Monitor every 6h:**

```bash
# CLI dashboard
python worker/scripts/live_dashboard.py
# Look for:
#   - DLQ count not growing
#   - Pipeline jobs succeeding
#   - R2 storage growing reasonably (~50 MB / new clip)
#   - No new ERROR lines
```

**If DLQ grows by > 10 in 24h →** pause LFL ingestion (revert `KCKILLS_TRACKED_LEAGUES=lec`), investigate, fix, retry.

### 4.6 Flip the public flag (the moment of truth)

After 24h bake, flip the public flag:

```bash
cd web
# Edit Vercel env via CLI (or dashboard)
vercel env add NEXT_PUBLIC_LOLTOK_PUBLIC production
# Value: true
vercel env add NEXT_PUBLIC_DEFAULT_TEAMS production
# Value: karmine-corp,bds-academy,gentle-mates,...  (comma-separated, top-popular first)
vercel --prod
```

**Smoke test (manual, ~5 min):**

| Page | Check |
|------|-------|
| `/scroll` | Shows mixed feed, KC + LFL kills | First load < 2s |
| `/scroll?team=karmine-corp` | Shows ONLY KC kills | No regression for KC fans |
| `/team/karmine-corp` | KC team page renders | No regression |
| `/team/bds-academy` | NEW page renders | Roster + recent kills shown |
| `/scroll` on mobile (Lighthouse) | Performance > 90 | No regression |
| Discord OAuth login | Still works | No auth regression |

### 4.7 Communication template (post-launch)

Post in #announcements on the LoLTok Discord:

```
🎉 LoLTok s'agrandit ! On couvre maintenant la LFL en plus du LEC.

Nouveau :
• Tous les kills LFL des 10 équipes (BDS Academy, Gentle Mates, Joblife, etc.)
• Page profil par équipe : /team/karmine-corp, /team/gentle-mates, etc.
• Filtre par équipe dans le scroll : /scroll?team=karmine-corp

Pas de changement pour les fans KC : par défaut le scroll mélange tout, mais tu peux filtrer KC-only en 1 clic.

Dis-moi ce que tu en penses 🙏 — Mehdi
```

---

## 5. Step-by-step: enable EU Masters (second league)

**Repeat steps 4.1 → 4.7 with these env changes:**

```diff
- KCKILLS_TRACKED_LEAGUES=lec,lfl
+ KCKILLS_TRACKED_LEAGUES=lec,lfl,eum

# Add EU Masters teams (only when EUM is live — out-of-season they're 0 kills)
- KCKILLS_TRACKED_TEAMS=karmine-corp,bds-academy,gentle-mates,...
+ KCKILLS_TRACKED_TEAMS=karmine-corp,bds-academy,gentle-mates,...,giantx-pride,heretics-academy,...
```

**EU Masters specific consideration:**
- EUM matches are scheduled in cycles (Spring + Summer Play-In + Main Event)
- The sentinel handles this via `getSchedule` — no special handling needed in the worker
- The frontend should hide EUM-specific UI when no EUM matches are upcoming (handled by `team.is_active` flag)

---

## 6. Step-by-step: enable remaining LEC teams (LEC Tier 1)

By default Phase 0 only tracked KC. Even within LEC, we have 9 other teams to enable: G2, FNC, MAD, BDS, RGE, SK, TH, GX, VIT.

**Repeat steps 4.1 → 4.7 with:**

```diff
- KCKILLS_TRACKED_TEAMS=karmine-corp,...lfl_teams
+ KCKILLS_TRACKED_TEAMS=karmine-corp,g2-esports,fnatic,mad-lions-koi,team-bds,rogue,sk-gaming,team-heretics,giantx,team-vitality,...lfl_teams
```

**Important:** This doubles the worker load (KC ~30 matches → LEC ~120 matches per split). Monitor:

- yt-dlp throttling (we may hit YouTube IP limits sooner)
- Gemini paid usage (cost spike)
- R2 storage (will fill faster)

If yt-dlp throttling spikes → **this is the trigger to invest in residential proxy (Brightdata €500/mo)**. See `loltok-tech-stack-decisions.md` § 1.

---

## 7. Step-by-step: storage backend swap (if needed)

If we move the worker from PC to Hetzner, the storage backend stays R2 (no change). But if we ever need to swap to local-fs for testing or to a different bucket:

```bash
# Backup-then-swap
cd worker
# 7.1 Snapshot current R2 bucket
aws s3 sync s3://loltok-clips s3://loltok-clips-bak-$(date +%Y%m%d)
# 7.2 Create new bucket
aws s3 mb s3://loltok-clips-v2
# 7.3 Sync existing data
aws s3 sync s3://loltok-clips s3://loltok-clips-v2
# 7.4 Update env
sed -i 's/R2_BUCKET=loltok-clips/R2_BUCKET=loltok-clips-v2/' .env
# 7.5 Restart worker
./scripts/restart.sh
# 7.6 Verify a new clip lands in the new bucket
# 7.7 After 24h, deprecate old bucket (keep as backup for 30 days, then delete)
```

**Custom domain CDN consideration:** If `clips.kckills.com` is bound to the old bucket, update the CNAME to point to the new bucket. ~5 min of DNS propagation.

---

## 8. Rollback procedures

### 8.1 Rollback an env var change

```bash
# Worker
cd worker
mv .env .env.attempted
mv .env.bak.pre-phase1 .env
./scripts/restart.sh
tail -f worker_startup.log
# Confirm: "sentinel: tracking 1 team across 1 league"
```

```bash
# Frontend
cd web
vercel env rm NEXT_PUBLIC_LOLTOK_PUBLIC production
vercel env rm NEXT_PUBLIC_DEFAULT_TEAMS production
vercel --prod
```

**Time to rollback:** 5 minutes including Vercel rebuild.

### 8.2 Rollback a code change

If a Wave 10 PR breaks production:

```bash
cd web
git revert <bad-sha>
git push origin main
# Vercel auto-deploys revert commit
```

```bash
cd worker
git revert <bad-sha>
./scripts/restart.sh
```

**Time to rollback:** 5-10 minutes.

### 8.3 Restore database from backup

If we corrupt the DB (worst case):

```bash
# 8.3a Stop the worker
sudo systemctl stop loltok-worker

# 8.3b Download backup from R2
aws s3 cp s3://loltok-backups/db/pre-phase1-20260425.sql.gz .

# 8.3c Restore via supabase CLI
gunzip pre-phase1-20260425.sql.gz
supabase db reset --linked
psql $SUPABASE_DB_URL < pre-phase1-20260425.sql

# 8.3d Verify
psql $SUPABASE_DB_URL -c "SELECT COUNT(*) FROM kills WHERE status='published'"
# Should return ~525 (Phase 0 baseline)

# 8.3e Restart worker
sudo systemctl start loltok-worker
```

**Time to restore:** 30-60 minutes. Practice this once before you need it for real.

---

## 9. Smoke test catalog

Run after every change:

| Test | Command | Pass condition |
|------|---------|---------------|
| Worker heartbeat | `curl https://supabase.../rest/v1/health_checks` | last_seen < 2 min ago |
| Sentinel cycle | `python worker/scripts/smoke_sentinel.py` | exits 0 within 60s |
| Harvester cycle | `python worker/scripts/smoke_harvester.py --game-id <id>` | exits 0, no errors |
| Clipper end-to-end | `python worker/scripts/smoke_clipper.py --kill-id <id>` | clip lands in R2 |
| Frontend home | `curl -I https://kckills.com/` | 200 OK |
| Frontend scroll | `curl -I https://kckills.com/scroll` | 200 OK |
| Frontend kill detail | `curl -I https://kckills.com/kill/<id>` | 200 OK |
| OG image redirect | `curl -I https://kckills.com/api/og/<id>` | 302 to R2 |
| Auth login | manual (browser) | login flow completes |
| Rate a kill (auth) | manual (browser) | rating persists |
| Comment (auth) | manual (browser) | comment appears after Haiku review |
| Push notif | trigger from worker | notif lands on phone |

---

## 10. Communication templates

### 10.1 Pre-migration announcement (1 week before)

```
Hello la commu LoLTok,

Petite news : ce week-end (XX-XX), je vais ajouter le support multi-équipe au site.
Pour l'instant on couvre que KC, à la sortie on aura aussi LFL et EU Masters.

Pendant la migration, le site peut être un peu instable pendant 2-3h max.
Si tu vois un bug, ping-moi sur Discord.

Pour les fans KC : rien ne change pour vous, le site reste KC-first.
Vous pourrez juste filtrer "KC seulement" en 1 clic si vous voulez.

Mehdi
```

### 10.2 Mid-migration status (during the bake period)

```
Migration en cours, tout va bien jusqu'ici.
Le site est stable mais en arrière-plan j'ingest les LFL pour la 1ère fois.
Demain je flip le switch et vous verrez les LFL kills apparaître dans le scroll.

Mehdi
```

### 10.3 Post-launch announcement

(See § 4.7 above)

### 10.4 Rollback announcement (if needed)

```
🚧 Petit pépin technique avec le multi-équipe, je rollback le temps de comprendre.
Le site fonctionne normalement (KC-only comme avant).
Pas de data perdue, c'est juste un revert d'env var.

Je relance la migration cette semaine. Mehdi
```

---

## 11. Per-step time estimates

| Step | Time | Can be done in parallel? |
|------|------|-------------------------|
| 1. Pre-migration checklist | 30 min | No |
| 2. Backup checkpoint | 20 min | No |
| 3. Verify Wave 10 PRs merged | 5 min | No |
| 4.1-4.5 Enable LFL (worker + bake) | 24h elapsed (active work ~1h) | No |
| 4.6 Flip public flag | 30 min | No |
| 4.7 Smoke tests + announce | 30 min | No |
| 5. Enable EUM | 24h elapsed (~1h active) | After step 4 done |
| 6. Enable LEC tier 1 | 24h elapsed (~1h active) | After step 5 done |

**Total active work:** ~5 hours
**Total elapsed time:** 3-4 days (because of bake periods)

---

## 12. Post-migration validation (1 week after)

| Metric | Target | How to check |
|--------|--------|-------------|
| KC clips published count (regression) | Same as pre-migration baseline | Supabase query |
| LFL clips published | > 50 | Supabase query |
| EUM clips published | > 5 | Supabase query |
| Pipeline error rate | < 2% | DLQ count / total jobs |
| Frontend Lighthouse | > 90 | manual audit |
| User complaints (Discord) | < 3 | review #feedback |
| R2 storage growth rate | < 200 GB / mo | Cloudflare dashboard |
| Supabase egress (current month) | < 4 GB | Supabase dashboard |
| EtoStark approval | 👍 or better | Discord DM |

**If all pass → Phase 1 entry validated.**
**If any fail → freeze new feature work, fix the regression, re-validate.**

---

## 13. Phase 2+ migrations (forward references)

This runbook covers KC pilot → Phase 1 (multi-team Europe).

For Phase 1 → Phase 2 (multi-region core), see future doc `docs/loltok-migration-runbook-p2.md` (TBD).

Key Phase 2 migrations:
- Worker compute migration: PC → Hetzner CCX13 → CCX23
- Storage layout migration: per-team to per-team-per-year keys
- AI router migration: single-provider Gemini → multi-provider router
- Search migration: Postgres FTS → Algolia
- Database migration: Supabase Free → Pro
- Backup migration: pg_dump cron → Supabase PITR

Each follows the same pattern: backup → deploy code → bake → flip flag → verify → announce.

---

**Last revision:** 2026-04-25 (initial draft, Wave 10)
