"""GeminiProvider — Google Gemini 2.5 Flash-Lite stub.

Phase 1 : skeleton implementing services.ai_router.AIProvider.
analyze_clip() raises ProviderUnavailable until phase 2 wires the real
SDK call (the existing services.gemini_client.analyze function).

The cost numbers and quota policy here are the source of truth for the
router's selection logic — even before the real call is wired, the router
makes correct decisions because it knows Gemini Flash-Lite is the cheapest
vision-capable provider AND has a 1000 RPD ceiling on free tier.
"""

from __future__ import annotations

import os

import structlog

from services.ai_router import (
    AIProvider,
    AITask,
    AnalysisResult,
    ProviderUnavailable,
)

log = structlog.get_logger()


class GeminiProvider:
    """Implements AIProvider for Google Gemini 2.5 Flash-Lite."""

    name: str = "gemini"
    model_name: str = "gemini-2.5-flash-lite"
    # USD per 1M tokens — see ai_pricing.GEMINI_PRICES (single source of truth).
    cost_per_m_input: float = 0.10
    cost_per_m_output: float = 0.40
    supports_vision: bool = True
    # Wave 11 — Google Cloud paid tier is PII-friendly. Free tier has
    # the "may be used for training" clause so callers should NOT route
    # has_pii=True tasks here when on free tier ; the production deploy
    # uses paid keys exclusively, so this stays True.
    is_pii_safe: bool = True

    # Daily ceiling on free tier ; phase 2 reads the actual remaining
    # count from `scheduler.get_remaining("gemini")` so the router knows
    # when to fall back to Anthropic.
    DEFAULT_DAILY_CAP: int = 950  # 5% margin under the 1000 RPD limit

    def __init__(self, api_key: str | None = None,
                 daily_cap: int | None = None):
        self.api_key = api_key or os.environ.get("GEMINI_API_KEY") or ""
        self.daily_cap = daily_cap if daily_cap is not None else self.DEFAULT_DAILY_CAP
        # Tracked locally so quota_remaining can return a meaningful value
        # even when the global scheduler isn't available (e.g. in tests).
        self._calls_today: int = 0

    async def analyze_clip(self, task: AITask) -> AnalysisResult:
        """STUB — phase 2 wires services.gemini_client.analyze.

        Phase 2 sketch :
            from services import gemini_client
            raw = await gemini_client.analyze(task.prompt, task.clip_url)
            if raw is None:
                raise ProviderUnavailable("gemini returned None")
            return AnalysisResult(
                highlight_score=raw.get("highlight_score"),
                tags=raw.get("tags") or [],
                description=raw.get("description_fr"),
                confidence=raw.get("confidence_score"),
                input_tokens=raw.get("_usage", {}).get("prompt_tokens"),
                output_tokens=raw.get("_usage", {}).get("candidates_tokens"),
                raw_response=raw,
            )
        """
        if not self.api_key:
            raise ProviderUnavailable("gemini: no API key configured")
        log.info("gemini_provider_stub_called", urgency=task.urgency)
        raise ProviderUnavailable("router phase 2")

    async def quota_remaining(self) -> int | None:
        """Return approximate calls left in the daily budget.

        Phase 2 :
            from scheduler import scheduler
            return scheduler.get_remaining("gemini")

        Phase 1 (today) : derived from the local _calls_today counter.
        Returns None if no API key is set so the router skips us cleanly.
        """
        if not self.api_key:
            return 0
        return max(0, self.daily_cap - self._calls_today)
