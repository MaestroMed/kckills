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

| # | Finding | Effort | Risk |
|---|---|---|---|
| **S1** | **Backups not scheduled.** `worker/scripts/backup_supabase.py` ready ; no cron / Task Scheduler entry. Free tier Supabase = zero auto-backup. Single `DROP TABLE` = total loss. | S | Critical |
| **S2** | **Disk runaway.** `worker/{clips,vods,hls,thumbnails}/` grow without GC. ~3 months of headroom on the 230 GB free space at current 50 kills/day. | M | Medium |
| **S3** | **Silent Gemini quota exhaustion.** Gemini 3.1 Lite free tier RPD is 500 (was 1000 on 2.5 Lite). No proactive alert ; analyzer degrades silently. | M | Medium |

---

## 🟡 WARN — high-impact debt by category

### Frontend bundle / perf
- **W1** : `HeroClipBackground` imports `motion/react` directly instead of via the LazyMotion provider. Ships full motion features. **Gain : −15-20 KB initial JS**. Effort M.
- **W2** : three.js + matter-js + @react-three/* may leak into the homepage initial bundle despite `next/dynamic ssr:false` lazy wrappers. **Verify with bundle analyzer**, then isolate. **Gain : up to −300 KB JS mobile** if confirmed leaking. Effort S to verify, M to fix.
- **W3** : Sentry `replaysOnErrorSampleRate: 1.0` can blow free-tier quota in an outage. Drop to 0.5-0.75. Effort S.
- **W4** : `prefers-reduced-motion` missing on `.hero-title-glow` (heroBreathe keyframe). Effort S.

### Security / API
- **W5** : No Zod/Valibot input validation on public API routes (`/api/v1/*`, `/api/search`). Manual `parseInt` + `slice(0, 120)`. Effort S-M.
- **W6** : No rate limiting on `/api/scroll/recommendations` + `/api/search`. DOS surface. Effort M.
- **W7** : CSP `'unsafe-inline'` still present. Next 16.2 supports nonce injection via proxy.ts. Effort M, risk medium.
- **W8** : `fn_record_impression` not rate-limited. Curl loop pumps `impression_count`. Effort S-M.

### Worker / ops
- **W9** : `structlog.dev.ConsoleRenderer` in production. Switch to `JSONRenderer` when `KCKILLS_ENV=prod` for Loki/Sentry parsing. Effort S.
- **W10** : `release_zombie_claims.py` + `backfill_stuck_pipeline.py` are manual-only — no cron. Effort M.
- **W11** : `pipeline_jobs.status='dead_letter'` growth tracked in daily report but no proactive mid-day alert when growth spikes. Effort M.
- **W12** : `admin_job_runner` blocking `subprocess.run timeout=600` can freeze event loop. Effort S.

### Data growth / lifecycle
- **W13** : `pipeline_jobs` grows unbounded (~180K rows/year). No retention. Effort M.
- **W14** : `user_events` grows unbounded (~180 MB/year). No retention. Effort M.
- **W15** : 9 migrations 043→051 still not applied to live DB. Idempotent, safe. Blocked on operator credentials. Effort S once unblocked.

### Frontend modernization
- **W16** : 5-6 admin forms still use `fetch POST` instead of `<form action={serverAction}>`. Effort M.
- **W17** : Hero data tagged `'hero-stats'` but no Server Action calls `revalidateTag` on writes. TTL 5 min is the only freshness mechanism. Effort S.
- **W18** : Migration 043 absence pollutes worker log every sentinel cycle (`supabase_select_failed table=leagues`). Resolved by W15.

---

## 🔵 INFO — backlog (no urgency)

- VideoClip JSON-LD on `/kill/[id]` + `/match/[slug]` for SEO rich snippets.
- `globals.css` 826 lines → split via `@layer` (DX, no perf gain).
- Vercel Speed Insights + Sentry custom thresholds.
- Drop IVFFlat (`046`) when HNSW proves sufficient at <100K rows (passive monitor 6 months).
- AI Router Phase 2 wiring (analyzer → Anthropic Haiku fallback for cost win).
- Local→Hetzner/Fly.io migration runbook (worker is already stateless-compatible).
- 60+ scripts in `worker/scripts/` — categorize ACTIVE / MAINTENANCE / DEPRECATED + README.
- CORS headers on public API routes (currently only `/api/v1/kills`).
- Tests for `clipper.py`, `analyzer.py`, `hls_packager.py` (critical-path low coverage).
- `leagues` table missing explicit RLS (read-only, low risk).

---

## Wave plan

**Wave 14 — Ops hardening (1 day)** : S1, S2, S3, W9, W11. Ship the
3 STOP items + observability bumps. Low blast radius, immediate
operational value.

**Wave 15 — Bundle + frontend hardening (1 day)** : W1-W4, W16, W17.
Measurable Lighthouse delta, low risk.

**Wave 16 — API security hardening (1 day)** : W5-W8. Zod schemas +
rate limiting + nonce CSP. Protects against abuse + future regressions.

**Wave 17 — Data lifecycle (1 day)** : W10, W12, W13, W14. Self-healing
queue + retention policies. Long-term stability.

**W15 (migrations apply)** : Standalone, blocked on operator providing
DB password OR Personal Access Token. Once unblocked, ~15 min total.

**Pivot Kameto** : Independent chantier ; deserves its own ULTRAPLAN
(3-5 day estimate). Out of scope here.

---

*Audit run by Claude Opus 4.7 (1M ctx) on 2026-05-07. Three Explore
agents in parallel ; cross-deduped ; this doc is the single source of
truth for the post-Wave-13o backlog.*
