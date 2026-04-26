# Changelog — LoLTok / KCKills

All notable changes to this project. The most recent wave is at the top.

For Wave 10 git-history attribution issues (4 commits where the message and diff don't match), see `docs/wave10-git-history-audit.md`.

---

## 2026-04-25 — LoLTok foundation Wave 10

The Wave 10 swarm laid the multi-team / multi-league / multi-region foundation that lets the worker and frontend graduate from the KC-only pilot to a generic LoL-esports clip platform. Ten agents shipped in parallel; one Wave 11 audit consolidated the git history (see audit doc).

### Worker (Python)

- **Multi-team support** (Agent BA) — env-driven team config (`worker/services/team_config.py`) seeded with 50 LEC + LCS + LCK + LPL teams in `worker/config/teams.json`. The `KCKILLS_TRACKED_TEAMS` env var defaults to `kc` (byte-identical KC pilot behaviour), accepts a comma list (`kc,g2,fnatic`), or `*` for every active row. Channel reconciler, event publisher, QC sampler, and transitioner all migrated to the new config layer. Frontend constants stay in lockstep via `web/src/lib/constants.ts`.
- **Multi-league support** (Agent BB) — new `worker/services/league_config.py` + `worker/services/league_id_lookup.py` + seed script `worker/scripts/seed_leagues.py`. Sentinel and lolesports_api now consult `KCKILLS_TRACKED_LEAGUES` (default `lec` for back-compat). Adds the `leagues` table via migration `043_leagues_table.sql`. 16/16 unit tests passing.
- **Generic backfill scripts** (Agent BD) — `worker/scripts/backfill_team.py` and `worker/scripts/backfill_league.py` replace the KC-only backfill. Pulls historical match data per team via `worker/services/historical_team_id_resolver.py` with Leaguepedia fallback (`worker/services/leaguepedia_scraper.py`). Includes test suite.
- **Worker portability** (Agent CB) — `worker/services/local_paths.py` central path resolver with env-var override per path and cross-platform sensible defaults. `config.CLIPS_DIR` / `HLS_DIR` / `THUMBNAILS_DIR` / `VODS_DIR` / `CACHE_DB` are now `@property` delegating to `LocalPaths` (100% backward compat on Mehdi's PC). New multi-stage `worker/Dockerfile` (python:3.13-slim + ffmpeg + firefox-esr + deno + tini, non-root, healthcheck), `.dockerignore` to keep secrets out of the build context. Migration plan and Hetzner-vs-Fly comparison in `docs/worker-stateless-plan.md` and `docs/worker-deployment-options.md`.
- **Multi-provider AI router** (Agent CC) — `worker/services/ai_router.py` (Protocol-based, cost-ordered selection, vision filter, daily-budget ceiling, 5-min cooldown on failure). Stub providers for Gemini, Anthropic Haiku, OpenAI gpt-4o-mini (with ZDR guard), and Cerebras Llama 3.3 70B in `worker/services/ai_providers/`. 24/24 router tests green. Phase 2 (real SDK wiring) is a drop-in swap in `worker/modules/analyzer.py`. Background docs : `docs/loltok-ai-multi-provider.md` (debunks the "rotate Gemini accounts" idea, explains real multi-provider strategy with cost math) and `docs/loltok-db-scaling-plan.md` (Supabase free → Pro → Neon Scale tiering).
- **Storage backend abstraction** (Agent BF) — `worker/services/storage_backend.py` Protocol + `worker/services/storage_factory.py` selector. R2 stays the default (`worker/services/r2_client.py` unchanged), S3 (`storage_s3.py`) and GCS (`storage_gcs.py`) are stubs ready for activation. Zero behavioural change today.

### Frontend (Next.js)

- **Multi-team / multi-league navigation** (Agent BC) — env-gated routes `/team/[slug]` and `/league/[slug]` (`web/src/app/team/[slug]/page.tsx`, `web/src/app/league/[slug]/page.tsx`), API routes `/api/teams` and `/api/leagues`, `LeagueNav` and `TeamSelector` components. KC remains the default, no behavioural change for the pilot URL.
- **i18n scaffold** (Agent BE, re-landed under commit `277f50f` — see audit doc) — homemade lightweight translation system. 4 locales (`fr`, `en`, `ko`, `es`) × 202 keys × 16 hierarchical groups in `web/src/lib/i18n/locales/`. `useT()` hook walks dotted-path keys with FR fallback and `{placeholder}` interpolation. RSC translator via `getServerLang.ts` + `serverT()`. Soft `kc_lang` cookie detection from `Accept-Language` in `middleware.ts`. WCAG-AA 44px tap targets on `LangSwitcher`. Migration roadmap in `docs/i18n-migration-plan.md`. Korean translations are LLM best-effort and need fluent-speaker QA before launch (Riot disclaimer kept in English per Riot policy). No components migrated yet — opt-in by importing `useT()`.

### Strategy & Documentation

- **Master plan + cost model + tech-stack decisions + migration runbook** (Agent CA) — `docs/loltok-master-plan.md`, `docs/loltok-cost-model.md`, `docs/loltok-tech-stack-decisions.md`, `docs/loltok-migration-runbook.md`. The single-source spec for what LoLTok ships post-pilot.
- **Stack currency audit + upgrade recommendations** (Agent CD) — `docs/stack-currency-audit-2026-04.md` (which deps are stale, which APIs deprecated, which versions to bump) and `docs/stack-upgrade-recommendations.md`.

### Database migrations to run

- `supabase/migrations/043_leagues_table.sql` — adds the `leagues` table consumed by `worker/services/league_config.py`. Required before `KCKILLS_TRACKED_LEAGUES` accepts anything other than the default `lec`. Run once via `supabase db push` or copy-paste in the SQL editor.

### Git-history attribution note

Four commits in this wave have **mismatched commit message / diff body** due to two sister-agent worktrees committing in the same wall-clock second on the shared branch :

| Commit | Message labels it as | Real diff is |
|--------|----------------------|--------------|
| `180c185` | BE (i18n) | BB (league_config) |
| `f935297` | CB (local_paths) | BA (team_config) |
| `c180ebf` | BB (marker) | CB (local_paths) |
| `ddad620` | CB (marker) | CC (ai_router) |

The shipped CODE is correct; the LABEL is wrong. Marker commits `c180ebf`, `ddad620`, `60331ae` document the swap in their messages. **History was NOT rewritten** — see `docs/wave10-git-history-audit.md` for the full forensic audit and rationale.

---
