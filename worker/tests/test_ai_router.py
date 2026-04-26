"""Tests for services.ai_router and the provider stubs.

Phase 1 coverage. Every test is fully mocked — no network, no env vars
required. The real provider classes are exercised only for their
contract (cost numbers, vision flag, no-key behaviour) ; the routing
logic is tested against MockProvider instances we control directly.

Coverage :
  * AIRouter rejects construction with zero providers.
  * Provider selection respects vision-required filtering.
  * Provider selection respects quota_remaining()=0 exclusion.
  * Provider selection orders by cost on urgency='backfill'.
  * Provider selection respects daily_budget_usd ceiling per provider.
  * Fallback chain : ProviderUnavailable on N falls through to N+1.
  * Fallback chain : a generic Exception also falls through (and logs).
  * Cost tracking : router populates cost_usd from token counts.
  * Cooldown : a failing provider is parked for COOLDOWN_SECONDS.
  * RuntimeError raised when every candidate is unavailable.
  * Real Gemini stub : verifies cost numbers + vision support match the
    AnalysisResult contract used by the analyzer today.
  * Real Cerebras stub : verifies it refuses vision tasks.
"""

from __future__ import annotations

import os
import sys

import pytest

# Add worker root to sys.path so `from services.ai_router import ...` works
# (matches the pattern used by every other test in this directory).
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from services.ai_router import (  # noqa: E402
    AIProvider,
    AIRouter,
    AITask,
    AnalysisResult,
    ProviderUnavailable,
    estimate_cost_usd,
)
from services.ai_providers import (  # noqa: E402
    AnthropicProvider,
    CerebrasProvider,
    GeminiProvider,
    OpenAIProvider,
)


# ─── MockProvider ────────────────────────────────────────────────────


class MockProvider:
    """A controllable AIProvider for routing-logic tests.

    Each test instantiates one or more of these with the exact behaviour
    it wants to assert : a fixed quota, a side-effect on call, a
    pre-baked AnalysisResult to return.
    """

    def __init__(
        self,
        name: str = "mock",
        model_name: str = "mock-1",
        cost_per_m_input: float = 1.0,
        cost_per_m_output: float = 1.0,
        supports_vision: bool = True,
        quota: int | None = 100,
        result: AnalysisResult | None = None,
        raises: Exception | None = None,
    ):
        self.name = name
        self.model_name = model_name
        self.cost_per_m_input = cost_per_m_input
        self.cost_per_m_output = cost_per_m_output
        self.supports_vision = supports_vision
        self._quota = quota
        self._result = result or AnalysisResult(
            highlight_score=7.5,
            tags=["solo_kill"],
            description="mock kill description",
            confidence=0.9,
            input_tokens=1000,
            output_tokens=100,
        )
        self._raises = raises
        self.call_count = 0

    async def analyze_clip(self, task: AITask) -> AnalysisResult:
        self.call_count += 1
        if self._raises is not None:
            raise self._raises
        # Return a fresh copy so tests can't pollute each other through
        # shared dataclass state.
        return AnalysisResult(
            highlight_score=self._result.highlight_score,
            tags=list(self._result.tags),
            description=self._result.description,
            confidence=self._result.confidence,
            input_tokens=self._result.input_tokens,
            output_tokens=self._result.output_tokens,
            raw_response=dict(self._result.raw_response),
        )

    async def quota_remaining(self) -> int | None:
        return self._quota


# ─── Construction guards ─────────────────────────────────────────────


def test_router_requires_at_least_one_provider():
    """An empty providers list is a programming error, not a runtime one."""
    with pytest.raises(ValueError):
        AIRouter([])


def test_provider_protocol_implemented_by_all_stubs():
    """Every shipped stub must satisfy the AIProvider Protocol.

    isinstance() against a runtime_checkable Protocol verifies the
    surface area : name, model_name, cost_per_m_input,
    cost_per_m_output, supports_vision, analyze_clip, quota_remaining.
    """
    for cls in (GeminiProvider, AnthropicProvider, OpenAIProvider, CerebrasProvider):
        instance = cls(api_key="test-key")
        assert isinstance(instance, AIProvider), (
            f"{cls.__name__} does not satisfy AIProvider Protocol"
        )


# ─── Selection logic ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_vision_task_excludes_non_vision_providers():
    """A vision task must NEVER reach Cerebras-class providers."""
    vision = MockProvider(name="vision-cap", supports_vision=True)
    text_only = MockProvider(name="text-only", supports_vision=False)
    router = AIRouter([text_only, vision])  # text-only listed first
    result = await router.route(AITask(prompt="x", requires_vision=True))
    assert result.provider_name == "vision-cap"
    assert text_only.call_count == 0
    assert vision.call_count == 1


@pytest.mark.asyncio
async def test_quota_zero_provider_skipped():
    """A provider with quota_remaining()=0 is excluded from the candidates."""
    drained = MockProvider(name="drained", quota=0,
                           cost_per_m_input=0.10)
    available = MockProvider(name="available", quota=500,
                             cost_per_m_input=1.00)
    router = AIRouter([drained, available])
    result = await router.route(AITask(prompt="x"))
    # Even though `drained` is cheaper, its quota=0 puts it out.
    assert result.provider_name == "available"
    assert drained.call_count == 0


@pytest.mark.asyncio
async def test_backfill_urgency_sorts_by_cost():
    """urgency='backfill' picks the cheapest eligible provider."""
    expensive = MockProvider(name="expensive", cost_per_m_input=5.00)
    cheap = MockProvider(name="cheap", cost_per_m_input=0.10)
    medium = MockProvider(name="medium", cost_per_m_input=1.00)
    # Order in providers list is intentionally NOT cost-ordered.
    router = AIRouter([expensive, medium, cheap])
    result = await router.route(AITask(prompt="x", urgency="backfill"))
    assert result.provider_name == "cheap"
    assert expensive.call_count == 0
    assert medium.call_count == 0


@pytest.mark.asyncio
async def test_daily_budget_ceiling_excludes_provider():
    """A provider whose daily budget is spent is excluded."""
    spent = MockProvider(name="spent",
                         cost_per_m_input=0.10,
                         cost_per_m_output=0.40)
    fresh = MockProvider(name="fresh", cost_per_m_input=1.00)
    router = AIRouter(
        [spent, fresh],
        daily_budget_usd={"spent": 0.001},  # tiny budget
    )
    # First call uses `spent` (under budget).
    await router.route(AITask(prompt="x"))
    # That single call cost ~$0.00014 (1000 in × $0.10/M + 100 out × $0.40/M)
    # which exceeds the $0.001 budget? Actually $0.00014 < $0.001, so spent
    # remains eligible. Let's make a tighter budget : $0.00001.
    router2 = AIRouter(
        [spent, fresh],
        daily_budget_usd={"spent": 0.00001},
    )
    spent.call_count = 0
    fresh.call_count = 0
    # First call with router2 — spent is initially unspent, so still picked.
    await router2.route(AITask(prompt="x"))
    assert spent.call_count == 1
    # Second call — spent is now over budget, fresh takes over.
    await router2.route(AITask(prompt="y"))
    assert fresh.call_count == 1
    assert spent.call_count == 1  # not called again


# ─── Fallback ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_fallback_on_provider_unavailable():
    """ProviderUnavailable from N rolls over to N+1."""
    primary = MockProvider(
        name="primary", cost_per_m_input=0.10,
        raises=ProviderUnavailable("simulated outage"),
    )
    secondary = MockProvider(name="secondary", cost_per_m_input=1.00)
    router = AIRouter([primary, secondary])
    result = await router.route(AITask(prompt="x"))
    assert result.provider_name == "secondary"
    assert primary.call_count == 1
    assert secondary.call_count == 1


@pytest.mark.asyncio
async def test_fallback_on_generic_exception():
    """An unexpected Exception is treated as a provider failure too."""
    primary = MockProvider(
        name="primary", cost_per_m_input=0.10,
        raises=RuntimeError("network down"),
    )
    secondary = MockProvider(name="secondary", cost_per_m_input=1.00)
    router = AIRouter([primary, secondary])
    result = await router.route(AITask(prompt="x"))
    assert result.provider_name == "secondary"


@pytest.mark.asyncio
async def test_all_providers_unavailable_raises_runtime_error():
    """If every candidate fails, the router raises RuntimeError so the
    analyzer can fail the pipeline_jobs row with a clear error code."""
    p1 = MockProvider(name="p1", raises=ProviderUnavailable("nope"))
    p2 = MockProvider(name="p2", raises=ProviderUnavailable("nope"))
    router = AIRouter([p1, p2])
    with pytest.raises(RuntimeError, match="all providers failed"):
        await router.route(AITask(prompt="x"))


@pytest.mark.asyncio
async def test_no_eligible_candidates_raises_runtime_error():
    """A vision task with only text-only providers has no candidates."""
    p1 = MockProvider(name="p1", supports_vision=False)
    router = AIRouter([p1])
    with pytest.raises(RuntimeError, match="no eligible provider"):
        await router.route(AITask(prompt="x", requires_vision=True))


@pytest.mark.asyncio
async def test_cooldown_after_failure():
    """A failed provider is parked for COOLDOWN_SECONDS."""
    primary = MockProvider(
        name="primary", cost_per_m_input=0.10,
        raises=ProviderUnavailable("simulated outage"),
    )
    secondary = MockProvider(name="secondary", cost_per_m_input=1.00)
    router = AIRouter([primary, secondary])
    # First call : primary fails, secondary succeeds.
    await router.route(AITask(prompt="x"))
    assert primary.call_count == 1
    # Second call IMMEDIATELY after : primary is in cooldown, so the
    # router skips straight to secondary — primary.call_count stays at 1.
    await router.route(AITask(prompt="y"))
    assert primary.call_count == 1
    assert secondary.call_count == 2


# ─── Cost tracking ───────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_router_populates_cost_usd_and_provenance():
    """The router stamps provider/model/cost/latency on the result."""
    provider = MockProvider(
        name="mock", model_name="mock-v2",
        cost_per_m_input=0.10, cost_per_m_output=0.40,
        result=AnalysisResult(
            highlight_score=8.0, tags=["clutch"], description="hello",
            confidence=0.85, input_tokens=2000, output_tokens=200,
        ),
    )
    router = AIRouter([provider])
    result = await router.route(AITask(prompt="x"))
    assert result.provider_name == "mock"
    assert result.model_name == "mock-v2"
    # 2000 in × $0.10/M + 200 out × $0.40/M = $0.0002 + $0.00008 = $0.00028
    assert result.cost_usd == pytest.approx(0.00028, rel=1e-3)
    assert result.latency_ms is not None
    assert result.latency_ms >= 0


@pytest.mark.asyncio
async def test_router_tracks_cumulative_spend():
    """spent_usd_today() reports running total per provider."""
    provider = MockProvider(
        name="mock",
        cost_per_m_input=1.0, cost_per_m_output=1.0,
        result=AnalysisResult(input_tokens=1_000_000, output_tokens=0),
    )
    router = AIRouter([provider])
    assert router.spent_usd_today("mock") == 0.0
    await router.route(AITask(prompt="x"))
    assert router.spent_usd_today("mock") == pytest.approx(1.0)
    await router.route(AITask(prompt="y"))
    assert router.spent_usd_today("mock") == pytest.approx(2.0)


def test_reset_daily_budget_wipes_ledger():
    """reset_daily_budget() clears spend AND cooldowns."""
    provider = MockProvider(name="mock")
    router = AIRouter([provider])
    router._spent_usd_today["mock"] = 99.0
    router._cooldowns["mock"] = 999_999.0
    router.reset_daily_budget()
    assert router.spent_usd_today("mock") == 0.0
    assert router._cooldowns == {}


# ─── estimate_cost_usd helper ───────────────────────────────────────


def test_estimate_cost_usd_handles_none_tokens():
    p = MockProvider(name="p", cost_per_m_input=0.10, cost_per_m_output=0.40)
    assert estimate_cost_usd(p, None, None) is None
    assert estimate_cost_usd(p, 1000, None) == pytest.approx(0.0001)
    assert estimate_cost_usd(p, None, 1000) == pytest.approx(0.0004)


def test_estimate_cost_usd_clamps_negative_inputs():
    p = MockProvider(name="p", cost_per_m_input=1.0, cost_per_m_output=1.0)
    # Defensive : a buggy provider returning -1 must not produce a
    # negative cost (the spend ledger would underflow).
    assert estimate_cost_usd(p, -100, -100) == 0.0


# ─── Real provider stubs ────────────────────────────────────────────


def test_gemini_provider_cost_constants():
    """The Gemini stub carries the rate-card prices the router uses for
    selection BEFORE the real call is wired."""
    p = GeminiProvider(api_key="fake")
    assert p.name == "gemini"
    assert p.model_name == "gemini-2.5-flash-lite"
    assert p.cost_per_m_input == 0.10
    assert p.cost_per_m_output == 0.40
    assert p.supports_vision is True


def test_anthropic_provider_cost_constants():
    p = AnthropicProvider(api_key="fake")
    assert p.name == "anthropic"
    assert p.cost_per_m_input == 1.00
    assert p.cost_per_m_output == 5.00
    assert p.supports_vision is True


def test_openai_provider_cost_constants():
    p = OpenAIProvider(api_key="fake", zero_data_retention=True)
    assert p.name == "openai"
    assert p.cost_per_m_input == 0.15
    assert p.cost_per_m_output == 0.60
    assert p.supports_vision is True


def test_cerebras_provider_no_vision():
    """The Cerebras stub MUST report supports_vision=False — that's
    what excludes it from vision routing in _select_candidates."""
    p = CerebrasProvider(api_key="fake")
    assert p.name == "cerebras"
    assert p.supports_vision is False


@pytest.mark.asyncio
async def test_phase2_remaining_stub_providers_still_raise():
    """Wave 11 status update : Anthropic + OpenAI are now real impls
    (see test_ai_providers_real.py). Only Gemini and Cerebras remain
    as phase-2 stubs ; their analyze_clip MUST still raise
    ProviderUnavailable so the router cleanly falls back to a real
    provider in production.

    This test pins the contract for the unfinished stubs so the next
    wave doesn't accidentally claim "wired" without shipping the SDK
    integration. Drop the cls from this loop when its phase-2 wiring
    is committed.
    """
    for cls in (GeminiProvider, CerebrasProvider):
        p = cls(api_key="fake")
        with pytest.raises(ProviderUnavailable, match="phase 2"):
            await p.analyze_clip(AITask(prompt="x", requires_vision=False))


@pytest.mark.asyncio
async def test_provider_no_api_key_returns_zero_quota(monkeypatch):
    """Without an API key, providers report quota=0 so the router skips
    them cleanly without raising. The operator can ship the worker with
    only one or two provider keys configured and the others stay quiet.

    We strip the env vars first so a developer machine that happens to
    have GEMINI_API_KEY set in the shell doesn't make the test pass for
    the wrong reason.
    """
    for env_var in ("GEMINI_API_KEY", "ANTHROPIC_API_KEY",
                    "OPENAI_API_KEY", "CEREBRAS_API_KEY"):
        monkeypatch.delenv(env_var, raising=False)
    for cls in (GeminiProvider, AnthropicProvider, OpenAIProvider, CerebrasProvider):
        p = cls(api_key="")
        assert await p.quota_remaining() == 0, (
            f"{cls.__name__} with no key must report quota=0, "
            f"got {await p.quota_remaining()}"
        )


@pytest.mark.asyncio
async def test_openai_refuses_without_zero_data_retention():
    """OpenAI refuses calls until ZDR is explicitly affirmed — the
    EU-content privacy guard documented in the multi-provider doc.

    Wave 11 update : analyze_clip now refuses vision FIRST (delegates
    to analyze_text for non-vision), so we exercise the ZDR guard
    via analyze_text directly to avoid the vision-refusal short-circuit.
    """
    p = OpenAIProvider(api_key="fake", zero_data_retention=False)
    with pytest.raises(ProviderUnavailable, match="zero_data_retention"):
        await p.analyze_text("x")


@pytest.mark.asyncio
async def test_cerebras_refuses_vision_task_defensively():
    """Even if the router somehow routes a vision task to Cerebras
    (shouldn't happen — selection filters it out), Cerebras refuses."""
    p = CerebrasProvider(api_key="fake")
    with pytest.raises(ProviderUnavailable, match="vision"):
        await p.analyze_clip(AITask(prompt="x", requires_vision=True))
