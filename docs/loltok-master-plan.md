# LoLTok — Master Plan

**Author:** Agent CA (Wave 10 swarm)
**Date:** 2026-04-25
**Status:** Living document — revise after every phase exit
**Audience:** Mehdi (operator), reviewed once over coffee

---

## 0. TL;DR

LoLTok is the **TikTok of LoL pro kills**. Today (Phase 0) it tracks ONE team (Karmine Corp) in ONE league (LEC + LFL) for ONE streamer (EtoStark). Tomorrow it should cover **every kill, every team, every league, every year** — a global, mobile-first, community-driven product.

The pilot architecture is already **Series-A-grade** (multi-stage worker, R2 CDN, Supabase + RLS, dual-format clips, AI annotation, OG pre-gen, push notifs, DLQ, RUM). It is over-engineered for KC scale and **ready for scale**. The remaining work is mostly:

1. **Replace hardcoded team/league filters with env-driven sets** (Wave 10 in progress)
2. **Migrate from free tiers to paid tiers in lockstep with traffic**
3. **Pay for real video infrastructure** (residential proxy YouTube ingestion + Cloudflare Stream) once we cross 50K MAU
4. **Add monetization** before Phase 4 or kill the project before it eats the operator alive

This document defines the 5 phases (0 → 4), what ships in each, the cost ceiling, the technical risks, and the success metrics.

---

## 1. Vision

### 1.1 What LoLTok is

> Every kill in pro League of Legends, since 2011, automatically clipped, AI-annotated, rated by the community, scrollable like TikTok.

Three pillars:

- **Coverage** — every team, every league, every year. Not just KC. Not just LEC. Not just 2026.
- **Discovery** — a mobile-first vertical scroll feed driven by a community-rated highlight score (Wilson lower bound, not raw average).
- **Community** — Discord OAuth login enables rate, comment, tag, share. Optional Riot OAuth links your in-game identity to your taste in plays.

### 1.2 What LoLTok is NOT

- **Not a streaming replacement.** We don't compete with Twitch/YouTube live for full matches.
- **Not a stat site.** Oracle's Elixir, gol.gg, leaguepedia already do that. We use them as fallback data sources.
- **Not a betting site.** Zero gambling integrations. Zero "predict the outcome" features. Riot's developer ToS is hostile to anything money-flavoured.
- **Not a Riot product.** We operate under the "Legal Jibber Jabber" policy — fan project, not endorsed.

### 1.3 Why this can work

- **R2 has zero egress fees.** Video is the cost killer for everyone else; we sidestep it.
- **The pilot is already running.** 525 KC kills published, 1900+ pipeline jobs succeeded, daemon is stable on Mehdi's PC. We are not starting from zero.
- **The KC fanbase is concentrated on Discord and YouTube.** Day-1 reach is real (EtoStark + KC channels = 100K+ engaged viewers).
- **Esports vertical clip content has product-market fit.** Riot's own LoL Esports app, Strafe, escharts, even TikTok's `#leagueoflegends` (8B views) prove demand.

### 1.4 Why this can fail

- **Single operator.** Mehdi runs everything. Burnout is the #1 risk.
- **YouTube ToS / IP fingerprinting.** Mass cookie-based ingestion is fragile (see PR `10bbe6f` hotfix). Long-term legitimate solution needed.
- **Riot legal turbulence.** The "Legal Jibber Jabber" policy can be revoked. Worst case: full takedown.
- **Free tier exit cost.** Moving from Supabase Free to Pro is $25/mo. Easy. Moving from Vercel Hobby to Pro is $20/seat. Easy. Moving from Gemini free tier to paid AI for 1.2M historical kills is **~€1500–€3000 one-shot**. Real money.

---

## 2. Phases

The phasing is **opinionated and gated**: do not advance to phase N+1 until phase N has stable metrics for 30 days.

| Phase | Codename | Scope | Est. clips | MAU target | Total cost / mo | Operator effort |
|-------|----------|-------|-----------|-----------|-----------------|----------------|
| 0 | KC Pilot | 1 team, LEC+LFL, 2026 | ~600 | 1K | €0 | 1 person, evenings |
| 1 | Multi-team Europe | LEC + LFL + EU Masters | 3-5K / season | 50K | ~€80 | 1 person, weekends |
| 2 | Multi-region core | + LCS + LCK + LPL | 20K / season | 200K | ~€500 | 1 person + 1 contractor |
| 3 | Historical backfill | All leagues, 2011 → today (~1.2M kills, one-shot) | ~1.2M | 200K (no growth, infra heavy) | ~€500/mo + €2K one-shot | 2-3 people |
| 4 | Public launch | All-time, all-leagues, monetized | growing | 1M+ | €2K-5K (revenue should cover) | small team |

### 2.1 Phase 0 — KC Pilot (now)

**Status:** ✅ Live since Q1 2026
**Scope:** Karmine Corp, LEC Versus + LFL 2026
**Volume:** ~600 KC kills, ~30 matches, ~6 GB R2 storage, 0 € hosting cost

**Deliverables shipped:**
- Multi-stage worker (sentinel → harvester → vod_hunter → clipper → analyzer → publisher) with DLQ
- Triple-format clips (H 720p / V 720p / V 360p) on R2 + custom domain
- Vertical scroll feed at `/scroll` with Wilson-score ranking
- KC Timeline filter (9 eras)
- Discord OAuth + Riot OAuth optional
- Comment moderation via Claude Haiku
- Push notifications (VAPID)
- OG pre-generation (Pillow → R2)
- RUM Web Vitals
- Live dashboard, smart DLQ drainer, runtime tuning

**Validation criteria for exit:**
- ✅ 7 consecutive days with zero CLIP_ERROR not auto-recovered
- ✅ EtoStark featured the site at least once
- ⏳ 100+ unique users / week sustained
- ⏳ At least one comment thread with > 5 replies (community spark)

**Phase 0 is the proof. It must remain non-regressive throughout all subsequent phases.**

### 2.2 Phase 1 — Multi-team Europe (LEC + LFL + EU Masters)

**Goal:** Open the pilot to the entire European scene. Validate that the multi-team architecture holds.
**Trigger to start:** Phase 0 validation criteria met.

**Scope:**
- All 10 LEC teams (KC, G2, FNC, MAD, BDS, RGE, SK, TH, GX, VIT)
- All 10 LFL teams
- EU Masters seasonal coverage (~36 teams across 8 EU regional leagues, but only when EUM is live)
- Languages: FR + EN

**Volume estimate:**
- ~28 kills/game × 5 games avg per match-day × 5 match-days/week × 28 weeks/year = ~19,600 kills/year for LEC alone
- Add LFL (~12,000) + EUM (~3,000) = **~35,000 kills/year, ~3,000 / month sustained, peak ~8,000 / month during finals**
- R2 storage at ~50 MB / kill (3 formats + thumbnail) = **~1.5 TB over the year, +125 GB / month sustained**
- Supabase egress at ~3 KB / kill metadata × 200K monthly views per kill avg = **~6 GB / month** (still on Free tier ceiling but tight)

**Product features to ship:**
- **Multi-team feed** — feed algorithm must include team diversity factor (don't show only G2 even if G2 has highest scores)
- **Team profile pages** `/team/[slug]` — roster, stats, recent kills, eras
- **Team filter chip bar** at top of `/scroll`
- **Push notif segmentation** by followed teams (user picks their teams in settings)
- **Custom domain rebrand** — `kckills.com` becomes a redirect to `loltok.gg` (or whatever domain wins)
- **Bilingual UI** — extract all strings via custom homemade `t()` (next-intl is overkill until 5+ languages)

**Infra changes:**
- Migrate to Supabase Pro ($25/mo) — egress headroom + PITR backups
- R2 paid tier ($0.015/GB/mo storage, free egress) — ~$2/mo at this scale
- Worker still on Mehdi's PC (PC handles 3-5K clips/season trivially)
- Add Sentry Free tier (5K errors/mo) for client-side observability

**Cost ceiling:** **€80 / mo** (Supabase Pro €23 + R2 €2 + Vercel still Hobby €0 + AI €5 + domain + buffer)

### 2.3 Phase 2 — Multi-region core (+ LCS + LCK + LPL)

**Goal:** Become the global esports clip platform. Add the three other major regions.
**Trigger to start:** Phase 1 sustains 50K MAU for 60 days.

**Scope:**
- LEC + LFL + EUM (Phase 1) — Europe
- LCS (10 teams) + NACL — North America
- LCK (10 teams) — Korea
- LPL (17 teams) — China
- Worlds + MSI + First Stand — international events
- Languages: FR + EN + KO + ZH (machine-translated from EN, native review on top kills only)

**Volume estimate:**
- ~28 kills/game × 5 games × 5 days × 36 weeks/year × 4 leagues = **~100,000 kills/year, ~8,000 / month sustained, peak ~25,000 / month during Worlds**
- R2 storage ~5 TB total across the year → **€60/mo storage** (€0.015/GB)
- Supabase egress: 8K kills × 500K avg views = blow past Free tier and even Pro tier
  - Need to migrate hot reads to **R2-backed JSON API** (worker writes pre-rendered feed JSON to R2 every 30s, frontend reads from R2 not Supabase) → cuts Supabase egress 95%
- Worker compute outgrows the PC: parallel clipping + AI annotation needs **2 vCPU / 4 GB RAM minimum**, ideally **4 vCPU / 8 GB**. Move to **Hetzner CCX13 or CCX23** (€15-30/mo). PC stays as warm spare.

**Product features to ship:**
- **Region/league selectors** — user can filter scroll by region, league, team, or all-of-the-above
- **Worlds / MSI live mode** — bandeau + 15s polling for live events, with multi-cast support (LCK English vs LCK Korean stream)
- **Clip caster preference** — user picks Trevor / LS / Cottoneer / French casters / etc., served from their preferred VOD source
- **Algolia search** ($0.50 per 1K records, ~$50/mo at this scale) — Postgres FTS hits its ceiling at 100K rows
- **Multi-language AI annotation** — Gemini bills per token, cost scales linearly
- **Player career view** `/player/[slug]` — works across leagues (player who played LCK then LEC then LCS)

**Infra changes:**
- Worker → Hetzner CCX23 (€30/mo, dedicated)
- Database → Supabase Team plan ($599/mo) **OR** stay on Pro and pre-bake JSON to R2 (much cheaper)
- Algolia free tier (10K records, 100K ops/mo) → Algolia Build ($50/mo)
- Cloudflare Stream **considered** (transcoding + adaptive bitrate HLS for $1/1000 minutes delivered) — pencil out break-even
- Sentry Team plan ($26/mo per user)
- Redis (Upstash free → $10/mo) for rate limiting + push notif debouncing

**Cost ceiling:** **€500 / mo** (Hetzner €30 + Supabase Pro €23 + Algolia €47 + R2 €60 + AI multi-lang €100 + Sentry €25 + Redis €10 + buffer 30% = €390 → round up €500)

### 2.4 Phase 3 — Historical backfill (2011 → today)

**Goal:** Become the **only** archive of every pro LoL kill, ever.
**Trigger to start:** Phase 2 sustains 200K MAU for 90 days **and** revenue covers Phase 2 cost.

**Scope:**
- ~15 years of pro LoL (Season 1 2011 → today)
- Estimated ~120,000 pro matches, ~28 kills/match avg = **~1.2M kills total**
- VOD coverage decreases pre-2018 — fallback to YouTube user uploads + leaguepedia + community-submitted clips
- Fewer features, more crunch: this is an **infra-heavy one-shot**

**Volume + compute reality check:**
- 1.2M kills × 50 MB avg = **60 TB R2 storage = €900/mo storage forever**
- AI annotation: 1.2M Gemini Flash-Lite calls at €0.10 / M input tokens × ~3000 tokens / call = **~€360 one-shot**, but realistically Gemini paid tier (no free quota at this volume) plus hard rate-limit ceilings means **~€1500-2000 one-shot** with multi-provider fallback
- yt-dlp throughput: 10s delay between downloads × 1.2M = **136 days single-threaded**. Need parallelism (5-10 concurrent workers behind residential proxies) to crunch in **3 months**
- Worker compute during backfill: **3-4 dedicated boxes** (CCX23 × 4 = €120/mo for 3 months) → **€360 backfill compute**

**One-shot backfill budget:** **~€2,500** (AI + compute + bandwidth burst + manual review labor)

**Ongoing cost after backfill:** Phase 2 cost + ~€900/mo storage = **~€1,400/mo storage-heavy**. **This is the moment we MUST migrate cold archives to a Glacier-equivalent** (R2 has no cold tier yet — fallback is Backblaze B2 at $0.005/GB or Wasabi at $6/TB/mo flat with no egress fees).

**Product features to ship:**
- **Year picker** in scroll feed (slide from 2011 to 2026)
- **Iconic Plays** curated reels (penta moments, MSF Clutchz, Madlife hooks, Faker outplays)
- **Archive disclaimer** — "Historical clip, source verified" badge for kills with manual review

**Infra changes:**
- Cold storage tier — **Backblaze B2 for clips > 2 years old** (cheaper than R2, free Cloudflare egress via Bandwidth Alliance preserved)
- Multi-region read replica (Supabase has read replicas on Team plan) for Asian/American latency
- Residential proxy pool for YouTube ingestion — **paid service like BrightData or Oxylabs at €100-300/mo** (versus risky cookie rotation)

**Cost ceiling:** **€500/mo ongoing + €2,500 one-shot** (or **€1,400/mo if no cold tier migration** — flag this decision explicitly)

### 2.5 Phase 4 — Public launch + monetization

**Goal:** Stop being Mehdi's hobby. Become a self-sustaining product.
**Trigger to start:** Phase 3 backfill complete, 1M+ MAU sustained for 60 days.

**Monetization options (ranked by realism):**

1. **Sponsored clips** — riot-approved sponsors (peripheral brands, energy drinks, gaming chairs) pay €500-2000 per clip pinned to top of region feed for 24-48h. **Estimated ARPM (avg revenue per month):** €5,000–€20,000. **Risk:** Riot Jibber Jabber forbids monetization without permission — must apply to **Riot Partner Program** before this.
2. **Freemium tier** — €4/mo "LoLTok Pro" removes ads, unlocks 4K downloads, ad-free push notifs. **Take rate:** 1-2% of MAU = 10K-20K paying users at 1M MAU = **€40K-80K/mo**. Realistic.
3. **Affiliate** — Amazon/Newegg gaming peripheral links in player profile pages ("Faker plays with X mouse"). **ARPM:** €1K-5K/mo, low effort.
4. **Partnership with leagues** — sell aggregated viewer data + clip embed widgets to LEC/LCS broadcast partners. **ARPM:** €0–€100K/mo, very high variance, requires legal team. **Phase 4+ stretch.**
5. **No NFTs. No crypto. No fanduel-style "predict the kill". Ever.**

**Cost ceiling:** **€2,000-5,000/mo** (Phase 3 ongoing + monitoring upgrades + 1 part-time community manager). Revenue should be 5-10× cost or the project is not viable.

**Operator effort:** Becomes a small team (2-4 people) or LoLTok stays a side-project at 200K MAU forever. Both are valid outcomes.

---

## 3. Per-phase deliverable matrix

| Capability | P0 | P1 | P2 | P3 | P4 |
|-----------|----|----|----|----|----|
| Vertical scroll | ✅ | ✅ | ✅ | ✅ | ✅ |
| Wilson-score feed | ✅ | ✅ | ✅ | ✅ | ✅ |
| Discord OAuth | ✅ | ✅ | ✅ | ✅ | ✅ |
| Riot OAuth optional | ✅ | ✅ | ✅ | ✅ | ✅ |
| AI annotation (Gemini) | ✅ | ✅ | ✅ + multi-provider | ✅ + multi-provider | ✅ |
| Push notifs | ✅ | + segmentation | + segmentation | + segmentation | + scheduled drops |
| OG images | ✅ | ✅ | ✅ multi-lang | ✅ multi-lang | ✅ |
| KC Timeline | ✅ | ❌ (replaced by team page) | — | — | — |
| Multi-team feed | ❌ | ✅ | ✅ | ✅ | ✅ |
| Multi-language UI | FR | FR + EN | FR/EN/KO/ZH | + JA + ES | + 10 languages |
| Worlds live mode | ❌ | ❌ | ✅ | ✅ | ✅ |
| Algolia search | ❌ | ❌ | ✅ | ✅ | ✅ |
| Iconic plays curation | ❌ | ❌ | ❌ | ✅ | ✅ |
| Year picker (2011→) | ❌ | ❌ | ❌ | ✅ | ✅ |
| Sponsored clips | ❌ | ❌ | ❌ | ❌ | ✅ |
| Pro tier (paid) | ❌ | ❌ | ❌ | ❌ | ✅ |
| Multi-region replica | ❌ | ❌ | ❌ | ✅ | ✅ |
| Cold tier storage | ❌ | ❌ | ❌ | ✅ | ✅ |

---

## 4. Risks & mitigations

### 4.1 Top 5 risks (ranked by impact × probability)

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|-----------|
| **YouTube IP/cookie ban** | Total clipping outage | Medium-High | Migrate to residential proxies (BrightData/Oxylabs) at Phase 2. Diversify VOD sources (Twitch VODs, Riot's own VOD URLs from `getEventDetails`). |
| **Riot revokes Jibber Jabber** | Total takedown | Low (but catastrophic) | Apply to Riot Partner Program at Phase 2 exit. Maintain zero-trademark UI (no "League of Legends" wordmark, only "LoL" + champion names). Have a legal disclaimer template ready. |
| **Operator burnout** | Project death | High | At Phase 1 exit, hire 1 community contractor. At Phase 2, formalize roles. Prioritize automated alerts > manual checks. |
| **Cost spike from viral moment** | Free tier blown overnight | Medium | Hard caps on Vercel + Supabase via budget alerts. Pre-bake feed JSON to R2 (zero egress) so a viral hit doesn't ruin egress budget. |
| **AI provider deprecation** | Annotation pipeline broken | Medium (Gemini 2.0 already died once) | Multi-provider router (Gemini + Anthropic + OpenAI) as primary architecture from Phase 2. Cache annotations forever — never re-call the API for the same clip. |

### 4.2 Operational risks

- **Single PC = SPOF for the worker.** Mitigated at Phase 2 with Hetzner migration. Until then, document the recovery procedure (worker can be run from any modern Windows/Linux box with Python 3.11+ in 30 minutes).
- **Supabase 7-day inactivity pause** — the worker heartbeats every hour. Verified.
- **No Supabase backup on Free tier** — `pg_dump` cron to R2 weekly. Implemented.
- **DNS lock-in** — Cloudflare DNS is portable but `kckills.com` is in Hostinger. Migrate to Cloudflare Registrar at Phase 1 (no markup, $9/yr).

### 4.3 Legal risks

- **Riot ToS** — use only fan-content allowed assets. No selling Riot IP. Disclaimer on every page (already shipped).
- **GDPR** — RGPD-compliant, "delete my account" + "export my data" already shipped. Add ICO/CNIL DPO contact at Phase 2.
- **DMCA on community-submitted clips** — `community_clips` table exists but submission UI not yet shipped. When it ships (Phase 2), add DMCA takedown form + 24h SLA.
- **YouTube DMCA on clipper output** — clips are short-form fair-use, but defensible only if we don't monetize. **The day we monetize (Phase 4), legal review is non-negotiable.**

---

## 5. Success metrics (per phase)

| Metric | P0 target | P1 target | P2 target | P3 target | P4 target |
|--------|-----------|-----------|-----------|-----------|-----------|
| **DAU** | 100 | 5K | 20K | 30K | 100K |
| **MAU** | 1K | 50K | 200K | 200K (saturating) | 1M+ |
| **W4 retention** | n/a | 15% | 25% | 30% | 35% |
| **Clips published / week** | ~30 | ~250 | ~2K | one-shot crunch | ~3K + curated |
| **Avg clip rating count** | 2 | 10 | 50 | 100 | 200 |
| **Comments / clip** | 0.1 | 0.5 | 2 | 5 | 8 |
| **AI annotation latency p95** | < 2 min | < 1 min | < 30s | < 30s | < 15s |
| **Pipeline error budget** | 5% | 2% | 1% | 1% | 0.5% |
| **Push opt-in rate** | n/a | 10% | 20% | 25% | 30% |
| **Lighthouse PWA score** | > 90 | > 90 | > 95 | > 95 | > 95 |

**Definition of MAU:** unique authenticated user OR unique PWA install opening the app at least once in the last 30 days. Unauth scroll-only viewers tracked separately as "browsers".

**Definition of error budget:** % of pipeline_jobs ending in `dead_letter` after all retries. Above the budget, freeze new feature rollouts and burn down errors.

---

## 6. Decision log (key bets)

1. **R2 over S3** — chosen for zero egress. Decision irreversible without significant cost increase.
2. **Supabase over self-hosted Postgres** — chosen for RLS-by-default + Auth UI free + PITR. Reversible in ~1 week of migration if Supabase pricing becomes hostile.
3. **Discord OAuth as primary** — chosen for KC fanbase fit. Add Google + Twitch + Apple at Phase 4 for global launch.
4. **Gemini 2.5 Flash-Lite as primary AI** — cheap + multimodal video input. Migrate to multi-provider router at Phase 2 to avoid single-vendor risk.
5. **PWA over native app** — install banner, push notifs, offline cache. Reverse only if iOS Safari regresses Web Push (unlikely as of 2026).
6. **Mobile-first 375px design** — not negotiable. Desktop is a nice-to-have, not the primary surface.
7. **Wilson lower bound, not raw average** — protects against 1-rating gaming. Already shipped.
8. **No Realtime, polling instead** — protects egress budget. Reversible at Phase 2 with paid tier.
9. **Pre-baked OG images via Pillow worker** — avoids Vercel Edge compute cost. Stays through all phases.
10. **No paid feature in Phase 0-3** — free product, growth-first. Monetization only at Phase 4 once retention is proven.

---

## 7. What this document does NOT cover

- Detailed cost line-items per service per phase → see `loltok-cost-model.md`
- Tech stack decisions with alternatives → see `loltok-tech-stack-decisions.md`
- Step-by-step migration playbook → see `loltok-migration-runbook.md`
- Feature flag config → see `web/src/lib/feature-flags.ts` (when Wave 10 ships)
- Worker module specs → see `worker/CLAUDE.md` (and per-module docstrings)

---

## 8. Revision triggers

Re-read and revise this document when:
- A phase exits successfully (update validation criteria)
- Cost forecast drifts > 20% from actual (update cost model)
- A major dependency shifts (Riot policy, Supabase pricing, Vercel pricing, Gemini deprecation)
- An incident causes > 24h downtime (update risks)
- A monetization model is validated or invalidated

**Last revision:** 2026-04-25 (initial draft, Wave 10)
