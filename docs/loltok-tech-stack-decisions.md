# LoLTok — Tech Stack Decisions

**Author:** Agent CA (Wave 10 swarm)
**Date:** 2026-04-25
**Format:** ADR-lite — for each decision, the question, the alternatives I weighed, the recommendation, the why, and the trigger to revisit
**Audience:** Mehdi, deciding what to use and when to migrate

> **Reading guide:** Each section is independently consumable. Skip to whatever decision matters today. The "Migration trigger" line tells you when to revisit each decision.

---

## 1. Worker compute — where does the daemon live?

**Question:** Today the worker runs on Mehdi's PC. When and where do we move it?

**Alternatives:**

| Option | Cost / mo | Pros | Cons |
|--------|-----------|------|------|
| **Mehdi's PC (current)** | €5 (electricity) | Free, full control, Firefox-cookies for YouTube ingestion work natively | SPOF, dies if Mehdi reboots, no Linux ecosystem |
| **Hetzner CCX13** (2 vCPU, 8 GB) | €15 | Excellent €/CPU, EU-based, reliable, 20 TB egress free | Linux only — need to port the Firefox cookie mode |
| **Hetzner CCX23** (4 vCPU, 16 GB) | €30 | Same as above + parallelism | Same |
| **Fly.io shared-cpu-1x** | €15 + bandwidth | Per-app deploys, easy rollouts | More expensive at scale, ephemeral storage = need to re-architect cache |
| **Railway** | €25-50 | One-click deploys, Postgres bundled | 3-5× more expensive than Hetzner |
| **Render Web Service** | €7 always-on + workers | Decent UX | Same — too expensive vs Hetzner |
| **AWS EC2 t3.medium** | €30-40 | Industry standard | Egress costs nontrivial, complex billing |
| **Kubernetes** (anywhere) | EKS €68/mo control plane minimum + nodes | Industry standard | Massive complexity tax for one daemon. **NO.** |

**Recommendation: Hetzner CCX13 at Phase 1 exit, upgrade to CCX23 at Phase 2 entry.**

**Why:**
- 3-5× cheaper than Fly/Railway/Render at equivalent specs
- EU-based (matches our user base + GDPR jurisdiction)
- Real KVM virtualization — no shared-tenancy throttling like Fly's shared-CPU
- Mature, has been around a decade, won't pivot like cloud darlings do

**Migration trigger:** When the PC goes down twice in 30 days, OR when EtoStark publicly recommends the site (sudden viral spike risk), OR Phase 2 entry.

**Migration cost:** ~1 day of work. Dockerize the worker (already 80% done — `worker/Dockerfile` exists), copy `.env` + SQLite cache, spin up Hetzner box, swap DNS for the dashboard. **PC stays as warm spare** — keep ingesting in dual-mode for 1 week.

**YouTube cookies caveat (CRITICAL):** The Firefox profile mode (PR `10bbe6f`) won't work headlessly on a Hetzner box. Two paths:
1. **Headless Firefox + manual cookie injection weekly** — fragile, breaks every Firefox update
2. **Residential proxy (Brightdata/Oxylabs)** — proper, €100-500/mo, scales to Phase 3
**Decision:** Headless Firefox at Phase 1 (annoying but free), residential proxy at Phase 2 (mandatory).

---

## 2. Postgres scaling — when does Supabase Free die?

**Question:** Free tier is 500 MB DB, 5 GB egress, 7-day inactivity pause. When do we upgrade and to what?

**Alternatives:**

| Option | Cost / mo | DB | Egress | Notes |
|--------|-----------|-----|--------|-------|
| **Supabase Free** | €0 | 500 MB | 5 GB | Pauses after 7d inactivity (worker heartbeat handles this) |
| **Supabase Pro** | €23 | 8 GB | 250 GB | PITR 7d, no pause, daily backups |
| **Supabase Team** | €555 | 100 GB | 1 TB | PITR 14d, read replicas, 99.9% SLA |
| **Neon Pro** | €25 | 10 GB compute, branching | 50 GB | Postgres-native branching is a killer feature for QA |
| **Neon Scale** | €130+ | 100 GB | 200 GB | More expensive than Supabase Pro |
| **AWS RDS db.t4g.medium** | ~€50 | flex storage €10/100GB | egress €90/TB outbound | DIY, no Auth, no RLS UI, no Realtime |
| **Aurora Serverless v2** | €40-€500 (wild range) | Auto-scales | egress €90/TB | Power without overhead, pricing scary |

**Recommendation: Supabase Free → Supabase Pro at Phase 1 entry → stay on Pro through Phase 2 with R2-baked feed JSON optimization → Supabase Team at Phase 3 entry.**

**Why:**
- We get Auth + RLS + Realtime + Storage + nice UI for one €23 bill
- Migrating off Supabase later is non-trivial (RLS policies are PG, but Auth users need export). Don't do it unless forced.
- The R2-baked feed JSON pattern (worker writes feed JSON to R2 every 30s, frontend reads from R2) lets us postpone the Team plan jump (€555/mo!) until Phase 3
- Neon's branching is cool but we don't have enough engineers to benefit yet
- Aurora is great at FAANG scale, overkill until Phase 4

**Migration trigger to Pro:** When DB > 400 MB (alarm at 80%), OR when egress > 4 GB/mo, OR when we add team-2.

**Migration trigger to Team:** When read replicas become necessary (Asia/US users complain about latency), OR DB > 80 GB, OR when we need PITR > 7 days for compliance.

**Migration cost (Free → Pro):** Click a button. €0 incremental work.
**Migration cost (Pro → Team):** €0 work. The cost IS the cost.
**Migration cost (off Supabase):** ~2 weeks of work + re-implementing Auth + RLS testing.

---

## 3. Storage — R2, then R2 paid, then R2 + cold tier

**Question:** R2 free tier is 10 GB. We'll blow that in Phase 1. Then what?

**Alternatives at scale:**

| Option | Storage cost / TB / mo | Egress | Operations | Notes |
|--------|------------------------|--------|------------|-------|
| **R2 free** | €0 (10 GB cap) | €0 | 1M Class A free | Today |
| **R2 paid** | €14 | €0 | €4.20 / M Class A, €0.34 / M Class B | Phase 1+ |
| **Backblaze B2** | €4.65 | €0 via Cloudflare Bandwidth Alliance | $0.004/1K Class A, $0.004/10K Class B | Cold tier candidate |
| **Wasabi** | €5.60 flat (90-day min) | €0 | None | Wasabi has 90-day min retention — bad for our retention pattern |
| **AWS S3 Standard** | €21 | €84 / TB | Cheap | Egress will eat us |
| **AWS S3 Glacier Deep** | €1 | €11 retrieval + 12h delay | Cheap | Useless for video on demand |
| **GCS Coldline** | €4 | €11/TB egress | Cheap | Egress kills us |

**Recommendation:**
- **Phase 0-2: R2 paid only.** It's the obvious choice — zero egress is the moat.
- **Phase 3+: R2 hot tier (recent + popular) + Backblaze B2 cold tier (clips > 2 years old, low play count).** Cloudflare Bandwidth Alliance gives B2 → CF free egress, so we keep our cost story.

**Keys layout migration:**

Current keys (Phase 0):
```
clips/{kill_id}_h.mp4
clips/{kill_id}_v.mp4
clips/{kill_id}_v_low.mp4
thumbs/{kill_id}.jpg
og/{kill_id}.png
```

Multi-team keys (Phase 1, Wave 10 introduces this):
```
{league}/{year}/{team}/{kill_id}_h.mp4
e.g. lec/2026/karmine-corp/abc123_h.mp4
```

This change is **forward-only**: existing keys are migrated by a one-shot script that creates aliases (R2 doesn't have native folder rename). New keys go to the new layout. Worker reads via storage abstraction layer (Wave 10 also introduces this).

**Phase 3 cold tier migration:**
```
{league}/{year}/{team}/{kill_id}_*.mp4
   ↓ (after 24 months, low view count)
b2://archive/{league}/{year}/{team}/{kill_id}_*.mp4
```

The frontend doesn't care — it gets a signed URL or a Cloudflare Worker route that decides hot vs cold. Hot tier serves directly, cold tier serves via a Cloudflare Worker that proxies B2 (still free egress).

**Migration trigger to paid R2:** Phase 1 entry (instant).
**Migration trigger to cold tier:** Phase 3 backfill complete (60+ TB total storage).

---

## 4. Search — FTS, then pgvector, then Algolia

**Question:** Today we use Postgres `tsvector` with French dictionary. When does it stop scaling?

**Alternatives:**

| Option | Cost | Capabilities | Scale ceiling |
|--------|------|--------------|---------------|
| **Postgres FTS** (today) | €0 (in Supabase) | Token-based, multi-language, ranking | ~100K rows hot, ~1M cold |
| **pgvector + embeddings** | €0 in Supabase + €0.02/M tokens for OpenAI ada-3 embeddings | Semantic — "outplays Yike" finds clips with similar vibe | Same 1M ceiling; semantic ≠ fast |
| **Algolia Build** | €47/mo (50K records, 1M ops) | Typo-tolerant, instant search, faceting | 1M+ records easy |
| **Algolia Grow** | €465/mo (1M records) | Same | Phase 4 |
| **Meilisearch self-hosted** | €15/mo (Hetzner CX21) | Algolia-like, simpler | Self-hosted ops burden |
| **Typesense Cloud** | €25/mo entry | Algolia-like | Same |
| **Elasticsearch** | €100+/mo (Bonsai etc.) | Power-user, complex | Overkill |

**Recommendation:**
- **Phase 0-1: Postgres FTS only.** It works. Free.
- **Phase 2: Add pgvector embeddings (cheap upgrade, €5-10/mo in OpenAI ada calls) for semantic discovery.** Use FTS for keyword, pgvector for "find similar plays".
- **Phase 2 late / Phase 3: Algolia Build (€47).** Once we cross 100K kills, FTS faceting gets slow. Algolia is the boring, correct answer.
- **Phase 4: Algolia Grow (€465) only if Build's 50K-record cap binds.** Probably it does — 1M+ kills.

**Self-hosted Meilisearch is tempting but the ops burden adds up.** Pay Algolia, sleep at night.

**Migration trigger to pgvector:** When users start asking for "find similar clips" feature.
**Migration trigger to Algolia:** When `EXPLAIN ANALYZE` of a typical search > 200ms p95.

**Migration cost (FTS → Algolia):** ~3 days of work. Worker indexes new kills in Algolia + Postgres in parallel for 1 month, then frontend swaps over.

---

## 5. Video CDN — R2 + native HLS vs Cloudflare Stream

**Question:** Today we serve MP4 directly from R2 with `movflags +faststart`. When (if ever) do we move to a video-aware CDN?

**Alternatives:**

| Option | Cost | Capabilities | Notes |
|--------|------|--------------|-------|
| **R2 + MP4 direct** (today) | €0 egress | Plays everywhere, simple | No adaptive bitrate, fixed quality |
| **R2 + ffmpeg-generated HLS** | €0 egress + worker compute | Adaptive bitrate via HLS playlist | Worker pre-encodes 3 renditions, CDN serves segments |
| **Cloudflare Stream** | $5 / 1000 minutes stored / mo + $1 / 1000 minutes delivered | Auto-transcoding, adaptive HLS, signed URLs, analytics | Mature but pricey at scale |
| **Mux** | $0.0096 / minute viewed + storage | Best DX | $$$$ |
| **AWS MediaConvert + CloudFront** | per-job + CDN | DIY MediaConvert | Egress kills |

**Recommendation:**
- **Phase 0-1: R2 + MP4 direct.** It works. The triple format (H/V/V_low) covers our needs. Frontend chooses quality based on `navigator.connection`.
- **Phase 2: R2 + ffmpeg-generated HLS for top 10% most-played clips.** Worker pre-encodes the HLS for clips with > 1K plays. The other 90% stay as MP4. Cost: worker compute, no extra CDN cost.
- **Phase 3-4: Cloudflare Stream for curated reels and live-event highlights.** When broadcast partners want signed URLs + analytics, Stream is justified.

**Cloudflare Stream break-even math:**
- 50K minutes delivered / mo at Stream = $50/mo + storage
- Same 50K minutes from R2 = $0 (free egress)
- **R2 wins on cost forever.** Stream wins on features (analytics, signed URLs, transcoding ops cost).

**Decision:** Pay for Stream only when we need signed URLs (Phase 4 monetization) or when the worker-side HLS encoding becomes a bottleneck.

---

## 6. AI providers — multi-provider router from Phase 2

**Question:** Today we use Gemini 2.5 Flash-Lite (free tier, 1000 RPD). What's the long-term plan?

### 6.1 Why NOT abuse free tiers across multiple Google accounts

Some "growth hackers" recommend creating N Google accounts for N × 1000 RPD free quota. **Do not do this.**

1. **Google ToS prohibits it.** "You may not create multiple accounts to circumvent quotas." Section 4.2.
2. **Ban risk is total.** Google can ban not just the API access but your entire Workspace account, your YouTube history, your Gmail. The blast radius is everything Google.
3. **No SLA on free tier.** When (not if) Gemini free tier gets stricter abuse detection (IP fingerprinting, billing-account fingerprinting), our pipeline silently dies.
4. **Public product = compliance liability.** When EtoStark recommends LoLTok and the press writes about us, we cannot be caught circumventing Google ToS. That's Hacker News drama bait.
5. **The math is bad anyway.** 1.2M kills × 5 (free accounts) = 240 days to crunch. Paid Gemini does it in 3 weeks for €360. Not worth the risk.

**Conclusion:** Free tier is for the pilot. Paid tier or multi-provider router is the legitimate path.

### 6.2 Multi-provider router design

| Provider | Strength | Cost / M input tokens | Use case |
|----------|----------|------------------------|----------|
| **Gemini 2.5 Flash-Lite paid** | Cheap, multimodal video input | €0.10 input / €0.40 output | Primary annotation |
| **Anthropic Haiku 4.5** | Strong text reasoning, low cost | €1 / €5 | Moderation (already in use) + fallback annotation |
| **OpenAI gpt-4o-mini** | Good quality, low cost | €0.14 / €0.56 | Backup when Gemini rate-limits |
| **Cerebras (Llama burst)** | Insane throughput (1500+ TPS) | €0.10 (similar to Gemini) | Backfill burst — when we need 100K calls in a day |
| **Self-hosted Ollama (Llama 3.3)** | Free | Hetzner CCX33 €60/mo | Fallback if all paid providers down |

### 6.3 Router architecture

```python
# worker/services/ai_router.py
class AIRouter:
    def __init__(self):
        self.providers = [
            GeminiProvider(quota=1000_000, priority=1),  # paid tier, cheapest
            OpenAIProvider(quota=500_000, priority=2),    # backup
            AnthropicProvider(quota=200_000, priority=3), # last resort, expensive
        ]

    async def annotate_clip(self, clip):
        for provider in self.providers:
            if provider.has_quota_for(clip):
                try:
                    return await provider.annotate(clip)
                except RateLimitError:
                    continue
                except ProviderError as e:
                    log_and_alert(e)
                    continue
        raise NoProviderAvailable()
```

**Recommendation:**
- **Phase 0-1: Gemini Flash-Lite free + Anthropic Haiku paid for moderation only.** No router needed.
- **Phase 2: Build multi-provider router.** Primary = Gemini paid, fallback = OpenAI gpt-4o-mini, last resort = Anthropic Haiku.
- **Phase 3 backfill: Add Cerebras for burst throughput.** Bills are €100-200 over 3 months for the burst, justifies it.
- **Phase 4: Same as Phase 3 + cache annotations forever (never re-call).**

**Cache key:** `hash(clip_url + prompt_version)`. If prompt changes, all clips get re-annotated. Otherwise we use the cached JSON forever.

---

## 7. Observability — Discord, then Sentry, then Honeycomb

**Question:** Today we use Discord webhooks + structlog. When do we need real observability?

**Alternatives:**

| Option | Cost | Capabilities | Notes |
|--------|------|--------------|-------|
| **Discord webhook** (today) | €0 | Per-event alerts, daily digest | No search, no aggregation |
| **Sentry Free** | €0 (5K errors/mo) | Frontend errors, perf, release tracking | Phase 1 |
| **Sentry Team** | €25/mo per user (50K errors) | + advanced perf, alerts | Phase 2 |
| **Honeycomb Free** | €0 (20M events/mo) | Trace-based observability, BubbleUp | Phase 3 |
| **Honeycomb Pro** | €120/mo (1.5B events) | + retention | Phase 3+ |
| **Datadog** | $15/host/mo + per-feature | All-in-one | Pricey, not for solo founders |
| **Grafana Cloud free** | 10K series, 50 GB logs/mo | Self-managed feel | Decent free tier |
| **Logflare / BetterStack** | $25-50/mo | Log aggregation only | Decent for the price |

**Recommendation:**
- **Phase 0: Discord + structlog (current).** Works.
- **Phase 1: + Sentry Free.** Zero-config Next.js integration, 5 min to set up. Catches frontend errors we'd miss otherwise.
- **Phase 2: + Sentry Team (€25/user).** When error volume crosses 5K/mo, the free tier becomes useless.
- **Phase 3: + Honeycomb Pro (€120) + OpenTelemetry instrumentation in worker.** When we have 3+ Hetzner boxes and need distributed tracing.
- **Phase 4: + Grafana Cloud or Datadog (one of them) for infra metrics.** When uptime SLA matters.

**Migration trigger:**
- Sentry: when a frontend bug burns Mehdi for an evening
- Honeycomb: when "what's slow" becomes harder than `EXPLAIN ANALYZE`
- Datadog/Grafana: when ops gets a real budget

---

## 8. Backups — pg_dump now, PITR later

**Question:** Supabase Free has zero backups. What's the safety net?

**Alternatives:**

| Option | Cost | Recovery point | Recovery time | Notes |
|--------|------|----------------|---------------|-------|
| **`pg_dump` cron to R2** (today) | €0 | 24h (daily) | Manual restore, ~30 min | Free, low effort |
| **Supabase Pro PITR (7d)** | €23/mo | 1 second | Point-in-time, ~5 min | Phase 1+ |
| **Supabase Team PITR (14d)** | €555/mo | 1 second | Point-in-time | Phase 3+ |
| **Logical replication to standby** | €30/mo (extra Hetzner box) | Real-time | Promote standby, ~2 min | Power user, complex |

**Recommendation:**
- **Phase 0: `pg_dump` weekly to R2 + monthly to a USB stick at Mehdi's place** (3-2-1 backup rule).
- **Phase 1: Migrate to Supabase Pro PITR (free with the €23 plan).** Keep `pg_dump` weekly as additional safety.
- **Phase 3: Supabase Team for 14d PITR + read replicas.**

**Migration trigger:** Phase 1 entry (instant — included in Pro).

**Disaster recovery doc:** `docs/loltok-migration-runbook.md` § 8 (yet to write — see other doc).

---

## 9. i18n — homemade `t()` now, next-intl later

**Question:** Today we have FR strings hardcoded in JSX. When do we need real i18n?

**Alternatives:**

| Option | Cost | DX | Bundle | Notes |
|--------|------|-----|--------|-------|
| **Hardcoded FR** (today) | €0 | Zero | Zero | Phase 0 |
| **Custom `t()` helper** | €0 | Decent for 2-3 languages | <2 KB | Phase 1 (FR + EN) |
| **next-intl** | €0 | Battle-tested, ICU MessageFormat | ~15 KB gzipped | Phase 2 (>3 languages) |
| **react-i18next** | €0 | Mature but verbose | ~25 KB gzipped | Older, heavier |
| **lingui** | €0 | Compile-time extraction | ~10 KB | Niche but elegant |

**Recommendation:**
- **Phase 0: Hardcoded FR.** Don't optimize for non-existent users.
- **Phase 1: Custom `t()` helper with FR + EN JSON files.** ~50 LoC. Routes namespaced by `/fr/scroll` vs `/en/scroll`. Acceptable until 3 languages.
- **Phase 2: next-intl.** When KO + ZH come in, we need ICU plural support, RTL handling (none here, but still), and the next-intl ecosystem.

**Migration trigger:** When we add the 3rd language (KO).

**Migration cost (custom → next-intl):** ~3-5 days of work. Mostly mechanical: convert `t('foo')` calls to `useTranslations('namespace').foo`. The strings stay in JSON.

---

## 10. Auth — Discord only now, multi-provider later

**Question:** Today we have Discord OAuth + Riot OAuth (optional). When do we need more providers?

**Alternatives:**

| Provider | Phase | Why |
|----------|-------|-----|
| **Discord** (today) | P0 | KC fanbase fit, free, 5 min Supabase Auth setup |
| **Riot** (today, optional) | P0 | Incentive for users to link rank + champions to profile |
| **Google** | P2 | When we go global, KO/JA/ZH users may not have Discord |
| **Apple** | P2 | iOS App Store requires Apple Sign-In if any other 3rd-party SSO |
| **Twitch** | P2 | Esports natural fit, 30M+ MAU among esports viewers |
| **Email magic link** | P3 | Power-user fallback (people who refuse SSO entirely) |
| **Passkeys** | P4 | Cool, future-proof, Mehdi's preference |

**Recommendation:**
- **Phase 0-1: Discord + Riot (current).** No change.
- **Phase 2: Add Google + Apple + Twitch.** Apple becomes mandatory if we ever ship a native iOS app (PWA only delays this).
- **Phase 3: Email magic link (Resend) for power users.**
- **Phase 4: Passkeys for the win.**

**Implementation cost (each provider):** ~1 day in Supabase Auth. Trivial.

**Account merging:** Phase 2 must support "I logged in with Discord, then later with Twitch — merge my profile". Supabase Auth has `linkIdentity()` since 2024. Use it.

---

## 11. Top 5 most important decisions (TL;DR)

If Mehdi reads only one section:

1. **Worker → Hetzner CCX13 at Phase 1 exit (€15/mo).** PC stays as warm spare. Mandatory before traffic spikes.
2. **R2-baked feed JSON pattern at Phase 1 → 2 transition.** Worker writes pre-rendered feed JSON to R2 every 30s. Frontend reads from R2 (free egress) instead of Supabase (€555/mo Team plan otherwise). Saves ~€500/mo at Phase 2.
3. **Multi-provider AI router at Phase 2 entry.** Gemini paid + OpenAI mini + Anthropic Haiku. Cache annotations forever. Avoids single-vendor death (Gemini 2.0 already died once).
4. **Residential proxy (Brightdata) at Phase 2 entry (€500/mo).** YouTube cookie ingestion is fragile. Pay for proper infra before EtoStark goes viral and we get IP-banned.
5. **Algolia Build at Phase 2 (€47/mo).** Postgres FTS dies past 100K rows. Algolia is the boring correct answer. Don't self-host Meilisearch unless you want to be on call for it.

---

## 12. Decisions deferred / not yet ripe

- **GraphQL vs REST API for Phase 4 partner integrations.** Defer to Phase 3.
- **Native mobile app (React Native / Flutter / native).** PWA carries us to Phase 3 minimum. Decide based on retention numbers.
- **CDN choice for non-Cloudflare regions.** Cloudflare has good Asia presence. Defer.
- **Self-hosted analytics.** Umami on the same Hetzner box at Phase 1, no incremental cost.
- **CI/CD platform.** GitHub Actions free tier is fine through Phase 3. Don't optimize.

---

**Last revision:** 2026-04-25 (initial draft, Wave 10)
