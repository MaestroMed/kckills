# Architecture Audit — KCKills 2026-05-07

Three parallel agents (frontend / worker / data+security) audited the
full stack to find unaddressed opportunities post-Wave 13o. Findings
deduped + cross-verified ; one false positive from the frontend agent
dropped (sitemap.ts exists in `app/`).

## Stack health snapshot

All current as of 2026-05-07, no EOL versions in production :

- **Web** : Next.js 16.2.4 + React 19 + Tailwind v4 + React Compiler 1.0
  + TypeScript 5.9 + pnpm 11. Vercel hosting.
- **Worker** : Python 3.14, asyncio supervised daemon, google-genai 1.75
  + anthropic 0.100, ffmpeg 8.1.1 + NVENC, yt-dlp 2026.03.
- **Data** : Supabase Postgres + PostgREST + pgvector (HNSW 018, IVFFlat
  046 redundant), R2 storage with `clips.kckills.com` custom domain.
- **AI** : Gemini 3.1 Flash-Lite (default since 2026-05-07), Claude
  Haiku 4.5 (moderation).

Recent ground covered : Waves 13g→13o (homepage perf sweep, Suspense
streaming, next/image migration, next/font self-host, unstable_cache
hero data, Gemini 3.1 Lite as default). Worker fully operational
24/7 on Mehdi's PC since 2026-05-07.

---

## 🔴 STOP — production-blocking, ship in Wave 14

| # | Finding | Effort | Risk | Status |
|---|---|---|---|---|
| **S1** | **Backups not scheduled.** `worker/scripts/backup_supabase.py` ready ; no cron / Task Scheduler entry. Free tier Supabase = zero auto-backup. Single `DROP TABLE` = total loss. | S | Critical | **✅ FIXED** Wave 14 — `KCKills-WeeklyBackup` Sunday 04:00 (`install-backup-task.ps1`). |
| **S2** | **Disk runaway.** `worker/{clips,vods,hls,thumbnails}/` grow without GC. ~3 months of headroom on the 230 GB free space at current 50 kills/day. | M | Medium | **✅ FIXED** Wave 14 — `worker/services/disk_hygiene.py` + watchdog 24 h GC cycle. |
| **S3** | **Silent Gemini quota exhaustion.** Gemini 3.1 Lite free tier RPD is 500 (was 1000 on 2.5 Lite). No proactive alert ; analyzer degrades silently. | M | Medium | **✅ FIXED** Wave 14 — `_maybe_alert_low_quota` in `watchdog.py:469` fires Discord embed at 20 % remaining (configurable via `KCKILLS_ALERT_GEMINI_PCT`). |

---

## 🟡 WARN — high-impact debt by category

### Frontend bundle / perf
- **W1** ~~motion/react direct import~~ — **✅ FIXED Wave 18** : `HeroClipMotionLayer.tsx` extracted ; `HeroClipBackground` lazy-loads it via `next/dynamic({ ssr: false, loading: () => null })`.
- **W2** ~~three.js + matter-js leak~~ — **FALSE POSITIVE** (verified 2026-05-08) : `grep -rn "from ['\"]three['\"]\|matter-js\|@react-three"` shows three only in `components/sphere/SphereScene.tsx` (loaded by `/game/solo` exclusively, behind a `dynamic({ ssr: false })` boundary in `SphereSceneClient.tsx`) and matter-js only in `app/game/play/` + `lib/game/`. Neither homepage nor /scroll imports any of them, statically or transitively.
- **W3** ~~Sentry replaysOnErrorSampleRate~~ — **✅ ALREADY FIXED** : `web/sentry.client.config.ts:38` is `0.5`, audit was reading a stale value.
- **W4** ~~prefers-reduced-motion missing on .hero-title-glow~~ — **✅ FIXED Wave 13g** : `globals.css:153` wraps the `heroBreathe` animation in `@media (prefers-reduced-motion: no-preference)`.

### Security / API
- **W5** ~~No Zod input validation~~ — **✅ FIXED Wave 16** (commit aabd577).
- **W6** ~~No rate limiting on /api/scroll/recommendations + /api/search~~ — **✅ FIXED Wave 18** : `web/src/lib/rate-limit.ts` + migration 055 (Postgres-backed fixed-window counter, fail-open on RPC error).
- **W7** : CSP `'unsafe-inline'` still present. Next 16.2 supports nonce injection via proxy.ts. **DEFERRED** — Vercel cache regression risk, revisit when nonce patterns mature.
- **W8** ~~fn_record_impression not rate-limited~~ — **✅ FIXED Wave 16** (commit aabd577).

### Worker / ops
- **W9** ~~structlog.dev.ConsoleRenderer in prod~~ — fix shipped in earlier wave (search worker for `JSONRenderer` to confirm).
- **W10** ~~release_zombie_claims.py + backfill_stuck_pipeline.py manual-only~~ — **✅ FIXED Wave 17** : `KCKills-ZombieRelease` daily 02:00 + `auto_fix_loop.py` covers stuck-pipeline.
- **W11** ~~dead_letter growth alert~~ — **✅ FIXED Wave 14** : `_maybe_alert_low_quota` in `watchdog.py:541` (`KCKILLS_ALERT_DLQ_TODAY` threshold, default 20).
- **W12** ~~admin_job_runner blocking subprocess.run~~ — **✅ ALREADY FIXED** : `modules/admin_job_runner.py:299` already uses `await asyncio.to_thread(_run_script_blocking, argv)`. Audit was reading a stale pattern.

### Data growth / lifecycle
- **W13** ~~pipeline_jobs unbounded~~ — **✅ FIXED Wave 17** : migration 053 + `KCKills-PrunePipelineJobs` Sunday 03:00 (delete terminal-state > 30 days).
- **W14** ~~user_events unbounded~~ — **✅ FIXED Wave 17** : migration 054 + `KCKills-PruneUserEvents` 1st of month 03:30 (delete > 90 days).
- **W15** ~~9 migrations 043→051 not applied~~ — **✅ FIXED Wave 19** (2026-05-08) : applied via Supabase Management API (PAT) + leagues seeded ; total of 14 migrations 043→056 now in production.
- **W18** ~~Migration 043 absence pollutes worker log~~ — **✅ FIXED Wave 19** (resolved by W15 fix).

### Frontend modernization
- **W16** ~~admin forms still use fetch POST~~ — **✅ FIXED Wave 18** (mostly — 7/8 forms migrated to `<form action={serverAction}>`).
- **W17** ~~Hero data no revalidateTag~~ — **✅ FIXED Wave 15** : `web/src/lib/supabase/server-actions.ts::revalidateHeroStats` + worker `web_revalidate.py` POSTs after match completion.

### Mobile / scroll (added 2026-05-08)
- **M1** ~~/scroll mobile renderer crash~~ — **✅ FIXED Wave 19.6 + 19.7** : SSR cap 500/300 → 150/80 + viewport virtualisation (5-item window). Production HTML 4.57 MB → 1.03 MB (-78 %). Mobile renderer no longer OOMs.
- **M2** ~~/player/[slug] match-history OOM risk for alumni 200+ matches~~ — **✅ FIXED Wave 20.1** : binary `showAll` toggle replaced with bounded `Charger plus` pagination (initial 20, +30 per click, capped at 200). Filter-driven exploration covers the long tail.

### Worker observability (Wave 20.1 — audit follow-ups)
- **OBS-1** ~~Silent thumbnail extraction failures in clipper.py~~ — **✅ FIXED** : 3 swallowed `except` paths now log with kill_id + error context.
- **OBS-2** ~~OG skip silently flips to published~~ — **✅ FIXED** : `og_skipped_already_uploaded` event with status_flip_ok.
- **OBS-3** ~~Watchdog alert cooldown lost on restart~~ — **✅ FIXED** : file-backed `worker/state/alert_cooldowns.json` with atomic-write + 14-day prune.
- **OBS-4** ~~Backfill quota runaway~~ — **✅ FIXED** : `KCKILLS_BACKFILL_GEMINI_FLOOR` (default 50) circuit-breaker stops the loop early with a clean log instead of accumulating silent failures.
- **OBS-5** ~~Gemini quota log without context~~ — **✅ FIXED** : `gemini_quota_exhausted` event now carries `remaining` count + `reset_hour_utc=7`.
- **OBS-6** ~~JSON parse error without kill context~~ — **✅ FIXED** : bumped warn → error, added killer/victim/decode_error.

Deferred (medium severity, no immediate failure mode) :
- Per-format R2 upload error logging
- Translator migration probe on startup
- Push subscription cooldown table
- Heartbeat module-death detection

---

## 🔵 INFO — backlog (no urgency)

- ~~VideoClip JSON-LD on `/kill/[id]` + `/match/[slug]`~~ — **FALSE POSITIVE** :
  VideoObject already shipped on `/kill/[id]` ; SportsEvent on
  `/match/[slug]` ; JSON-LD is also present on `/player/[slug]`,
  `/champion/[name]`, `/alumni/[slug]`, `/matchup/...`. Audit agent
  miscategorised. Verified via grep `application/ld\+json` 2026-05-08.
- `globals.css` 826 lines → split via `@layer` (DX, no perf gain).
- Vercel Speed Insights + Sentry custom thresholds.
- Drop IVFFlat (`046`) when HNSW proves sufficient at <100K rows (passive monitor 6 months).
- AI Router Phase 2 wiring (analyzer → Anthropic Haiku fallback for cost win).
- Local→Hetzner/Fly.io migration runbook (worker is already stateless-compatible).
- 60+ scripts in `worker/scripts/` — categorize ACTIVE / MAINTENANCE / DEPRECATED + README.
- ~~CORS headers on public API routes~~ — **FALSE POSITIVE** :
  `Access-Control-Allow-Origin` already on `/api/v1/kills`,
  `/api/v1/matches`, `/api/v1/players`, `/api/leagues`, `/api/teams`.
  Audit agent flagged only the first one. Other public routes
  (`/api/featured/today`, `/api/next-match`) are same-origin
  intentionally — adding CORS would be an attack-surface increase
  with no benefit.
- Tests for `clipper.py`, `analyzer.py`, `hls_packager.py` (critical-path low coverage).
- ~~`leagues` table missing explicit RLS (read-only, low risk).~~ —
  **FIXED in Wave 19 / migration 056** : RLS enabled, public SELECT
  policy + deny anon writes. Service role bypasses RLS unchanged.

---

## Wave plan — STATUS UPDATE 2026-05-08

| Wave | Items | Status |
|---|---|---|
| **Wave 14** Ops hardening | S1, S2, S3, W9, W11 | ✅ shipped |
| **Wave 15** Bundle + frontend | W1–W4, W16, W17 | ✅ W1/W3/W4/W16/W17 done ; W2 was a false positive |
| **Wave 16** API security | W5, W6, W8 | ✅ shipped (W7 deferred — see note) |
| **Wave 17** Data lifecycle | W10, W12, W13, W14 | ✅ shipped (W12 was already fixed pre-audit) |
| **Wave 19** Migrations + audit follow-ups | W15, W18 | ✅ shipped 2026-05-08 |
| **Wave 19.5** LiveBanner + Kameto stream | desktop menu fix + co-stream URL | ✅ shipped 2026-05-08 |
| **Wave 19.6 / 19.7** Mobile /scroll OOM | M1 | ✅ shipped 2026-05-08 |
| **Wave 19.8** /scroll cap restored + env-tunable | bonus | ✅ shipped 2026-05-08 |
| **Wave 19.9** GeminiProvider.analyze_clip wired (router groundwork) | AI Router phase 2 (partial) | ✅ shipped 2026-05-08 |
| **Wave 20.1** Audit follow-ups (3 batches) | observability + mobile yellow flag | ✅ shipped 2026-05-08 |

**Open items**

| # | Item | Why deferred |
|---|---|---|
| W7 | CSP nonce-based | Vercel ISR cache + nonce regression risk. Revisit in 2026 H2 when Next 17 stabilises the pattern. |
| — | AI Router Phase 2 wiring (analyzer → router) | `services/ai_router.py` + provider classes shipped in Wave 11 ; provider stubs still raise `ProviderUnavailable("router phase 2")`. Wiring up `GeminiProvider.analyze_clip` + flipping `analyzer.py::analyze_kill` to call the router is a 1-day effort with surgical risk. Keep deferred until cost or quota pain materialises. |
| — | Bundle analyzer install + run | `@next/bundle-analyzer` not installed. W2 was the only listed reason ; with W2 retracted there's no urgent pull. Install when the next bundle anomaly surfaces. |

**Pivot Kameto** : Independent chantier ; deserves its own ULTRAPLAN
(3-5 day estimate). Out of scope here.

---

*Audit run by Claude Opus 4.7 (1M ctx) on 2026-05-07. Three Explore
agents in parallel ; cross-deduped. Status updates 2026-05-08 after
Wave 14 → 19.7 ship — most items closed, doc kept as historical
record + canonical pointer to the open W7 + AI Router items.*
