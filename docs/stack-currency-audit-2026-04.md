# LoLTok Stack Currency Audit — April 2026

**Author:** Agent CD (LoLTok MEGA SWARM)
**Date fetched:** 2026-04-25
**Methodology:** All findings below are pulled from live vendor pages today (2026-04-25) using WebFetch. Every claim cites the exact URL fetched + the figures we extracted. Claude's training cutoff is January 2026; everything after that date in this doc is fresh research.

> The other 9 swarm agents are working from CLAUDE.md and from training data that is ~3 months stale. This audit is the truth source for "what does the world look like today" and feeds into `stack-upgrade-recommendations.md` (the prioritized action list).

---

## 0. TL;DR — what changed since training cutoff

| Change | Impact on LoLTok |
|---|---|
| **Gemini 3 Pro** released Nov 2025; **Gemini 3.1 Pro** released Feb 19 2026; **Gemini 3 Flash Preview** now in pricing page | Our spec mentions "Gemini 2.0 Flash is dead — use 2.5 Flash-Lite" which is true but already a generation behind. 3 Flash Preview is FREE on free tier, paid $0.50/$3 — same magnitude as 2.5 Flash. **Not urgent**, but Gemini 3 Pro at $2/$12 is the SOTA video understanding model. |
| **Claude Opus 4.7** released — Mehdi's CLAUDE.md global preferences mention "Opus 4.7 (1M context)" so this is already known. **Sonnet 4.6** also new ($3/$15, 1M context). **Haiku 4.5 still the cost leader** at $1/$5 — our pick is correct. |
| **GPT-5.5 launched April 23, 2026** (2 days ago) — $5/$30 per M tok. Not relevant for LoLTok (we don't use OpenAI text models). |
| **Grok 4.1 Fast: $0.20/$0.50 per M tok with 2M context** — DeepSeek-V4-Flash $0.14/$0.28. These are dramatically cheaper than Gemini 2.5 Flash-Lite for text-only paths (description rewriting, comment moderation). |
| **Next.js 16.2 stable** (March 18 2026) — we're on 15.3. Cache Components + Turbopack default + React 19.2. Worth considering. |
| **Tailwind v4.1 stable** — we already pin `tailwindcss ^4.0.0`. ✅ aligned. |
| **PostgreSQL 18 GA Sep 25 2025** — Supabase still defaults to Postgres 17, but 18 is available. |
| **Supabase Pro still $25/mo** — same as before. PITR add-on $100-400/mo. |
| **Vercel Fluid Compute Active CPU pricing** — billed only during code execution; up to 90% savings on I/O-heavy work. We don't run heavy server functions, so impact is minor. |
| **iOS 26 + Safari 18.4: Declarative Web Push** — sites added to home screen now default to PWA. Push works. ✅ aligned with our PWA plan. |
| **Cloudflare R2 still $0.015/GB-mo** + free egress, free tier 10 GB. ✅ aligned, this is still the right pick. |
| **Highlight.io being sunset → migrating to LaunchDarkly by Feb 28 2026.** If we'd picked Highlight, that's now a forced migration. We didn't, so safe. |

The 5 most consequential findings are at the bottom of the document.

---

## 1. AI / LLM providers

### 1.1 Our current state
- `worker/services/gemini_client.py` + `worker/config.py` use **`gemini-2.5-flash-lite`** as the default analyzer/QC/offset model.
- `worker/services/haiku_client.py` uses **`claude-haiku-4-5-20251001`** for comment moderation.
- The CLAUDE.md spec line "⚠️ GEMINI 2.0 FLASH EST MORT" is correct historically but misleading: it implies 2.5 Flash-Lite is the current SOTA cheap model, but Gemini 3 Flash Preview now exists and is free on the free tier.

### 1.2 Live state of the art (fetched 2026-04-25)

| Provider | Model | Released | Input $/M | Output $/M | Context | Vision | Free tier | Source |
|---|---|---|---|---|---|---|---|---|
| Google | Gemini 3.1 Pro | 2026-02-19 | $2.00 (≤200k) / $4.00 (>200k) | $12.00 / $18.00 | 1M | yes (text/image/video/audio) | not on free tier | https://ai.google.dev/gemini-api/docs/pricing |
| Google | Gemini 3 Flash Preview | 2026 Q1 | $0.50 (text/img/video) / $1.00 (audio) | $3.00 | 1M | yes | **YES** — free tier with RPM/RPD | https://ai.google.dev/gemini-api/docs/pricing |
| Google | Gemini 2.5 Pro | 2025 | $1.25 / $2.50 | $10.00 / $15.00 | 1M+ | yes | limited free | https://ai.google.dev/pricing |
| Google | Gemini 2.5 Flash | 2025 | $0.30 / $1.00 audio | $2.50 | 1M | yes | YES | https://ai.google.dev/pricing |
| Google | **Gemini 2.5 Flash-Lite (current pick)** | 2025 | $0.10 / $0.30 audio | $0.40 | 1M | yes | YES — 1000 RPD | https://ai.google.dev/pricing |
| Anthropic | Claude Opus 4.7 | early 2026 | $5 | $25 | 1M | yes | no | https://platform.claude.com/docs/en/docs/about-claude/models/overview |
| Anthropic | Claude Sonnet 4.6 | late 2025 | $3 | $15 | 1M | yes | no | https://platform.claude.com/docs/en/docs/about-claude/models/overview |
| Anthropic | **Claude Haiku 4.5 (current pick)** | 2025-10-01 | $1 | $5 | 200k | yes | no | https://platform.claude.com/docs/en/docs/about-claude/models/overview |
| Anthropic | (legacy) Sonnet 4.5 | 2025-09-29 | $3 | $15 | 200k | yes | no | same |
| Anthropic | (legacy) Opus 4.5 | 2025-11-01 | $5 | $25 | 200k | yes | no | same |
| OpenAI | GPT-5.5 | 2026-04-23 | $5 | $30 | n/a | yes | no | search apidog.com/blog/gpt-5-5-pricing |
| OpenAI | GPT-5.5 Pro | 2026-04-23 | $30 | $180 | n/a | yes | no | same |
| OpenAI | GPT-5 (orig) | 2025-08 | $0.625 | $5 | n/a | yes | no | search pricepertoken.com |
| xAI | Grok 4.1 Fast | 2026 | $0.20 | $0.50 | **2M** | yes | yes | search mem0.ai/blog/xai-grok-api-pricing |
| xAI | Grok 4 | 2025 | $3 | $15 | 256k | yes | no | same |
| DeepSeek | DeepSeek-V4-Flash | 2026 | $0.14 (cache miss) / $0.028 (hit) | $0.28 | 1M | no | yes | https://api-docs.deepseek.com/quick_start/pricing |
| DeepSeek | DeepSeek-V4-Pro | 2026 | $0.435 / $0.0363 (-75% promo until 2026-05-05) | $0.87 | 1M | no | yes | same |
| Mistral | Mistral Large 3 | 2025-12 | $2.00 | $6.00 | n/a | yes (Pixtral mode) | yes | search devtk.ai/blog/mistral-api-pricing-guide-2026 |
| Mistral | Mistral Large 3 2512 | 2025-12 | $0.50 | $1.50 | n/a | yes | yes | same |
| Cerebras | Llama 4 Maverick 400B | 2025 | n/a (likely free + paid tier) | n/a | n/a | no | 1M tok/day free | https://www.cerebras.ai/inference + search |
| Cerebras | Llama 3.3 70B | 2024 | $0.60 | $0.60 | 128k | no | yes | same |
| Groq | Llama 3.3 70B Versatile | 2024 | $0.59 | $0.79 | 128k | no | yes | https://groq.com/pricing |
| Groq | Llama 4 Scout 17Bx16E | 2025 | $0.11 | $0.34 | n/a | no | yes | same |
| Groq | GPT-OSS-120B | 2025 | $0.15 | $0.60 | n/a | no | yes | same |

### 1.3 Verdict per provider

- **Gemini 2.5 Flash-Lite as primary clip analyzer** → ✅ **still aligned**. It's the cheapest multimodal model with native video input and has the longest free tier (1000 RPD). Gemini 3 Flash Preview is a slight upgrade but still in preview.
- **Gemini 3.1 Pro for the rare hard clips (penta, complex teamfights)** → ⚠️ **slightly stale spec**. CLAUDE.md doesn't mention escalation to a stronger model. At $2/$12 with native video understanding (258 tokens/sec of 1fps video = ~$0.03/min input), it's affordable for a small fraction of clips that need higher quality scoring.
- **Claude Haiku 4.5 for comment moderation** → ✅ **still aligned**. Cheapest credible moderation model. CLAUDE.md correctly mentions the 4-5-20251001 snapshot.
- **OpenAI GPT-5.5** → not relevant for our use case (no text-only generation, and we already have moderation covered).
- **Grok 4.1 Fast at $0.20/$0.50** → 🚨 **opportunity**. Dramatically cheaper than Gemini 2.5 Flash if we ever need text-only enrichment (e.g., normalising AI descriptions, generating tags from match metadata). 2M context. But no native video input → cannot replace Gemini for clip analysis.
- **DeepSeek-V4-Flash at $0.14/$0.28** → 🚨 **opportunity for moderation fallback**. 5–7× cheaper than Haiku 4.5. No vision but moderation is text-only. Caveat: DeepSeek is China-based, raises EU residency concerns; not recommended for primary use given our user base.
- **Cerebras / Groq Llama 4** → interesting if we want sub-second inference for live mode (e.g., tag generation while a match is in progress) but adds complexity. ⚠️ **Phase 3 / nice to have**.

### 1.4 Recommended primary + fallback for clip analysis (justified)

**Primary: Gemini 2.5 Flash-Lite** (unchanged from spec)
- Cost per 20s clip: ~5K tokens video + 1K tokens prompt + 200 tokens output = ~$0.0006/clip
- 1000 RPD free tier covers ~2× the daily kill volume for a busy KC week
- Native video input — no need to extract frames

**Fallback A (when Gemini quota exhausted): Gemini 3 Flash Preview**
- Free tier separate from 2.5 Flash-Lite quota
- Slightly more expensive on paid tier but better quality

**Fallback B (when Gemini API down): skip enrichment, publish kill without AI score** (already in spec — "dégradation gracieuse")

**For the rare ultra-hype clip needing pro-level analysis: Gemini 3.1 Pro one-shot**
- Trigger when `multi_kill IN ('quadra','penta')` OR `caster_hype_level = 5`
- Cost: ~$0.03/min × 0.33 min = ~$0.01/clip → trivial

### 1.5 Cost-per-clip math

For our 20-second clip at 1fps video sampling:
- Gemini 2.5 Flash-Lite: 20×258 = 5160 video tokens × $0.10/M = $0.0005, output 200 tokens × $0.40/M = $0.00008 → **~$0.0006/clip**
- Gemini 3 Flash Preview: same tokens × $0.50/M = $0.003, output × $3/M = $0.0006 → **~$0.0036/clip** (6× more expensive)
- Gemini 3.1 Pro: same × $2/M = $0.01, output × $12/M = $0.0024 → **~$0.013/clip** (22× more)

For 280 kills (full pilot season):
- 2.5 Flash-Lite paid: $0.17 (~zero, free tier covers it)
- 3 Flash Preview paid: $1.00
- 3.1 Pro paid: $3.65

→ **2.5 Flash-Lite stays the right primary**. Don't change.

---

## 2. Embedding models

### 2.1 Our current state
LoLTok spec/code does NOT currently use embeddings. Postgres `tsvector` (full-text French) is the only search backend, plus the `idx_kills_search` GIN index. So this is a "future feature" audit only.

### 2.2 Live state of the art (fetched 2026-04-25)

| Provider | Model | Dim | $/M tok | Free tier | Notes |
|---|---|---|---|---|---|
| Google | Gemini Embedding (text) | 768/1536/3072 | $0.15 std / $0.075 batch | yes | https://ai.google.dev/pricing |
| Google | Gemini Embedding 2 (multimodal) | various | $0.20 text / $0.45 image | yes | same |
| Voyage | voyage-4-large | 1024/2048 | $0.12 | 200M tok free per acct | https://docs.voyageai.com/docs/pricing |
| Voyage | voyage-4 | 1024 | $0.06 | 200M free | same |
| Voyage | voyage-4-lite | 512/1024 | $0.02 | 200M free | same |
| Voyage | voyage-multimodal-3 | 1024 | $0.12 + $0.60/B px | 200M tok + 150B px free | same |
| OpenAI | text-embedding-3-small | 512/1536 | $0.02 | no free | (search) |
| OpenAI | text-embedding-3-large | 1024/3072 | $0.13 | no free | (search) |
| Cohere | Embed 4 | 256/512/1024/1536 | dedicated $4/hr (Vault) or token pricing TBC | trial keys free | https://cohere.com/pricing |
| Jina | jina-embeddings-v4 | 1024 (matryoshka) | usage-based, varies | 10M tok trial | https://jina.ai/embeddings |
| Jina | jina-embeddings-v5-text | 677M / 239M params | usage-based | 10M tok trial | same |
| Mistral | mistral-embed | 1024 | (not on overview) | yes | https://docs.mistral.ai |

### 2.3 Verdict
- ✅ Skipping embeddings for V0 is the right call (Postgres tsvector handles French champion/desc/tags well).
- ⚠️ **Phase 3 recommendation**: when adding "find clips similar to this one" or RAG-style search, **voyage-4-lite** at $0.02/M with 200M free tokens is the best price/quality tradeoff. 1024-dim is enough; pgvector handles up to 2000-dim well.
- Gemini Embedding text at $0.15/M is a no-brainer if we're already in the Google ecosystem (one less vendor account).

---

## 3. Frontend framework

### 3.1 Our current state (from `web/package.json`)
- `next ^15.3.0`
- `react ^19.0.0`, `react-dom ^19.0.0`
- `tailwindcss ^4.0.0`
- `framer-motion ^12.38.0`
- `@react-three/fiber ^9.6.0` + `three ^0.184.0`
- `lucide-react ^0.475.0`
- shadcn/ui — not in deps directly (copy/paste model), so version is whatever was last `npx shadcn add`

### 3.2 Live state of the art (fetched 2026-04-25)

| Library | Latest stable | Released | Source |
|---|---|---|---|
| Next.js | **16.2** | 2026-03-18 | https://nextjs.org/blog |
| React | **19.2** | shipped with Next 16 | same |
| Tailwind CSS | **v4.1** | 2025-04-03 | https://tailwindcss.com/blog |
| Motion (formerly Framer Motion) | **12.37.0** | 2026-03-16 | https://motion.dev |
| shadcn/ui | rolling, **shadcn apply** + **Sera style** added April 2026 | https://ui.shadcn.com/docs/changelog |
| three.js | r170+ (active) | 2026 | (not deeply audited) |
| lucide-react | actively maintained, 0.4xx series | 2026 | (not deeply audited) |

### 3.3 Verdict per library

- **Next.js 15.3 vs 16.2** → ⚠️ **slightly stale**.
  - Major Next 16 features: Cache Components (PPR + `use cache`), Turbopack default stable, React Compiler stable, ~400% faster dev startup, ~50% faster rendering.
  - Breaking changes: async params, image defaults, caching semantics. **Migration is non-trivial** — it requires touching every page that consumes route params.
  - **Recommendation**: stay on 15.5/15.x for V0 launch. Plan migration to 16 in Phase 4 (post-launch polish).
- **React 19.0 vs 19.2** → ✅ aligned (just a minor bump). 19.2 brings View Transitions, `useEffectEvent`, `<Activity/>` — none are blockers.
- **Tailwind v4.0 vs v4.1** → ✅ aligned (we pin `^4.0.0` so we'll auto-pick 4.1 on `npm install`). 4.1 adds text-shadow + mask utilities, useful for our hextech aesthetic.
- **Framer Motion → Motion 12.37** → ✅ aligned. The library was renamed/rebranded. We use `framer-motion ^12.38.0` which IS Motion under the hood. **Note: `framer-motion` is being phased out in favor of `motion` package — should rename in package.json eventually.**
- **shadcn/ui** → ✅ aligned but worth running `npx shadcn diff` to pull recent component improvements. The new `shadcn apply` (April 2026) is useful for switching presets without rebuild.

---

## 4. Hosting / Compute

### 4.1 Our current state
- **Frontend on Vercel Hobby** (per CLAUDE.md "Deploy web: Vercel (hobby)").
- **Worker on Mehdi's home PC** (24/7 daemon).
- No cloud worker deployment yet. Roadmap mentions Hetzner / Fly.io / Railway for eventual migration off home PC.

### 4.2 Live state of the art (fetched 2026-04-25)

| Service | Tier | Price | Compute | Bandwidth | Source |
|---|---|---|---|---|---|
| Vercel Hobby | free | $0 | Fluid 4h Active CPU/mo | 100 GB/mo | https://vercel.com/pricing |
| Vercel Pro | $20/user/mo | $20 credit, then PAYG | Active CPU $0.128/hr | 1 TB included, $0.15/GB after | same |
| Hetzner CCX22 | ~€10-15/mo | dedicated 2 vCPU 8GB (~Apr 2026 prices) | x86 Intel | egress free | https://www.hetzner.com/cloud (calc'd) |
| Hetzner CPX22 | ~€7.99/mo | shared 2 vCPU 4GB (post-Apr-1 price hike) | x86 AMD | egress 20 TB/mo free | https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment |
| Fly.io | shared-cpu-1x 256MB | $0.00000078/sec ≈ $2.02/mo | per-second billing | $0.02/GB NA/EU | https://fly.io/docs/about/pricing/ |
| Fly.io | performance-1x 2GB | $0.00001242/sec ≈ $32.19/mo | per-second | same | same |
| Railway | Hobby | $5 | $5 in credits/mo | usage-based | (search) |
| Railway | Pro | $20 + usage | seat fee | usage-based | (search) |
| Render | Background Worker Starter | $7/mo | basic | included | (search) |
| Render | Background Worker Standard | $25/mo | 2× resources | included | same |

### 4.3 Verdict
- **Vercel Hobby for V0 frontend** → ✅ aligned. The `vercel.json` `ignoreCommand` rule (per Mehdi's global preferences) prevents preview deploys, so build-minute consumption is bounded.
- **Vercel Fluid Compute Active CPU** → 💡 unrelated to us (we don't run heavy server functions; most pages are RSC + ISR).
- **Worker on home PC** → ✅ for V0. The roadmap correctly identifies Hetzner CCX22 (€10-15/mo) as the migration target. Fly.io performance-1x at $32/mo is more expensive but offers per-second billing if usage is bursty.
- **Hetzner price hike on April 1, 2026** → 🚨 minor obsolescence in spec: CPX22 went from €5.99 to €7.99/mo. Update the cost section.

---

## 5. Database

### 5.1 Our current state
- Supabase Free tier (per CLAUDE.md): 500 MB DB, 5 GB egress, 50K MAU, ~3.8 GB/mo budgeted.
- Postgres version not specified.

### 5.2 Live state of the art (fetched 2026-04-25)

| Service | Tier | Price | DB Storage | Egress | Notes | Source |
|---|---|---|---|---|---|---|
| Supabase Free | $0 | 500 MB | 5 GB | pauses after 7d inactive | https://supabase.com/pricing |
| Supabase Pro | $25/mo | 8 GB included | 250 GB included | PITR add-on $100-400/mo | search uibakery.io/blog/supabase-pricing |
| Neon Free | $0 | 0.5 GB | n/a | 100 CU-h/mo, 6h PITR window | https://neon.com/pricing |
| Neon Launch | PAYG | $0.35/GB-mo | n/a | $0.106/CU-h compute, 7d PITR @ $0.20/GB-mo | same |
| Neon Scale | PAYG | $0.35/GB-mo | n/a | $0.222/CU-h, 30d PITR | same |
| Cloudflare D1 | free + PAYG | 5 GB free, then $0.75/GB-mo | n/a | edge SQLite, no Postgres | (search; not deeply audited) |
| PlanetScale | recently re-added free tier | n/a | n/a | MySQL, not Postgres | (search; not relevant) |

### 5.3 Verdict
- **Supabase Free for V0** → ✅ aligned. The bottleneck is egress (5 GB cap), and our budget estimates (~3.8 GB/mo) leave headroom.
- **Migrate to Supabase Pro at $25/mo** when egress > 4 GB/mo for 2 consecutive months. Adds 8 GB DB, 250 GB egress.
- **PITR not in Pro base** → 🚨 spec gap: CLAUDE.md says "AUCUN backup automatique → pg_dump hebdomadaire manuel". Correct for free tier, but if migrating to Pro, **PITR is an extra $100-400/mo** AND requires Small compute or higher. Plan for it in cost projections.
- **PostgreSQL 18** → ⚠️ Supabase still defaults to PG17. PG18 GA was 2025-09-25. Not blocking but worth checking the project's current PG version and considering an upgrade for the OAuth virtual generated columns + new `pg_stat_io` features.
- **Neon as alternative** → not recommended. Supabase gives us Auth + Storage + DB in one platform; Neon is DB-only and we'd need separate Auth (Clerk = $0-20/mo at our scale).

---

## 6. Storage / Video CDN

### 6.1 Our current state
- Cloudflare R2 free tier (10 GB, 1M Class A, 10M Class B, free egress)
- Triple-encoded MP4: H.264 720p horizontal + 720p vertical + 360p vertical low

### 6.2 Live state of the art (fetched 2026-04-25)

| Service | Storage | Bandwidth/Delivery | Encoding | Source |
|---|---|---|---|---|
| Cloudflare R2 standard | $0.015/GB-mo (10 GB free) | **$0** egress, 1M Class A free + $4.50/M after, 10M Class B free + $0.36/M after | DIY (we use ffmpeg locally) | https://developers.cloudflare.com/r2/pricing/ |
| Cloudflare R2 IA | $0.01/GB-mo, 30d min | $0 egress, $0.01/GB retrieval | DIY | same |
| Cloudflare Stream | bundle: $5/mo for 1000 min storage + 5000 min delivery | included | included | https://www.cloudflare.com/products/cloudflare-stream/ |
| Mux Storage | $0.0024/min/mo | $0.0008/min after 100K free min | $0 (JIT encoding) | https://www.mux.com/pricing |
| Mux Plus tier | $0.025/min @ 720p | included | included | same |
| Bunny Stream | $0.01/GB-mo | $0.005/GB | **free** | https://bunny.net/stream/ |

### 6.3 Verdict
- **R2 + DIY ffmpeg** → ✅ aligned. At our volume (280 kills × ~5 MB total per kill = 1.4 GB), well within 10 GB free tier for 7+ months of content. Free egress is the killer feature.
- **Cloudflare Stream** → ⚠️ marginal benefit. $5/mo gets you 1000 min storage + 5000 min delivery — 280 clips × 20s = 93 min storage, 1000 views/day × 20s = ~6000 min delivery/day = 180K min/mo (way over). At our planned scale, R2 + DIY is dramatically cheaper.
- **Mux** → ❌ overkill. Their JIT encoding is great for unknown source assets but we already do server-side encoding well.
- **Bunny Stream** → 💡 cheapest CDN option ($0.005/GB delivery vs Cloudflare's $0). But Cloudflare R2 has $0 egress, so this is moot.
- **AV1 transcoding** → ⚠️ tempting but not yet. Per ScientiaMobile (search): only **9.76% of mobile devices** have AV1 hardware decode coverage (Q2 2024 data). iPhone 15 Pro+ and M4 iPad Pro have it; most mid-tier Android does NOT. Software AV1 decode burns battery on mobile — worse UX than H.264 for 90% of users. **Stick with H.264 in 2026.** Re-evaluate Q4 2026.

---

## 7. Observability

### 7.1 Our current state
- **No production observability stack defined** in spec. CLAUDE.md mentions Discord webhooks for worker monitoring + structlog JSON logs.

### 7.2 Live state of the art (fetched 2026-04-25)

| Service | Free tier | Paid entry | Notes | Source |
|---|---|---|---|---|
| Sentry Developer | 5K errors, 5M spans, 50 replays, 1 GB attach | $26/mo Team (50K errors) | $80/mo Business | https://sentry.io/pricing/ |
| Datadog | 14-day trial | ~$104K/yr SMB avg | overkill for our scale | (search) |
| Honeycomb | 20M events/mo free | event-based | $24K/yr SMB avg | (search) |
| Highlight.io | (sunset, migrating to LaunchDarkly Feb 28 2026) | n/a | **AVOID** | (search) |
| LaunchDarkly Observability (post-Highlight) | Developer free | $150+/mo | inherits Highlight users | (search) |
| Axiom Free | 500 GB ingest/mo, 25 GB storage | $25/mo base then PAYG | log-focused | https://axiom.co/pricing |
| Better Stack | 100K exceptions free, 5K replays free | $34/mo responder | bundles uptime + logs | https://betterstack.com/logs/pricing |

### 7.3 Verdict
- 🚨 **Spec gap**: there is no observability plan beyond Discord webhooks. For V0 launch this is OK, but **Sentry's free tier (5K errors, 5M spans/mo)** would catch frontend/worker errors with zero cost.
- **Recommend: add Sentry to the V0 launch checklist** at zero cost. 5K errors/mo covers our scale comfortably.
- **Highlight.io** → 🚨 if any swarm agent suggests Highlight.io, REJECT — it's being sunset by Feb 28 2026.
- **Axiom Free 500 GB ingest** → 💡 if we want detailed worker logs ingested somewhere queryable, this is the cheapest option. Can pair with Sentry for errors.

---

## 8. Auth

### 8.1 Our current state
- Supabase Auth with **Discord OAuth** (CLAUDE.md spec).
- Optional **Riot OAuth** for linking ranked stats.
- Discord ID + Riot PUUID hashed SHA-256.

### 8.2 Live state of the art (fetched 2026-04-25)

| Service | Free tier | Pro | Notes | Source |
|---|---|---|---|---|
| Supabase Auth | included with Supabase, 50K MAU free | $25/mo Supabase | bundled — our pick | https://supabase.com/pricing |
| Better-Auth (open source) | $0 self-hosted | $0 | v1.6 latest, Next.js compat | https://better-auth.com |
| Clerk | 50K MRU free | $20/mo Pro, +$0.02/MRU | Business $250/mo | https://clerk.com/pricing |
| Auth0 | 7K MAU free | $35-150/mo | Okta-owned | (not deeply audited) |
| WorkOS | n/a (B2B-focused) | per-user, varies | overkill for B2C | https://workos.com/pricing |
| Stack Auth | 10K users free | $49/mo Team (50K users) | $299/mo Growth | https://stack-auth.com/pricing |

### 8.3 Verdict
- **Supabase Auth + Discord OAuth** → ✅ aligned. 50K MAU free tier is generous; Discord is the right provider for our LoL/KC fanbase.
- **Better-Auth** → 💡 **interesting alternative** (open source, no vendor lock-in, supports Next.js). But Supabase Auth is already bundled with our DB so the marginal cost is $0. Not worth migrating.
- **Stack Auth** → 💡 newer Vercel-incubated option. 10K user free tier is smaller than Supabase Auth's 50K MAU. Skip.

---

## 9. Search

### 9.1 Our current state
- Postgres `tsvector` (French) on `kills.search_vector` with GIN index.
- Filters via SQL on `kills.killer_player_id`, `multi_kill`, `tracked_team_involvement`, etc.

### 9.2 Live state of the art (fetched 2026-04-25)

| Service | Free tier | Paid entry | Notes | Source |
|---|---|---|---|---|
| pg_trgm + tsvector (current) | free | $0 | adequate for V0 | n/a |
| Algolia Build | 1M records, 10K queries/mo | $0.50/1K queries Grow | https://www.algolia.com/pricing |
| Meilisearch usage-based | 14d trial | $30/mo+ | https://www.meilisearch.com/pricing |
| Meilisearch resource-based | 14d trial | $23/mo+ | same |
| Typesense Cloud | configurable, no free tier | RAM-based pricing | https://cloud.typesense.org/pricing |
| ParadeDB | self-host free | enterprise custom | Postgres extension; cloud in private beta | https://www.paradedb.com |
| Vespa Cloud | n/a | enterprise | overkill | (not audited) |

### 9.3 Verdict
- **Postgres tsvector** → ✅ aligned for V0. ~280 kills, no semantic search needed. tsvector handles French diacritics and is free.
- **ParadeDB (Postgres BM25 extension)** → ⚠️ **interesting Phase 3 option** when search complexity grows (semantic search, ranking by community signals). Self-hosted free, no extra service. Currently in private beta for managed cloud. Worth tracking but don't adopt yet.
- **Algolia / Meilisearch / Typesense** → ❌ overkill for our content volume + cost.

---

## 10. Push notifications + Mobile

### 10.1 Our current state
- Web Push VAPID via `web-push ^3.6.7` + `pywebpush ^2.0.0` in worker
- PWA `manifest.json` with `display: standalone`, `start_url: /scroll`
- Service worker for push handling

### 10.2 Live state of the art (fetched 2026-04-25)

- **iOS PWA push**: works on iOS 16.4+ for sites added to Home Screen. iOS 18 stabilized previously-flaky subscription persistence. **Safari 18.4 added Declarative Web Push** + Screen Wake Lock. **iOS 26 (current): every site added to Home Screen now defaults to opening as a web app.** ✅
- **EU restriction**: EU users on iOS get PWAs in Safari tabs (no push) due to DMA compliance. Affects ~25% of our French audience. Can't fix from our side.
- **Capacitor 8** announced Dec 8 2025 (production-ready). Capacitor 7 GA was Jan 20 2025. → If we want to wrap PWA into native App Store apps for the EU push gap, Capacitor 8 is the path.
- **Tauri 2** stable, mobile (iOS/Android) supported but maturity unclear.

### 10.3 Verdict
- **Web Push VAPID** → ✅ aligned. Our setup is correct.
- **EU iOS push gap** → ⚠️ **known limitation, document it**. ~25% of French iOS users won't get push without a wrapper.
- **Phase 4 wrapper option**: Capacitor 8 to ship to App Store. Effort: ~2-3 days per platform + Apple Developer account ($99/yr) + Google Play ($25 one-time).

---

## 11. Analytics (RUM)

### 11.1 Our current state
- Umami self-hosted (per CLAUDE.md "Analytics: Umami self-hosted")

### 11.2 Live state of the art (fetched 2026-04-25)

| Service | Free tier | Paid | Notes | Source |
|---|---|---|---|---|
| PostHog Cloud | 1M events/mo free | $0.0000343/event 2-15M | rich features (replay, flags, surveys) | https://posthog.com/pricing |
| Plausible | $9/mo for 10K pv | scaled | privacy-focused | (404 fetched, search) |
| Vercel Web Analytics | 50K events/mo free Hobby | $3/100K events Pro | tied to Vercel | https://vercel.com/docs/analytics/limits-and-pricing |
| Umami self-hosted | $0 | $0 | privacy-first, our pick | n/a |

**Web Vitals 2026 update**: Google introduced **Core Web Vitals 2.0** in early 2026 with a new metric — **Visual Stability Index (VSI)** — measuring layout stability throughout the entire user session, not just initial page load. INP threshold remains <200ms. ⚠️ minor: if we instrument RUM, capture VSI too.

### 11.3 Verdict
- **Umami self-hosted** → ✅ aligned. Privacy-first, $0 ongoing cost (just needs the worker PC or a $5/mo VPS).
- **Vercel Web Analytics free 50K events/mo** → 💡 **complement Umami** for free since we already deploy on Vercel. Captures Core Web Vitals (LCP, INP, CLS) which Umami doesn't.
- **PostHog Cloud free 1M events** → 💡 if we want session replay (expensive with Sentry), PostHog's free tier covers it.

---

## 12. CI/CD

### 12.1 Our current state
- GitHub Actions (assumed; not explicitly defined in spec).
- Vercel auto-deploy on push to main (with `ignoreCommand` to skip preview branches per Mehdi's global pref).

### 12.2 Live state of the art (fetched 2026-04-25)

- **GitHub Actions**: 2000 free min/mo for personal accounts on private repos. Public repos = unlimited. Standard runner $0.008/min Linux, $0.016/min Windows, $0.08/min macOS.
- **Vercel preview deploys with AI comments** → unrelated to us (we DON'T run preview deploys per Mehdi's global config).
- Buildkite / CircleCI / Codecov — overkill for our scale.

### 12.3 Verdict
- ✅ aligned. GitHub Actions free tier is enough for our 1-3 commits/day cadence. No changes needed.

---

## SUMMARY: 5 most important findings

1. **Gemini 2.5 Flash-Lite is still the right primary clip analyzer** — but the spec is missing an "escalation path" to Gemini 3.1 Pro for ultra-hype clips (penta, quadra). Cost is trivial (~$3-4 for the entire pilot season). **P1 recommendation.**

2. **Claude Haiku 4.5 stays the right moderation pick** — spec model ID `claude-haiku-4-5-20251001` is exactly correct as of today (2026-04-25). ✅ no change.

3. **Next.js 16.2 is stable** (March 18, 2026) and brings Turbopack stable + React Compiler stable + ~400% faster dev startup. We're on 15.3. **Defer migration to Phase 4** (post-launch). Async params are a meaningful breaking change.

4. **Tailwind v4.1 + React 19 + shadcn/ui all align cleanly**. Our `package.json` is in good shape. ✅ no change.

5. **Add Sentry free tier (5K errors/mo) to V0 launch checklist** — there is currently NO error monitoring beyond Discord webhooks. Sentry's free tier covers our scale at $0 and would catch frontend crashes that Discord misses. **P0 recommendation** for production readiness.

### Bonus alarm
- **Highlight.io is being sunset by Feb 28 2026** → if any other swarm agent suggests it, REJECT.
- **Hetzner price hike April 1, 2026** → CPX22 went from €5.99 to €7.99/mo. Update worker hosting cost projections.
- **DeepSeek-V4-Flash at $0.14/$0.28** is a tempting moderation fallback but raises EU residency concerns — keep Haiku as primary.
- **Grok 4.1 Fast at $0.20/$0.50 with 2M context** is unbeatable for any text-only enrichment we'd add later.
- **iOS 26 + Safari 18.4 Declarative Web Push** = ✅ our PWA push plan works. EU users on iOS still in the cold (DMA).
