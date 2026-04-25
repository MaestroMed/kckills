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
        for provider in candidates:
            log.info("ai_router_pick",
                     provider=provider.name,
                     model=provider.model_name,
                     urgency=task.urgency,
                     vision=task.requires_vision)
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

        eligible: list[AIProvider] = []
        for p in self.providers:
            if task.requires_vision and not p.supports_vision:
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

        if task.urgency == "backfill":
            eligible.sort(key=lambda p: p.cost_per_m_input)
        elif task.urgency == "live":
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
