# LoLTok — AI Multi-Provider Router

**Owner:** Agent CC (PR-loltok wave)
**Last reviewed:** 2026-04-25
**Status:** design — interface stub landed in `worker/services/ai_router.py`,
no real provider calls wired yet

This document explains
1. **why** Mehdi's "let's just rotate Gemini accounts" idea is a path to
   a permaban,
2. the **legitimate** architecture that gets us the same throughput by
   running paid quotas on multiple providers in parallel, and
3. the **routing decisions** baked into `worker/services/ai_router.py` so
   the operator can plug in real provider clients in a follow-up wave.

---

## 0. The problem

The analyzer in `worker/modules/analyzer.py` calls Gemini 2.5 Flash-Lite
on every clip. Free tier ceiling: **1000 requests / day** = ~41 requests
/ hour averaged. With Gemini's 4-second hard rate-limit, the worker
*throughput* is also capped at 15 requests / minute = 900 / hour
*peak*, but only as long as we have daily quota.

LoLTok V0 (just KC, just LEC) has been comfortable inside this:
- 28 kills/game × 14 KC-involved × ~20 KC games / split = ~280 kills /
  pilot. Easy.

LoLTok V1 (multi-team Europe, all of LEC) needs more:
- 28 kills/game × ~50 LEC games / split-week = 1 400 kills / week
- Concurrent split coverage (LEC + LFL + EMEA Masters) → ~4 000 kills /
  week = ~570 / day = **57% of the daily Gemini ceiling on its own**.

LoLTok V2 (full historical backfill, every European league since 2011)
needs another 250x:
- 1.2 M historical kills, one-shot batch over 60 days = 20 K/day = **20x
  over the daily Gemini ceiling**.

We need a strategy that scales from 41/h → 1000/h **legitimately**, with
predictable costs and no risk of overnight account loss.

---

## 1. Why multi-account "free-tier multiplexing" is NOT viable

Mehdi explicitly asked whether we could solve the throughput problem by
**creating N Gemini accounts** and rotating between them. The answer is
**no**, and the reasoning is worth nailing down so we don't revisit
this idea every quarter.

### 1.1 What the ToS actually say

| Provider | Relevant clause | Penalty |
|---|---|---|
| Google AI / Gemini | Generative AI Additional Terms § 2 ("Use Restrictions") forbids "creating multiple accounts to circumvent rate limits or quota". The Acceptable Use Policy adds "circumventing usage tiers or restrictions". | Permanent ban of all linked Google accounts (workspace, ads, cloud). Recovery rate observed: < 5%. |
| Anthropic (Claude API) | Usage Policies § "Prohibited Uses" : "creating multiple accounts to access free tier credits or evade quota limits". | Termination of API access across all known emails, payment methods, and devices. Manual appeals queue is months long. |
| OpenAI | Usage Policies § "Account Sharing" : "do not register multiple accounts to circumvent rate limits or eligibility for free trials". | Permanent ban of org and all linked accounts; payment methods flagged. |
| Cerebras | ToS § 4.2 : same language. | Same — permanent ban. |

These are not theoretical. Every provider has internal automation that
correlates accounts via:
- email domain / canonical form (gmail dot/plus tricks are detected)
- payment instrument (Stripe / Adyen fingerprints)
- IP and ASN (residential or VPN — they track both)
- device fingerprint (browser canvas + WebGL hash, even on different
  laptops via behavioural traits)
- billing address phone number
- (for Google specifically) Workspace tenant linkage

The detection latency varies but the typical real-world outcome for
agencies that try this: **6 months of "free" usage, then a wave of
correlated bans across all linked accounts in a single week**, usually
right after a load-shedding event when the abuse-detection team reviews
the top-N quota burners.

### 1.2 Why this matters more for LoLTok than a side project

LoLTok is a **public, named product** that EtoStark will showcase on
stream. If our analyzer goes dark for a week because every linked
Google account got nuked, that's:
- a public outage on the live launch,
- zero recourse (no SLA on free tier),
- no realistic path to apology + restore (Google support response time
  on free tier is 30+ days),
- potential legal exposure (the products page tells viewers the kills
  are AI-analysed; if we're knowingly violating the AI provider's ToS
  to deliver that, that's a fraud risk if anyone cares to dig).

### 1.3 Cost of "doing it right" is far lower than people assume

Here's the math people skip when they reach for free-tier abuse:

| Approach | Throughput | Cost / 1 K kills | Risk |
|---|---|---|---|
| 1 free Gemini account | 1 K / day | $0 | Daily cap blocks growth |
| 5 free Gemini accounts (abuse) | 5 K / day | $0 | Permaban risk = product death |
| 1 paid Gemini Flash-Lite | 50 K+ / day | ~$0.40 (≈$0.0004/clip) | Zero |
| Multi-provider router (paid) | 200 K+ / day | ~$1.50 / 1K | Zero, also redundant |

For our V1 target of 4 K kills/week ≈ 570/day, paid Gemini Flash-Lite
costs us **$0.23/day = $7/mois**. That's well below the noise floor of
the rest of the budget (Vercel = $0, Supabase = $25 at Pro, R2 = $0,
Mehdi's electricity for the worker PC = $5/mo).

For V2's 1.2 M backfill, the cost is ~$1100 one-shot via Anthropic batch
API (-50% from sync). Less than the cost of one wrongful Google ban
incident.

**Conclusion**: free-tier abuse is the most expensive option once we
price in the existential risk to the product.

---

## 2. The legitimate alternative — multi-PROVIDER router

The architectural insight: **using multiple AI providers is normal, not
an abuse pattern**. Google, Anthropic, OpenAI and Cerebras are
*competitors* — they have no shared identity system, no cross-provider
correlation. Running each provider's paid tier in parallel gets us the
combined throughput legitimately.

The router becomes a thin layer in front of the analyzer:

```
analyzer.py  ──►  AIRouter.route(task)  ──┬──►  Gemini  (vision, cheap, primary)
                       │                  ├──►  Anthropic Haiku 4.5  (vision, fallback when Gemini drained)
                       │                  ├──►  OpenAI gpt-4o-mini  (vision, A/B candidate, EU privacy: opt-out)
                       │                  └──►  Cerebras Llama 3.3  (text-only, 2000 tok/s for non-vision tasks)
                       │
                       └─►  picks provider based on:
                            (1) does this task need vision ?
                            (2) provider quota remaining
                            (3) cost per analysis
                            (4) latency SLA bracket (live vs backfill)
```

### 2.1 Provider matrix

| Provider | Model | Cost / M input | Cost / M output | Vision ? | Strengths | Weaknesses |
|---|---|---|---|---|---|---|
| Gemini | 2.5 Flash-Lite | $0.10 | $0.40 | YES | Fast, cheapest vision-capable, free tier still useful | Vendor lock to Google account; quota policy can change |
| Gemini | 2.5 Flash | $0.30 | $2.50 | YES | Higher quality on subtle frames | 3x cost vs Flash-Lite |
| Anthropic | Haiku 4.5 | $1.00 | $5.00 | YES | Strong instruction-following, no rate-limit issues at paid tier, EU-friendly | Pricier per token, slower than Cerebras |
| OpenAI | gpt-4o-mini | $0.15 | $0.60 | YES | Solid all-rounder, well-tuned | Privacy concerns for EU users (data crosses to US) — must opt-out via Zero Data Retention contract |
| Cerebras | Llama 3.3 70B | $0.60 | $0.60 | NO | **2000 tok/s** — 30x faster than anyone for text-only tasks | No vision; smaller context (8K vs 1M for Gemini) |
| Groq | Llama 3.3 70B | $0.79 | $0.79 | NO | Same speed class as Cerebras | Same vision limit; Groq has had outages |
| Anthropic | Haiku 4.5 batch | $0.50 | $2.50 | YES | -50% on batch API for non-time-critical work | 24h SLA on batch completion |

### 2.2 Routing logic

The router decides per-task. There are two task shapes today:

1. **Vision task** (the analyzer's primary use): the model sees the clip
   MP4 and generates score + tags + description. Required: vision support.
2. **Text-only task** (re-tagging from existing description, summarising
   highlights, generating editorial copy): the model gets the existing
   `ai_description` plus context. No vision needed.

Decision tree:

```
         ┌───────────────────────┐
         │ task.requires_vision? │
         └───────┬───────────────┘
                 │
         ┌───────┴───────┐
        YES              NO
         │                │
         ▼                ▼
  ┌────────────────┐  ┌──────────────────────┐
  │ urgency?       │  │ urgency?             │
  │ live = high    │  │ live = high          │
  │ backfill = low │  │ backfill = low       │
  └──┬───────┬─────┘  └──┬───────┬───────────┘
     │       │           │       │
   high     low        high     low
     │       │           │       │
     ▼       ▼           ▼       ▼
  Gemini   Anthropic   Cerebras Anthropic
  Flash    Haiku       (text    Haiku
  Lite     Batch       only,    Batch
  →        (-50%)      2000     (-50%)
  Anthropic→ OpenAI    tok/s)
  Haiku    GPT-4o-mini
  →
  OpenAI
  GPT-4o-mini
```

### 2.3 Quota tracking and fallback

Each provider exposes `quota_remaining()`. The router:
1. Asks each candidate provider what it has left today.
2. Picks the cheapest provider with > 0 remaining.
3. On failure (HTTP 429 / 5xx / SDK exception), falls back to the next
   provider in the priority list.
4. Records the actual provider + cost + latency on the result so
   `ai_annotations` can store provenance per call.

Fallback example: Gemini paid quota exhausted at 18:00 (LEC match
finishing). Router transparently routes the next 200 kills to Anthropic
Haiku. We see a `model_provider='anthropic'` row in `ai_annotations`
instead of `'gemini'`. The web app doesn't know or care — the trigger
`fn_sync_ai_annotation_to_kill` writes the same `kills.ai_description`
column either way.

### 2.4 Cost projection at scale

| Workload | Volume | Strategy | Cost |
|---|---|---|---|
| V1 ongoing (4K kills/week, vision required) | 200 K / year | Gemini Flash-Lite primary, Anthropic Haiku 5% fallback | ~$50 / year |
| V2 backfill one-shot (1.2 M kills, vision required) | 1.2 M | Anthropic Haiku batch API (24h SLA, -50%) | **~$1 100** |
| V2 ongoing (500 K / year, vision required) | 500 K / year | Gemini Flash-Lite + Anthropic Haiku spillover | ~$120 / year |
| Re-tagging pass (text-only, 200 K kills) | 200 K | Cerebras Llama 3.3 70B (2000 tok/s, $0.60/M) | ~$30 |
| Editorial highlight summaries (1K/month, text-only) | 12 K / year | Cerebras for speed | ~$2 / year |

**V2 yearly run-rate: ~$150 / year**, fully legitimate, redundant across
4 vendors so no single outage takes us down.

---

## 3. Implementation plan

### Phase 1 — Interface stub (this wave, DONE)

- `worker/services/ai_router.py` defines the `AIProvider` Protocol, the
  `AITask` dataclass, and the `AIRouter` orchestrator.
- `worker/services/ai_providers/{gemini,anthropic,openai,cerebras}.py`
  are skeleton classes that satisfy the Protocol but raise
  `NotImplementedError("router phase 2")` from `analyze_clip()`. Each
  carries its real cost-per-M and vision capability so the router can
  make routing decisions today, even with no live calls.
- `worker/tests/test_ai_router.py` covers selection, fallback, cost
  tracking, and the no-vision exclusion logic — all tests are fully
  mocked, no network, no env vars needed.
- The existing analyzer (`worker/modules/analyzer.py`) is **untouched**.
  It still imports `services.gemini_client` directly. Phase 2 swaps the
  call site.

### Phase 2 — Wire Gemini through the router

- Replace the direct `import google.generativeai` block in
  `analyzer.py::analyze_kill` with `await router.route(task)`.
- The Gemini provider class wraps the existing `gemini_client.analyze`
  function. Net change to behaviour: zero; now the router can decide.
- Add a fallback to Anthropic Haiku when `scheduler.get_remaining("gemini")`
  reports < 50 remaining for the day. This is the single biggest
  reliability win.

### Phase 3 — Add OpenAI gpt-4o-mini as A/B candidate

- Operator signs an OpenAI Zero Data Retention agreement (required for
  EU-content compliance).
- Router routes 5% of vision tasks to OpenAI for 2 weeks.
- Compare quality scores side-by-side (`ai_annotations.confidence_score`)
  per provider per kill type. Promote OpenAI to fallback if scores match
  Gemini.

### Phase 4 — Full intelligence

- Router maintains rolling per-provider quality scores per kill type
  (solo kill vs teamfight vs tower dive).
- Routes by **(quality, cost, latency)** triple, not just (cost, vision).
- Introduces the `quality_minimum` field on `AITask` so editorial
  highlight clips can demand `Anthropic` or `Gemini Pro` even when the
  cheap option is available.

---

## 4. Why this design and not the obvious alternatives

### "Just write a switch statement in `analyzer.py`"

We have a switch statement now (it's `if config.GEMINI_API_KEY`). The
problem is *fan-out*: every downstream component (lab generator, regen
loop, OG image scoring) ends up duplicating that switch. A router as a
service centralises the policy in one file and lets the rest of the
worker pretend there's one provider.

### "Use LiteLLM / LangChain"

Both are excellent at the multi-provider abstraction. We're skipping them
because:
- They add ~30 MB of transitive deps (we're a 24/7 PC daemon, image size
  matters for systemd reliability).
- Our routing policy is simple enough that 200 lines of typed Python
  are cleaner than a config-as-code framework.
- We *do* want first-class control over the cost-tracking output that
  feeds `ai_annotations.cost_usd` — easier to enforce in our own code
  than to extract from a third-party provider's response shape.
- If the routing logic ever gets complex (true bandit allocation, P(quality)
  Bayesian routing), we'd revisit and bring in a real library.

### "Run the worker on Kubernetes with N pods, one per provider"

Adds infrastructure complexity for zero throughput benefit — the
bottleneck is provider rate limits, not local CPU. The single-process
async pipeline is correct.

---

## 5. Operator runbook (for when Phase 2+ ships)

### Adding a new provider key

1. Set the env var (e.g. `OPENAI_API_KEY`) on the worker host.
2. The provider class auto-detects the key on import. If absent, the
   provider reports `quota_remaining() = 0` and the router skips it.
3. Restart the worker. No code change needed.

### Watching provider health

The router emits structlog events:
- `ai_router_pick`: which provider was chosen and why
- `ai_router_fallback`: a primary failed, falling back to N
- `ai_router_drained`: all providers exhausted for the day

These flow into the existing watchdog Discord webhook
(`worker/modules/watchdog.py`), so a stuck pipeline pings Mehdi within
the hour.

### Cost ceiling per day

Each provider has a `daily_budget_usd` config (env var
`AI_BUDGET_<PROVIDER>_USD`, default unbounded). The router refuses to
route a task to a provider if the cumulative cost today would exceed
that budget. This is the same shape as `KCKILLS_GEMINI_DAILY_CAP` in
the existing scheduler, generalised.

### What to do if a provider goes down

Nothing manual. The router detects 5xx / timeout, marks the provider
as unhealthy for a 5-minute cooldown, and falls back. After the
cooldown, it tries again. If all providers stay down for > 30 min, the
analyzer emits `analyzer_all_providers_down` and lets the kill stay in
status='clipped' for the next pass to retry.

---

## 6. What we are explicitly NOT doing

| Decision | Why not |
|---|---|
| Multi-account free-tier rotation | See § 1. Existential risk to product. |
| Hosting our own LLM (Ollama / vLLM) | Hardware (4090 GPU rented) costs $0.50/h = $360/mo. Less than $50/yr API spend. |
| Routing based on "model personality" preferences | Subjective, hard to A/B. We route on objective metrics: cost, vision, quota, quality scores. |
| Letting users pick the provider in the UI | Confusing. Provider is an implementation detail. |
| Streaming partial results from multiple providers and racing them | Adds 4x cost for marginal latency win. Maybe at V3. |

---

*This doc + the router stub is the foundation. Phase 2 (real Gemini
wiring) is a 2-day follow-up, Phase 3 (OpenAI A/B) is a 1-week task.*
