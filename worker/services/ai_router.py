"""
AI_ROUTER — multi-provider analyzer routing layer.

Phase-1 INTERFACE STUB. The router and provider classes here are the
*design* committed in this wave; provider classes do not yet make real
API calls — `analyze_clip()` raises NotImplementedError("router phase 2").

What this file gives you today :
  * A typed `AIProvider` Protocol that every provider class implements.
  * A typed `AITask` dataclass describing one analysis request (clip URL,
    prompt, vision-required flag, urgency, cost ceiling).
  * An `AnalysisResult` dataclass with score / tags / description /
    confidence / cost / latency / provider name. Mirrors the shape of
    the existing analyzer's Gemini result so the migration in
    `worker/modules/analyzer.py` is a drop-in swap.
  * An `AIRouter` orchestrator that picks the right provider for a task,
    falls back on failure, tracks cumulative cost, and refuses to route
    to a provider whose daily budget is spent.
  * A `ProviderUnavailable` exception used by stub providers to signal
    "I exist, you can route to me, but I haven't been wired yet" — the
    router treats this exactly the same as a real 5xx.

The actual wiring of Gemini, Anthropic, OpenAI and Cerebras is
intentionally deferred to phase 2 — this file is the seam. See
`docs/loltok-ai-multi-provider.md` for the full design rationale.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable

import structlog

log = structlog.get_logger()


# ─── Public types ──────────────────────────────────────────────────────


class ProviderUnavailable(RuntimeError):
    """Raised by a provider that isn't wired yet OR is in a cooldown.

    The router catches this and falls back to the next candidate. The
    stub provider classes raise this from analyze_clip() until phase 2
    plugs in real SDK calls.
    """


@dataclass(frozen=True)
class AITask:
    """One unit of work for the router.

    Attributes
    ----------
    prompt : str
        The full user prompt, fully formatted (no template substitution
        happens in the router — the analyzer builds this before calling).
    clip_url : str | None
        URL of the clip MP4 on R2 or a local path. None for text-only tasks.
    requires_vision : bool
        If True, the router only considers vision-capable providers.
        Cerebras / Groq are excluded from vision tasks regardless of cost.
    urgency : str
        One of "live" | "normal" | "backfill". Live = lowest latency
        first. Backfill = cheapest first (potentially Anthropic batch API).
    max_cost_usd : float | None
        Refuse to route to any provider whose estimated cost for this
        task exceeds this ceiling. None = no ceiling.
    quality_minimum : str
        One of "low" | "standard" | "high". Reserved for phase 4 — the
        router currently uses cost ordering and ignores this hint.
    """

    prompt: str
    clip_url: str | None = None
    requires_vision: bool = True
    urgency: str = "normal"
    max_cost_usd: float | None = None
    quality_minimum: str = "standard"
    # Wave 11 additions — text-only / non-PII routing
    has_pii: bool = False
    """If True, the router excludes providers with is_pii_safe=False
    (DeepSeek, Grok). User-comment moderation = True ; AI-generated
    description translation = False (the FR text was AI-written, no PII)."""
    system: str | None = None
    """Optional system prompt for chat-style providers (DeepSeek, Grok,
    OpenAI, Anthropic). Vision providers (Gemini) ignore this."""
    # Wave 11 additions — daemon-friendly priority alias for `urgency`
    # kept for backwards compat with the translator daemon's call sites.
    priority: str | None = None


@dataclass
class AnalysisResult:
    """Output of one analysis call.

    The fields mirror the existing analyzer's Gemini result so that
    `worker/modules/analyzer.py::analyze_kill` can switch from a direct
    Gemini call to `router.route(task)` with no shape change downstream.

    Cost + latency + provider name are populated by the router after the
    provider returns — providers must NOT pre-fill these (the router
    needs control over the cost-tracking output).
    """

    # Analysis payload (matches existing Gemini analyzer output shape)
    highlight_score: float | None = None
    tags: list[str] = field(default_factory=list)
    description: str | None = None
    confidence: float | None = None
    raw_response: dict = field(default_factory=dict)
    # Wave 11 addition — raw text output for text-only providers
    # (DeepSeek, Grok, OpenAI). Vision providers leave this None and
    # populate description/tags/highlight_score instead. The translator
    # daemon reads `text` first, falls back to `description`.
    text: str | None = None
    # Wave 11 addition — observability for the router's fallback chain.
    # `attempts` lists every provider name the router tried in order,
    # ending with the one that succeeded. `fallback_used` is True iff
    # at least one provider failed before the winning one. The dashboard
    # surfaces these to operators investigating cost / latency patterns.
    attempts: list[str] = field(default_factory=list)
    fallback_used: bool = False

    # Provenance (populated by the router, not the provider)
    provider_name: str = ""
    model_name: str = ""
    cost_usd: float | None = None
    latency_ms: int | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None


@runtime_checkable
class AIProvider(Protocol):
    """The Protocol every provider class implements.

    Why @runtime_checkable : the test suite uses isinstance() checks to
    verify the stubs implement the Protocol. Cheap correctness gate.

    Conventions for implementations
    -------------------------------
    * `name` is a short identifier ("gemini" / "anthropic" / "openai" /
      "cerebras") used in structlog events and ai_annotations rows.
    * `cost_per_m_input` / `cost_per_m_output` are USD per 1M tokens at
      the provider's published rate. Used by the router for cost-based
      provider selection AND for cost tracking on the result.
    * `supports_vision` gates whether the provider sees AITask.clip_url.
    * `analyze_clip()` does the actual call. It MUST NOT populate the
      cost/latency/provider_name fields on AnalysisResult — the router
      owns those.
    * `quota_remaining()` returns approximate calls left for today. None
      means "I don't know" (paid providers without explicit budgets).
      Zero means "do not route here today".
    """

    name: str
    model_name: str
    cost_per_m_input: float
    cost_per_m_output: float
    supports_vision: bool

    async def analyze_clip(self, task: AITask) -> AnalysisResult:
        """Run the analysis. Raises ProviderUnavailable on failure."""
        ...

    async def quota_remaining(self) -> int | None:
        """Return approximate calls left today; None = unknown; 0 = drained."""
        ...


# ─── Provider registry helper ─────────────────────────────────────────


def estimate_cost_usd(
    provider: AIProvider,
    input_tokens: int | None,
    output_tokens: int | None,
) -> float | None:
    """Compute USD cost from token counts and provider rates.

    Returns None if both token counts are missing. Mirrors the contract
    of `services.ai_pricing.compute_gemini_cost` so the analyzer can
    treat both as interchangeable.
    """
    if input_tokens is None and output_tokens is None:
        return None
    in_tok = max(0, int(input_tokens or 0))
    out_tok = max(0, int(output_tokens or 0))
    cost = (
        in_tok * provider.cost_per_m_input
        + out_tok * provider.cost_per_m_output
    ) / 1_000_000.0
    return round(cost, 6)


# ─── The router ───────────────────────────────────────────────────────


class AIRouter:
    """Picks the right AIProvider for an AITask, falls back on failure.

    Design notes
    ------------
    * The router is stateless across requests *except* for the
      `_spent_usd_today` ledger and the `_cooldowns` map. Both are
      reset by the caller (or on process restart) — this keeps testing
      trivial.
    * `route(task)` walks the provider list in the order given by
      `_select_candidates(task)`, calls `analyze_clip()`, and returns
      the first successful result. On `ProviderUnavailable` from any
      provider, that provider is put in a 5-minute cooldown and the
      router moves to the next.
    * The router NEVER raises if at least one provider is wired. If
      every provider is unavailable, raises `RuntimeError` so the caller
      (analyzer) can fail the pipeline_jobs row with a clear error code.
    """

    COOLDOWN_SECONDS: int = 300  # 5 min after a provider failure

    def __init__(
        self,
        providers: list[AIProvider],
        daily_budget_usd: dict[str, float] | None = None,
    ):
        if not providers:
            raise ValueError("AIRouter requires at least one provider")
        self.providers: list[AIProvider] = list(providers)
        self.daily_budget_usd: dict[str, float] = dict(daily_budget_usd or {})
        self._spent_usd_today: dict[str, float] = {}
        self._cooldowns: dict[str, float] = {}
        log.info(
            "ai_router_init",
            providers=[p.name for p in providers],
            budgets={k: v for k, v in self.daily_budget_usd.items()},
        )

    # ── Public API ─────────────────────────────────────────────────

    async def route(self, task: AITask) -> AnalysisResult:
        """Pick a provider and run the task. Falls back on failure.

        Returns the first successful AnalysisResult with provider
        provenance + cost + latency populated. Raises RuntimeError if
        every provider was unavailable or skipped.
        """
        candidates = await self._select_candidates(task)
        if not candidates:
            log.warn("ai_router_no_candidates",
                     vision=task.requires_vision,
                     urgency=task.urgency)
            raise RuntimeError("ai_router: no eligible provider")

        attempt_errors: list[str] = []
        attempted_names: list[str] = []
        for provider in candidates:
            log.info("ai_router_pick",
                     provider=provider.name,
                     model=provider.model_name,
                     urgency=task.urgency,
                     vision=task.requires_vision)
            attempted_names.append(provider.name)
            started_at = time.monotonic()
            try:
                result = await provider.analyze_clip(task)
            except ProviderUnavailable as e:
                self._mark_cooldown(provider.name)
                attempt_errors.append(f"{provider.name}={e}")
                log.warn("ai_router_fallback",
                         failed=provider.name, reason=str(e)[:120])
                continue
            except Exception as e:
                self._mark_cooldown(provider.name)
                attempt_errors.append(f"{provider.name}={type(e).__name__}")
                log.error("ai_router_provider_exception",
                          failed=provider.name,
                          error_type=type(e).__name__,
                          error=str(e)[:200])
                continue

            # Provider returned. Stamp provenance, compute cost, track
            # spend ledger.
            elapsed_ms = int((time.monotonic() - started_at) * 1000)
            result.provider_name = provider.name
            result.model_name = provider.model_name
            result.latency_ms = elapsed_ms
            result.attempts = attempted_names[:]
            result.fallback_used = len(attempted_names) > 1
            if result.cost_usd is None:
                result.cost_usd = estimate_cost_usd(
                    provider, result.input_tokens, result.output_tokens,
                )
            if result.cost_usd is not None:
                self._spent_usd_today[provider.name] = (
                    self._spent_usd_today.get(provider.name, 0.0)
                    + result.cost_usd
                )
            log.info("ai_router_success",
                     provider=provider.name,
                     model=provider.model_name,
                     latency_ms=elapsed_ms,
                     cost_usd=result.cost_usd)
            return result

        log.error("ai_router_drained", attempts=attempt_errors)
        raise RuntimeError(
            f"ai_router: all providers failed: {attempt_errors}"
        )

    def reset_daily_budget(self) -> None:
        """Wipe the per-day spend ledger. Call at 07:00 UTC reset."""
        self._spent_usd_today.clear()
        self._cooldowns.clear()
        log.info("ai_router_daily_reset")

    def spent_usd_today(self, provider_name: str) -> float:
        """Total cost we've billed to this provider today (router-tracked)."""
        return self._spent_usd_today.get(provider_name, 0.0)

    def total_spent_usd_today(self) -> float:
        """Sum of cost billed across ALL providers today.

        Used by daemons that want a single number for their summary log
        (e.g. translator's `translator_scan_done` event). Cheap : O(N)
        in the number of providers (typically <10).
        """
        return float(sum(self._spent_usd_today.values()))

    # ── Selection logic ───────────────────────────────────────────

    async def _select_candidates(self, task: AITask) -> list[AIProvider]:
        """Return the ordered list of providers eligible for this task.

        Filtering rules :
          1. Vision tasks exclude providers with supports_vision=False.
          2. Providers in cooldown are excluded.
          3. Providers with quota_remaining()=0 are excluded.
          4. Providers whose daily budget is spent are excluded.

        Ordering rules :
          * urgency='live'    → sort by ascending latency-class
                                (provider order in self.providers is
                                taken as proxy for that — operator puts
                                Gemini first because it's fastest).
          * urgency='backfill'→ sort by ascending cost_per_m_input
                                (cheapest first).
          * urgency='normal'  → sort by ascending cost_per_m_input then
                                operator order (cost first, latency tie-
                                break).
        """
        now_mono = time.monotonic()

        # Wave 11 — `priority` is the daemon-friendly alias for `urgency`.
        # Translator + future text daemons set `priority`; legacy analyzer
        # call sites keep using `urgency`. Either is canonical.
        effective_urgency = task.priority or task.urgency

        eligible: list[AIProvider] = []
        for p in self.providers:
            if task.requires_vision and not p.supports_vision:
                continue
            # Wave 11 — refuse to ship PII to non-PII-safe providers
            # (DeepSeek = Chinese jurisdiction, Grok = xAI consumer tier).
            # Existing providers without the attribute default to True
            # (they predate the wave and are all on US/EU enterprise tiers).
            if task.has_pii and not getattr(p, "is_pii_safe", True):
                continue
            if self._cooldowns.get(p.name, 0.0) > now_mono:
                continue
            quota = await p.quota_remaining()
            if quota is not None and quota <= 0:
                continue
            budget = self.daily_budget_usd.get(p.name)
            if budget is not None and self._spent_usd_today.get(p.name, 0.0) >= budget:
                continue
            # Cost ceiling on this task — rough check using estimated
            # 2K input + 200 output tokens (typical Gemini call size).
            if task.max_cost_usd is not None:
                est = estimate_cost_usd(p, 2000, 200) or 0.0
                if est > task.max_cost_usd:
                    continue
            eligible.append(p)

        if effective_urgency == "backfill":
            eligible.sort(key=lambda p: p.cost_per_m_input)
        elif effective_urgency == "live":
            # Keep operator's stated order — they've put fastest first.
            pass
        else:  # normal
            eligible.sort(
                key=lambda p: (p.cost_per_m_input,
                               self.providers.index(p))
            )
        return eligible

    def _mark_cooldown(self, provider_name: str) -> None:
        """Park a provider for COOLDOWN_SECONDS after a failure."""
        self._cooldowns[provider_name] = time.monotonic() + self.COOLDOWN_SECONDS


# ─── Factory : build_default_router ───────────────────────────────────


def build_default_router() -> "AIRouter":
    """Build an AIRouter wired with whichever providers have an API key.

    Wave 11 helper used by the translator daemon and any future text-only
    daemon that wants the canonical operator preference order :

      1. DeepSeek V4 Flash   — cheapest non-PII text, default for backfill.
      2. Grok 4.1 Fast       — second-cheapest non-PII text, DeepSeek fallback.
      3. Gemini 2.5 Flash    — cheapest vision-capable, drops in for vision.
      4. Anthropic Haiku 4.5 — PII-safe, drops in for moderation + sensitive text.
      5. OpenAI gpt-4o-mini  — additional vision fallback.
      6. Cerebras Llama      — text-only fallback if everyone else is down.

    Each provider is instantiated only if its API key env var is set.
    Returns an AIRouter pre-loaded with whatever's available.

    Raises
    ------
    RuntimeError
        If NO provider has a configured key. Caller daemons (translator)
        catch this and downgrade to a no-op cycle so the worker keeps
        running without crashing.

    Daily budgets
    -------------
    Read from KCKILLS_AI_DAILY_BUDGET_USD_<PROVIDER> env vars (e.g.
    KCKILLS_AI_DAILY_BUDGET_USD_DEEPSEEK=2.00). Unset = no per-provider
    cap (router still tracks spend for the dashboard).
    """
    import os
    providers: list[AIProvider] = []

    def _has_key(env_name: str) -> bool:
        return bool(os.environ.get(env_name, "").strip())

    # Lazy imports — avoid a circular import at module load time and let
    # provider files raise their own deps errors only when actually picked.
    if _has_key("KCKILLS_DEEPSEEK_API_KEY"):
        from services.ai_providers.deepseek import DeepSeekProvider
        providers.append(DeepSeekProvider())
    if _has_key("KCKILLS_GROK_API_KEY") or _has_key("KCKILLS_XAI_API_KEY"):
        from services.ai_providers.grok import GrokProvider
        providers.append(GrokProvider())
    if _has_key("KCKILLS_GEMINI_API_KEY") or _has_key("GEMINI_API_KEY"):
        from services.ai_providers.gemini import GeminiProvider
        providers.append(GeminiProvider())
    if _has_key("KCKILLS_ANTHROPIC_API_KEY") or _has_key("ANTHROPIC_API_KEY"):
        from services.ai_providers.anthropic import AnthropicProvider
        providers.append(AnthropicProvider())
    if _has_key("KCKILLS_OPENAI_API_KEY") or _has_key("OPENAI_API_KEY"):
        from services.ai_providers.openai import OpenAIProvider
        providers.append(OpenAIProvider())
    if _has_key("KCKILLS_CEREBRAS_API_KEY"):
        from services.ai_providers.cerebras import CerebrasProvider
        providers.append(CerebrasProvider())

    if not providers:
        raise RuntimeError(
            "build_default_router: no provider keys configured. Set at "
            "least one of KCKILLS_DEEPSEEK_API_KEY, KCKILLS_GROK_API_KEY, "
            "KCKILLS_GEMINI_API_KEY, KCKILLS_ANTHROPIC_API_KEY, "
            "KCKILLS_OPENAI_API_KEY, or KCKILLS_CEREBRAS_API_KEY."
        )

    # Daily budget — single env var KCKILLS_AI_DAILY_BUDGET_USD split
    # evenly across instantiated providers. Per-provider override via
    # KCKILLS_AI_DAILY_BUDGET_USD_<NAME> wins when set. Empty = no cap.
    budgets: dict[str, float] = {}
    raw_total = os.environ.get("KCKILLS_AI_DAILY_BUDGET_USD", "").strip()
    if raw_total:
        try:
            total = float(raw_total)
            even_split = total / len(providers)
            for p in providers:
                budgets[p.name] = even_split
        except ValueError:
            log.warn("ai_router_bad_total_budget", value=raw_total[:40])
    # Per-provider override
    for p in providers:
        env_var = f"KCKILLS_AI_DAILY_BUDGET_USD_{p.name.upper()}"
        raw = os.environ.get(env_var, "").strip()
        if raw:
            try:
                budgets[p.name] = float(raw)
            except ValueError:
                log.warn("ai_router_bad_budget_env", env=env_var, value=raw[:40])

    return AIRouter(providers=providers, daily_budget_usd=budgets)
