# LoLTok Stack Upgrade Recommendations — April 2026

**Author:** Agent CD (LoLTok MEGA SWARM)
**Date:** 2026-04-25
**Companion to:** `stack-currency-audit-2026-04.md`

This document is the **prioritized actionable list**. Each item has: priority, effort estimate (engineering hours), impact estimate, and dependency notes. Items are ordered by `priority × impact / effort`.

---

## Priority key

- **P0 (urgent)**: EOL/forced migration, security risk, or 5×+ cost-or-performance regression. Do before launch.
- **P1 (significant)**: 2–3× cost or perf gain, or fills a meaningful product gap.
- **P2 (nice-to-have)**: Marginal improvement; do when convenient or as part of routine maintenance.

Effort scale:
- XS = under 1 hour
- S = 1–4 hours
- M = 4–16 hours (~1–2 days)
- L = 16–40 hours (~3–5 days)

---

## P0 — Urgent (do before V0 launch)

### P0-1. Add Sentry to frontend + worker
**Why**: There is currently NO error monitoring beyond Discord webhooks. Production frontend crashes (uncaught React errors, hydration mismatches, RSC failures) will be invisible. Mobile-first product cannot launch blind.

**What**:
- Install `@sentry/nextjs` in `web/` (auto-instruments App Router + Server Components)
- Install `sentry-sdk[python]` in `worker/` (auto-instruments asyncio + httpx)
- Configure DSN per environment via env var
- Sentry Developer plan (free): 5K errors/mo + 5M spans + 50 replays — covers our V0 scale

**Effort**: S (~3 hours total)
**Impact**: HIGH — without it, we won't know users are crashing
**Cost delta**: $0/mo (free tier)
**Dependencies**: none
**Source**: https://sentry.io/pricing/ (fetched 2026-04-25)

---

### P0-2. Update CLAUDE.md cost projection: Hetzner CPX22 € price hike
**Why**: As of April 1 2026, Hetzner raised CPX22 (DE/FI) from €5.99 to €7.99/mo. CLAUDE.md Section 10 doesn't list Hetzner pricing explicitly but agents may reference outdated numbers from training data.

**What**: Add a sentence to `CLAUDE.md` Partie 10 or to `docs/worker-deployment-options.md` documenting the new Hetzner prices. Worker deployment cost projection: CPX22 €7.99/mo, CCX22 ~€10-15/mo (dedicated CPU).

**Effort**: XS (5 min)
**Impact**: LOW (just doc accuracy, but blocks misinformed agent decisions)
**Cost delta**: n/a (just a documentation fix)
**Dependencies**: none
**Source**: https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment

---

### P0-3. Reject Highlight.io if any agent suggests it
**Why**: Highlight.io is being sunset by Feb 28 2026 — services migrating to LaunchDarkly. Picking Highlight today means a forced migration in <2 months.

**What**: If `audit-monitoring-stack.md` or any other agent doc lists Highlight.io as a candidate observability stack, strike it out and replace with Sentry (per P0-1) or with LaunchDarkly Observability if RUM-style session replay is needed.

**Effort**: XS (just review)
**Impact**: avoids a wasted 1-week integration that needs to be re-done
**Cost delta**: n/a
**Dependencies**: depends on what other agents propose
**Source**: search "Highlight.io migration LaunchDarkly Feb 2026"

---

## P1 — Significant gains (do in Phase 1 or Phase 2)

### P1-1. Add Gemini 3.1 Pro escalation path for ultra-hype clips
**Why**: For penta kills, quadra kills, or `caster_hype_level = 5` clips, the analysis quality from Gemini 2.5 Flash-Lite may underrate the moment. Gemini 3.1 Pro at $2/$12 per M tok with native video understanding produces dramatically better narrative-quality descriptions and more reliable highlight scoring.

**What**:
- In `worker/modules/analyzer.py`, add a tier-up rule:
  ```python
  if kill.multi_kill in ("quadra", "penta") or kill.caster_hype_level >= 5:
      model = "gemini-3-1-pro-preview"
  else:
      model = "gemini-2.5-flash-lite"  # existing default
  ```
- Add `GEMINI_MODEL_HYPE` env var with default `gemini-3-1-pro-preview`
- Add separate scheduler quota tracking for the Pro model

**Effort**: S (~2-3 hours)
**Impact**: better descriptions on the 5–10% of clips that drive viral sharing
**Cost delta**: +$0.013 per escalated clip × ~15-30 clips/season = ~$0.40/season → trivial
**Dependencies**: none (Gemini API supports both models simultaneously)
**Source**: https://ai.google.dev/gemini-api/docs/pricing (Gemini 3.1 Pro: $2 input ≤200k, $12 output ≤200k)

---

### P1-2. Document the Riot disclaimer + Gemini 3 Flash Preview as primary fallback
**Why**: When Gemini 2.5 Flash-Lite quota exhausts (1000 RPD free), the spec says "publish without AI tags". Better fallback: Gemini 3 Flash Preview, which has a SEPARATE free tier and slightly better quality.

**What**:
- Update `worker/services/scheduler.py` to track quotas separately for `gemini-2.5-flash-lite` and `gemini-3-flash-preview`
- In `worker/modules/analyzer.py` fallback chain:
  1. Try `gemini-2.5-flash-lite` (free, 1000 RPD)
  2. If quota exhausted, try `gemini-3-flash-preview` (free, separate quota)
  3. If both exhausted, publish without AI fields (existing behavior)
- Document this in CLAUDE.md Partie 3

**Effort**: S (~2 hours)
**Impact**: increases AI-enriched clips during high-volume tournament weeks
**Cost delta**: $0 (both on free tier)
**Dependencies**: none
**Source**: https://ai.google.dev/gemini-api/docs/pricing

---

### P1-3. Add Vercel Web Analytics alongside Umami
**Why**: Umami self-hosted is privacy-first but doesn't capture Core Web Vitals (LCP, INP, CLS, and the new VSI metric introduced in Core Web Vitals 2.0 in early 2026). Vercel Web Analytics free Hobby tier (50K events/mo) handles CWV automatically with zero config.

**What**:
- In `web/`, add `@vercel/analytics` + `@vercel/speed-insights`
- Wire `<Analytics />` and `<SpeedInsights />` in `app/layout.tsx`
- 50K events/mo covers ~1500 users/day at our scale

**Effort**: XS (~30 min)
**Impact**: free Core Web Vitals dashboard + INP regression alerts
**Cost delta**: $0 (Hobby free)
**Dependencies**: none
**Source**: https://vercel.com/docs/analytics/limits-and-pricing

---

### P1-4. Plan Supabase Pro PITR add-on into the cost projection
**Why**: CLAUDE.md says "AUCUN backup automatique → pg_dump hebdomadaire manuel" — this is fine for free tier but if/when migrating to Pro for egress headroom, **PITR is NOT included** in Pro base ($25/mo). PITR add-on costs $100-400/mo extra AND requires Small compute upgrade.

**What**:
- Update `docs/loltok-cost-model.md` (and CLAUDE.md Partie 10) to reflect:
  - Supabase Pro $25/mo base + PITR $100/mo + Small compute upgrade ~$10/mo = **~$135/mo total at first commercial tier**
- Define when to migrate: trigger = sustained 4 GB/mo egress for 2 months
- Document an alternative: stay on Free + run nightly `pg_dump` to R2 (saves $135/mo, costs ~5 min/day in worker job time)

**Effort**: XS (~30 min doc work)
**Impact**: prevents budget surprise when scaling
**Cost delta**: clarity on +$135/mo cliff at scale-up
**Dependencies**: none
**Source**: search "Supabase Pro PITR pricing 2026"

---

### P1-5. Rename `framer-motion` to `motion` in package.json
**Why**: Framer Motion was renamed to "Motion" with the v11+ rebrand. The `framer-motion` package is now an alias and may be deprecated. The new name is `motion`.

**What**:
- `npm uninstall framer-motion && npm install motion`
- Update imports: `from "framer-motion"` → `from "motion/react"`
- `motion.dev` confirms v12.37.0 latest (March 16 2026)

**Effort**: S (~1-2 hours, mostly find/replace + verify all animations still work)
**Impact**: future-proofing, no functional change
**Cost delta**: $0
**Dependencies**: none
**Source**: https://motion.dev

---

## P2 — Nice to have (Phase 3+)

### P2-1. Migrate to Next.js 16.2
**Why**: Cache Components, Turbopack default stable, React Compiler stable, ~400% faster `next dev`. Long-term: aligns with where the framework is going.

**What**:
- Run `npx @next/codemod@canary upgrade latest`
- Manually fix async params breakages (now `params: Promise<{...}>` in dynamic routes)
- Update image config (defaults changed)
- Re-test all routes
- Verify ISR/SSR caching semantics still produce expected behavior

**Effort**: M (~1-2 days, depending on how many dynamic routes we have)
**Impact**: dev productivity (4× faster startup), production rendering (50% faster)
**Cost delta**: $0
**Dependencies**: must be done after V0 stabilizes (don't gamble on launch week)
**Source**: https://nextjs.org/blog (16.2 release post)

---

### P2-2. Add ParadeDB for advanced search (Phase 3 only)
**Why**: When community search starts requiring "find clips similar to X" or ranking by community signal × search relevance, ParadeDB's BM25 implementation in Postgres beats tsvector and avoids adding a separate Algolia/Meilisearch service.

**What**:
- ParadeDB is a Postgres extension; install on a self-hosted Postgres or wait for Supabase to support it (Supabase is on their backlog per ParadeDB docs)
- Re-index `kills.search_vector` as a BM25 index
- Add player + champion + ai_description as boosted fields

**Effort**: M (~2 days)
**Impact**: noticeably better search UX, better results ranking
**Cost delta**: $0 self-hosted; cloud beta TBD
**Dependencies**: only after V0 launch and only if search complaints arrive
**Source**: https://www.paradedb.com (Series A funded, 8K+ GitHub stars, 500K+ Docker pulls)

---

### P2-3. Voyage AI embeddings for "similar clips" feature
**Why**: When we add "you watched a Caliste 3-shot adc, here's another Caliste 3-shot adc clip", semantic similarity needs vector embeddings. Voyage AI voyage-4-lite at $0.02/M with 200M tokens free per account is dramatically cheaper than OpenAI text-embedding-3-large.

**What**:
- Add embedding generation step in `worker/modules/analyzer.py` post-Gemini
- Add `pgvector` extension to Supabase (free)
- Add `kills.embedding vector(1024)` column
- Compute embedding from concatenated `(killer_champion, victim_champion, ai_description, ai_tags)`
- Add HNSW index for nearest-neighbor search

**Effort**: M (~1 day)
**Impact**: enables "more like this" recommendations, related clip suggestions on `/kill/[id]`
**Cost delta**: $0 (200M free tokens covers ~100K kills)
**Dependencies**: pgvector enabled on Supabase project
**Source**: https://docs.voyageai.com/docs/pricing

---

### P2-4. Capacitor 8 wrapper for App Store presence
**Why**: ~25% of EU iOS users get PWAs in Safari tabs (no push) due to DMA compliance. Wrapping the PWA in Capacitor 8 → ship to App Store + Play Store unlocks push for them.

**What**:
- `npx @capacitor/cli init`
- Add iOS + Android platforms
- Configure push via Apple APNS + FCM
- Build, sign, submit to stores

**Effort**: L (~3-5 days first time, including App Store review delays)
**Impact**: ~25% more reachable EU iOS users for push notifications
**Cost delta**: $99/yr Apple Developer + $25 Google Play (one-time)
**Dependencies**: stable PWA + push working in browser first
**Source**: https://ionic.io/blog/tag/capacitor (Capacitor 8 announced Dec 8 2025)

---

### P2-5. Consider PostgreSQL 18 upgrade
**Why**: PG18 GA was Sep 25 2025. Brings async I/O, OAuth 2.0 in core, virtual generated columns, `pg_stat_io` for I/O monitoring. Supabase still defaults to PG17.

**What**:
- Check current Supabase project's Postgres version (Dashboard → Database → Settings)
- If PG17, schedule an upgrade window via Supabase Dashboard
- Test async params and ensure no breaking changes for our schema

**Effort**: S (~2-3 hours including verification)
**Impact**: I/O perf gain on large queries, future-proofing
**Cost delta**: $0
**Dependencies**: Supabase must support PG18 upgrade (TBC; check Supabase changelog)
**Source**: https://www.postgresql.org/about/news/postgresql-18-released-3142/

---

### P2-6. Evaluate Grok 4.1 Fast / DeepSeek-V4-Flash for moderation as a cost optimization
**Why**: Claude Haiku 4.5 at $1/$5 is excellent but costs ~$3.75/mo at 500 comments/day. If volume grows to 5000 comments/day, that's $37.50/mo. Grok 4.1 Fast ($0.20/$0.50) or DeepSeek-V4-Flash ($0.14/$0.28) are 5-7× cheaper.

**What**:
- Evaluate quality: run 100 sample comments through Haiku + Grok 4.1 Fast + DeepSeek and compare moderation decisions
- If quality holds, add as fallback or primary at high volume

**Effort**: S (~3 hours for eval) + S (~2 hours integration if green)
**Impact**: 5-7× cost reduction on moderation
**Cost delta**: -$30/mo at 5K comments/day
**Dependencies**: only relevant once volume justifies — premature optimization for V0
**Caveat**: DeepSeek is China-based → EU residency concerns; recommend Grok 4.1 Fast as the safer cost-cut

**Source**:
- Grok 4.1 Fast: search mem0.ai/blog/xai-grok-api-pricing
- DeepSeek-V4-Flash: https://api-docs.deepseek.com/quick_start/pricing

---

### P2-7. Add Axiom for worker log aggregation (free 500 GB/mo)
**Why**: structlog JSON logs from worker currently go to local files + Discord webhooks. For root-cause debugging across days of history, queryable logs help. Axiom free tier = 500 GB/mo ingest + 25 GB storage + 30-day retention.

**What**:
- Worker → Axiom HTTP ingest endpoint
- Add log forwarder in `worker/services/`
- Or use OpenTelemetry exporter

**Effort**: S (~2-3 hours)
**Impact**: faster bug triage, ability to grep historical worker behavior
**Cost delta**: $0 (free tier)
**Dependencies**: none
**Source**: https://axiom.co/pricing

---

## Items DEFERRED — not worth doing

### Skip: AV1 transcoding
Only 9.76% of mobile devices have AV1 hardware decode (Q2 2024 data per ScientiaMobile). Software AV1 decode burns mobile battery and is slower than H.264 hardware decode on the same device. Re-evaluate in Q4 2026 when iPhone 16+/M3+ Mac penetration grows.

### Skip: Cloudflare Stream
At our scale and given R2's $0 egress, Cloudflare Stream's $5/mo bundle delivers worse value than R2 + DIY ffmpeg.

### Skip: Mux / Bunny Stream
Same reasoning — R2 + DIY is dramatically cheaper for our static clip library.

### Skip: Migrating off Supabase Auth to Clerk / Stack Auth / Better-Auth
Supabase Auth is bundled free with our DB. Net savings of switching = $0; net effort = significant. Only consider if Discord OAuth specifically breaks something.

### Skip: Migrating off Vercel
Hobby tier is free + Mehdi's `ignoreCommand` config blocks preview-deploy build minute drain. No reason to leave.

### Skip: PostHog / Plausible / Better Stack as primary analytics
Umami self-hosted + Vercel Web Analytics covers our needs. PostHog is great for session replay if we ever need it (free 5K replays/mo).

### Skip: Datadog / New Relic / Honeycomb
Massively overkill for V0 scale. Sentry + Vercel + Umami is sufficient.

### Skip: Highlight.io
Sunset Feb 28 2026. Do not adopt under any circumstances.

---

## Summary: what to actually do

**Before V0 launch** (P0):
1. Add Sentry (3h) — free, covers blind spot
2. Update Hetzner cost projections (5 min) — accuracy
3. Block any Highlight.io recommendations from other agents — risk avoidance

**Phase 1-2** (P1):
4. Gemini 3.1 Pro escalation for hype clips (3h)
5. Gemini 3 Flash Preview as secondary fallback (2h)
6. Vercel Web Analytics + Speed Insights (30 min)
7. Document Supabase Pro+PITR scale-up cost (~$135/mo cliff)
8. Rename `framer-motion` → `motion` (1-2h)

**Phase 3+** (P2):
9. Next.js 16.2 migration when launch stabilizes
10. ParadeDB if search complaints arrive
11. Voyage AI embeddings for "similar clips"
12. Capacitor 8 wrapper for App Store EU push
13. PostgreSQL 18 upgrade
14. Grok 4.1 Fast moderation eval if comment volume grows
15. Axiom worker log aggregation
