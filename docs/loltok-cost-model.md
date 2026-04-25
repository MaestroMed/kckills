# LoLTok — Cost Model

**Author:** Agent CA (Wave 10 swarm)
**Date:** 2026-04-25
**Currency:** EUR (1 USD ≈ 0.93 EUR as of writing — check the math when prices in $)
**Audience:** Mehdi, deciding when to upgrade tiers + when monetization becomes mandatory

> **Methodology:** Numbers grounded in publicly available pricing pages as of April 2026 (Vercel, Supabase, Cloudflare R2, Anthropic, Google Cloud, Hetzner, Algolia, Sentry). Where pricing is volume-tiered, I take the **mid-tier estimate** and apply a **30% safety margin** on the totals. This is a planning instrument, not a budget commitment.

---

## 1. Per-service price reference (April 2026)

| Service | Free tier | Paid entry | Notes |
|---------|-----------|------------|-------|
| **Vercel** | Hobby (no commercial use, 100 GB bandwidth/mo) | Pro $20/seat/mo + $40 per extra TB bandwidth | We get hammered on bandwidth at scale |
| **Supabase** | 500 MB DB, 5 GB egress, 50K MAU, no PITR, 7-day inactivity pause | Pro $25/mo (8 GB DB, 250 GB egress, PITR 7 days, no pause) | Egress is the real cost — read carefully |
| **Cloudflare R2** | 10 GB storage, 1M Class A ops, 10M Class B ops, **0 egress** | $0.015 / GB stored / mo, $4.50 / M Class A ops, $0.36 / M Class B ops | Egress stays free forever — the moat |
| **Cloudflare Stream** | None | $5 per 1000 minutes stored / mo + $1 per 1000 minutes delivered | Includes transcoding — compete with our R2+HLS only at scale |
| **Backblaze B2** | 10 GB storage, 1 GB/day egress | $0.005 / GB stored / mo + $0.01 / GB egress (free via Cloudflare Bandwidth Alliance) | Cold tier candidate for archives |
| **Anthropic Haiku 4.5** | None (paid only) | $1 / M input tokens, $5 / M output tokens | Moderation only |
| **Google Gemini 2.5 Flash-Lite** | 1000 RPD, 15 RPM, 250K TPM, free | $0.10 / M input, $0.40 / M output (paid tier — verify pricing page!) | Annotation primary |
| **OpenAI gpt-4o-mini** | None | $0.15 / M input, $0.60 / M output | Multi-provider fallback |
| **Hetzner Cloud** | None | CCX13 (2 vCPU, 8 GB) €15/mo, CCX23 (4 vCPU, 16 GB) €30/mo, CCX33 (8 vCPU, 32 GB) €60/mo | Worker box — best price/perf in EU |
| **Fly.io** | 3 shared CPUs free | $1.94/mo per shared-1x VM, $5.70/mo per dedicated-1x | Convenient but pricier than Hetzner at scale |
| **Railway** | $5/mo trial credit | $5/mo + usage | Convenient PostgreSQL + worker hosting, but expensive |
| **Render** | Free tier sleeps | $7/mo per always-on web service | Decent but Hetzner wins on €/CPU |
| **Algolia** | 10K records, 100K ops/mo | Build $50/mo (50K records, 1M ops), Grow $500/mo (1M records) | Search at scale |
| **Sentry** | 5K errors/mo, 50 perf events/mo, 1 user | Team $26/mo per user (50K errors, 100K perf), Business $80/mo per user | Phase 1+ |
| **Honeycomb** | 20M events/mo free | Pro $130/mo (1.5B events) | Phase 3+ when multi-region |
| **Upstash Redis** | 10K commands/day, 256MB | Pay-as-you-go $0.20 per 100K commands | Push notif debouncing, rate limiting |
| **Discord webhook** | Free, ~30 msgs/min | n/a | Stays free forever |
| **VAPID push** | Free | Free | Browser-native, zero infra cost |
| **Domain (`.gg`)** | n/a | $35-70/yr at registry | TLD premium for esports |
| **Cloudflare Registrar** | n/a (transfer fees) | At-cost, no markup | Move domains here |
| **Resend (transactional email)** | 3K emails/mo, 100/day | $20/mo (50K emails) | Phase 2+ if we add email |
| **Brightdata residential proxy** | None | $500/mo for ~40 GB residential | YouTube ingestion at scale |

---

## 2. Phase 0 — KC Pilot

**Volume:** 600 KC kills published, ~30 matches, 6 GB R2, 1K MAU

| Service | Tier | Usage | Cost / mo |
|---------|------|-------|-----------|
| Vercel | Hobby | <2 GB bandwidth | €0 |
| Supabase | Free | 80 MB DB, ~700 MB egress | €0 |
| R2 | Free | 6 GB | €0 |
| Gemini Flash-Lite | Free | <300 calls/day | €0 |
| Anthropic Haiku | Pay-per-use | <500 comments/day | €3 |
| Worker compute | Mehdi's PC | 24/7 | ~€5 (electricity) |
| Domain `kckills.com` | Hostinger | annual | €1 |
| Discord webhooks | Free | rate-limited | €0 |
| **TOTAL** | | | **~€10 / mo** |

**With 30% safety margin:** **€13 / mo**.
**Status:** Confirmed real cost. Project is essentially free.

---

## 3. Phase 1 — Multi-team Europe (LEC + LFL + EUM)

**Volume:** ~3K clips/mo sustained, ~125 GB R2 added/year, 50K MAU, ~6 GB Supabase egress/mo

| Service | Tier | Usage | Cost / mo |
|---------|------|-------|-----------|
| Vercel | Hobby (still free if no commercial use until P4) — **else Pro $20** | <30 GB bandwidth (PWA caches aggressively) | €0–€19 |
| Supabase | Pro $25/mo | 800 MB DB, ~6 GB egress | €23 |
| R2 | Paid | 150 GB stored | €2 |
| R2 ops | Paid | ~1.5M Class A, ~50M Class B | €18 |
| Gemini Flash-Lite | Paid (passes free quota) | ~3K calls/day = 90K/mo, ~3K tokens each | €30 |
| Anthropic Haiku | Pay-per-use | ~3K comments/day | €15 |
| Worker compute | Mehdi's PC | 24/7 (still fine) | €5 |
| Sentry Free | Free | <5K errors | €0 |
| Domain | Cloudflare Registrar | annual | €1 |
| Resend | Free tier | <3K emails | €0 |
| **SUBTOTAL** | | | **~€95 / mo** (with Vercel Pro: **€115**) |

**With 30% safety margin:** **€125 / mo (no Vercel Pro), €150 / mo (with).**

**Decision point:** Stay on Vercel Hobby until Vercel sends a "you're commercial" warning. Most likely we squeak by until late Phase 2.

**Cost ceiling I'd plan for:** **€80-150 / mo**.

---

## 4. Phase 2 — Multi-region core (+ LCS + LCK + LPL + Worlds + MSI)

**Volume:** ~8K clips/mo sustained, ~5 TB R2 total, 200K MAU, 80 GB Supabase egress (without R2-feed pre-bake)

### 4.1 Naive cost (no optimization)

| Service | Tier | Usage | Cost / mo |
|---------|------|-------|-----------|
| Vercel Pro | $20/seat × 1 + bandwidth | 200 GB bandwidth (extra 100 GB = $40) | €56 |
| Supabase | Team $599/mo (only way to get 1 TB egress) | 80 GB egress | €555 |
| R2 storage | Paid | 5 TB | €70 |
| R2 ops | Paid | 4M Class A, 200M Class B | €90 |
| Gemini paid | Paid | ~8K calls/day × 4 langs = 32K/day | €130 |
| Anthropic Haiku | Paid | ~10K comments/day | €50 |
| Hetzner CCX23 | Worker compute | 4 vCPU, 16 GB | €30 |
| Algolia Build | $50/mo | 50K records | €47 |
| Sentry Team | $26/mo × 1 user | 50K errors | €25 |
| Honeycomb | Free tier | <20M events | €0 |
| Upstash Redis | $10 PAYG | rate limiting | €10 |
| Domain | annual | | €1 |
| **SUBTOTAL** | | | **~€1,065 / mo** |

### 4.2 Optimized cost (R2-baked feed JSON)

The killer trick: **the worker writes the feed JSON to R2 every 30 seconds (per region/tag combo). The frontend reads from R2, not Supabase.** This drops Supabase egress 95%, lets us stay on Pro tier.

| Service | Tier | Usage | Cost / mo |
|---------|------|-------|-----------|
| Vercel Pro | $20/seat | 200 GB bandwidth | €56 |
| Supabase Pro | $25/mo | 4 GB egress | €23 |
| R2 storage | Paid | 5 TB clips + ~5 GB JSON feed | €70 |
| R2 ops | Paid | 4M Class A (worker writes) + 250M Class B (browser reads) | €100 |
| Gemini paid | Paid | 32K calls/day | €130 |
| Anthropic Haiku | Paid | 10K comments/day | €50 |
| Hetzner CCX23 | Worker | | €30 |
| Algolia Build | $50/mo | | €47 |
| Sentry Team | $26/mo | | €25 |
| Upstash Redis | PAYG | | €10 |
| Domain | annual | | €1 |
| **SUBTOTAL** | | | **~€540 / mo** |

**With 30% safety margin:** **€700 / mo**.

**Cost ceiling I'd plan for: €500-700 / mo.** **Mandatory architecture change:** R2-baked feed JSON. Worth a full sprint at Phase 1 → 2 transition.

---

## 5. Phase 3 — Historical backfill (1.2M kills one-shot)

### 5.1 One-shot backfill cost

| Item | Estimate |
|------|----------|
| Gemini paid annotation 1.2M calls × ~3K input tokens × €0.10 / M | €360 |
| Multi-provider fallback (when Gemini rate-limits, ~20% goes to gpt-4o-mini @ €0.15/M) | €110 |
| 4× Hetzner CCX23 for 3 months (parallel ingestion) | €360 |
| Brightdata residential proxy (3 months @ €500) | €1,500 |
| Manual review labor (1 contractor × 80h × €25/h) | €2,000 |
| R2 ingress bandwidth (free) | €0 |
| Anthropic safety review for sensitive content (1.2M comments-equivalent) | n/a (clips, not comments) |
| Buffer 25% | €1,000 |
| **ONE-SHOT TOTAL** | **~€5,330** |

**Realistic budget ask: €5,000-7,500 one-shot.** This is the moment to consider an angel investor or a Patreon push.

### 5.2 Ongoing cost after backfill

| Service | Tier | Usage | Cost / mo |
|---------|------|-------|-----------|
| Phase 2 baseline | (see above) | | €700 |
| R2 storage hot tier | Paid | 5 TB recent + 10 TB hot archive | €225 |
| Backblaze B2 cold tier | Paid | 50 TB (clips > 2 years) | €250 |
| Hetzner CCX33 (upgraded for archive serving) | | 8 vCPU, 32 GB | €60 |
| Supabase read replica (Asia + US) | Team plan unlocks this | | +€20 |
| Honeycomb Pro | $130/mo (we now exceed 20M events) | | €120 |
| Sentry Business | $80/mo | | €74 |
| **SUBTOTAL** | | | **~€1,450 / mo** |

**With 30% safety margin:** **€1,900 / mo**.

**Cost ceiling I'd plan for: €1,500-2,000 / mo ongoing.**

**Decision point at Phase 3 entry:** if no monetization is in sight, consider:
- Skipping the deep historical backfill (just 2018+ instead of 2011+) → cuts storage 70%
- Patreon / Open Collective tier covering hosting → realistic at 200K MAU

---

## 6. Phase 4 — Public launch with monetization

### 6.1 Cost (1M MAU sustained)

| Service | Tier | Usage | Cost / mo |
|---------|------|-------|-----------|
| Vercel Pro | $20/seat × 2 + bandwidth (1 TB extra) | 1.1 TB bandwidth | €112 |
| Supabase Team | $599/mo | needed for read replicas + 1 TB egress | €555 |
| R2 storage hot | Paid | 20 TB | €280 |
| R2 ops | Paid | 50M Class A, 2B Class B | €750 |
| Backblaze B2 cold | Paid | 60 TB | €280 |
| Cloudflare Stream | Paid | 50K minutes delivered/mo (curated reels only) | €50 |
| Gemini paid annotation | Paid | 100K calls/day | €400 |
| Anthropic Haiku moderation | Paid | 50K comments/day | €250 |
| Hetzner cluster (3× CCX33) | Worker + API | | €180 |
| Algolia Grow | $500/mo | 1M records | €465 |
| Sentry Business × 3 users | $80/mo × 3 | | €223 |
| Honeycomb Pro | | | €120 |
| Upstash Redis | PAYG | larger usage | €40 |
| Resend | $20/mo + usage | 200K emails/mo | €40 |
| Cloudflare Pro plan | $20/mo | DDoS + analytics | €19 |
| Brightdata residential proxy | $500/mo (sustained for archive ingestion) | | €465 |
| Domain + WAF | annual + Cloudflare WAF | | €5 |
| Stripe (monetization, fees only) | 2.9% + €0.25/transaction | revenue-dependent | revenue scaling |
| **SUBTOTAL** | | | **~€4,230 / mo** |

**With 30% safety margin:** **€5,500 / mo**.

### 6.2 Revenue model (must cover cost)

Required revenue at Phase 4: **€10,000-15,000 / mo** (2-3× cost for sustainability + reinvestment).

| Stream | Realistic ARPM | Notes |
|--------|----------------|-------|
| Sponsored clips (4-8 placements / mo at €1500 avg) | €6K-12K | Requires Riot Partner Program approval |
| Pro tier (10K paying users at €4/mo) | €40K | 1% take rate of 1M MAU — aggressive but precedented (Strafe, Plays.tv historical) |
| Affiliate links (peripherals on player pages) | €1K-3K | Easy, low effort |
| Aggregated data API to broadcasters | €0-100K | Stretch, deal-by-deal |
| **Realistic year-1 mix** | **€15K-30K / mo** | Dominated by Pro tier |

**Breakeven analysis:** ~5K paying Pro users covers the €5.5K cost floor. That's 0.5% of 1M MAU. **Achievable if the product is loved.**

---

## 7. Cost ceiling per phase — summary table

| Phase | MAU | Real cost / mo | With 30% margin | Revenue needed |
|-------|-----|----------------|-----------------|----------------|
| 0 | 1K | €10 | €13 | €0 (operator absorbs) |
| 1 | 50K | €95 | €125 | €0 (operator absorbs) |
| 2 (optimized) | 200K | €540 | €700 | €0-€500 (Patreon helps) |
| 3 (post-backfill) | 200K | €1,450 | €1,900 | **€2K mandatory** |
| 4 | 1M+ | €4,230 | €5,500 | **€15K target (3× cost)** |

**Plus one-shot:** Phase 3 backfill = **€5,000-7,500**.

---

## 8. Monetization options (detailed)

### 8.1 Sponsored clips
- **Mechanic:** A sponsor pays to pin a curated KC vs G2 highlight at the top of the LEC scroll feed for 24h, with a "Sponsored by [brand]" overlay.
- **Constraints:** Must be Riot-approved categories (no gambling, no alcohol to under-18s, no competing esports brands).
- **Pricing benchmark:** TikTok in-feed sponsored content is €5-30 CPM. Esports niche commands premium → €15-50 CPM. At 200K daily impressions, a 24h pin = €3K-10K. Conservative €1500/clip.
- **Required:** Riot Partner Program approval. Apply at Phase 2 exit.

### 8.2 Freemium "LoLTok Pro" tier (€4/mo)
- **Benefits:** ad-free, 4K download, custom feed (block teams you hate), early access to new clips, priority push notifs.
- **Take rate:** 1-2% of MAU (industry benchmarks for casual mobile media: Spotify 46%, Strava 5%, our content is more niche → 1-2%).
- **Stripe fees:** ~3.2% blended (incl. EU SCA + chargebacks).
- **Implementation cost:** ~1 sprint of dev work + Stripe integration + invoicing.

### 8.3 Affiliate (low-effort baseline)
- Amazon associates (3-5% commission), Newegg, esports peripheral brands.
- Player pages: "Caliste plays with [X mouse]" → affiliate link.
- Realistic €1-5K/mo at Phase 4 scale.

### 8.4 Partnership / API access
- Sell aggregated kill metadata + embed widgets to LEC, Telecom Italia, etc.
- Highly variable. Requires contracts, lawyers. Not a Phase 4 launch dependency.

### 8.5 What NOT to do
- **No NFTs.** Reputation damage > revenue.
- **No crypto / tokens.** Same.
- **No "predict the kill" gambling.** Riot will revoke Jibber Jabber within 24h.
- **No paid pay-to-rate.** Destroys the Wilson score.
- **No selling user data.** Zero-knowledge promise from Day 1.

---

## 9. Breakeven scenarios

### 9.1 Conservative path (MUST be self-sustaining at Phase 4)
- Phases 0 + 1 absorbed by operator (~€2K total over 18 months)
- Phase 2 covered by Patreon (~€500-1K MRR from 100-200 power users at €5-10/mo) → realistic
- Phase 3 backfill funded by **community crowdfund** (Kickstarter / Patreon push) → €5K target
- Phase 4 launches with Pro tier + 1-2 sponsored clips/mo → breakeven within 3 months

### 9.2 Aggressive path (raise capital)
- Find a small angel (€20-50K seed) at Phase 1 exit
- Hire 1 part-time community manager + 1 part-time dev contractor
- Push to Phase 4 in 18 months instead of 36
- Higher risk, higher ceiling — only viable if EtoStark explicitly endorses growth

### 9.3 Hobbyist path (Mehdi keeps it as a side project forever)
- Stay at Phase 1 (multi-team Europe, no global)
- Cost stays at ~€100/mo, operator absorbs
- 50K MAU, Discord community, niche but loved
- **Totally valid outcome.** Zero shame.

---

## 10. Cost monitoring (operational)

### 10.1 Hard caps to set NOW

| Service | Alert at | Hard cap |
|---------|----------|----------|
| Vercel | $10 bandwidth overage | $50/mo |
| Supabase | 4 GB egress | upgrade to Pro |
| R2 | 8 GB storage | upgrade — not a real cost issue, but a heads-up |
| Gemini | 800 RPD | rate limit hard, queue rest for next day |
| Anthropic | $10/mo | rate limit moderation, defer to Phase N+1 |

### 10.2 Discord webhook nightly cost report

The worker already has a watchdog. Add a daily cost summary to the Discord channel:
- Yesterday's R2 ops + GB
- Yesterday's Gemini quota usage
- Yesterday's Anthropic spend
- Estimated month-to-date total

Implementation: ~50 lines in `worker/modules/watchdog.py`. Schedule for Phase 1.

---

## 11. What this document does NOT cover

- **Tax / VAT considerations** when monetization starts → consult an accountant
- **Hosting costs for analytics** → Umami self-hosted on the same Hetzner box, ~€0 incremental
- **Legal fees** for Riot Partner Program application → estimate €500-2K one-shot
- **Customer support tooling** (e.g. Intercom, Zendesk) → defer to Phase 4

**Last revision:** 2026-04-25 (initial draft, Wave 10)
