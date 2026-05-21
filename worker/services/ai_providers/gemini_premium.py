"""GeminiPremiumProvider — Gemini 3.5 Flash (Wave 33 — premium tier).

Thin subclass of `GeminiProvider` that hard-codes the model to
`gemini-3.5-flash` and surfaces the thinking-budget control from
`config.GEMINI_THINKING_BUDGET`. Lets the router pick this provider
explicitly for high-stakes / agentic tasks without having to mutate the
global `GEMINI_MODEL_*` env vars.

Use case from the router :

    router = AIRouter([
        GeminiPremiumProvider(),    # gemini-3.5-flash
        GeminiProvider(),           # whatever GEMINI_MODEL_QC resolves to
        # ... fallback chain
    ])

Caller chooses by setting `task.preferred_provider="gemini_premium"` or
by letting the router rank-by-cost (premium is more expensive so it'll
only be picked when explicitly requested or when other providers are
out of quota).
"""

from __future__ import annotations

import os

import structlog

from services.ai_providers.gemini import GeminiProvider
from services.ai_router import AITask, AnalysisResult, ProviderUnavailable

log = structlog.get_logger()


class GeminiPremiumProvider(GeminiProvider):
    """Gemini 3.5 Flash provider with thinking-budget control."""

    name: str = "gemini_premium"
    model_name: str = "gemini-3.5-flash"
    # USD per 1M tokens — see ai_pricing.GEMINI_PRICES. Stays in sync
    # with the table at __init__ via the parent's re-pricing logic.
    cost_per_m_input: float = 1.50
    cost_per_m_output: float = 9.00
    supports_vision: bool = True
    is_pii_safe: bool = True

    # 3.5 Flash inherits the same shared 950 RPD bucket — same scheduler
    # key, same paid-tier quota. Calling this provider in addition to
    # the standard GeminiProvider just routes through the same daily
    # budget, no double-counting.
    DEFAULT_DAILY_CAP: int = 950

    def __init__(self, api_key: str | None = None,
                 daily_cap: int | None = None,
                 thinking_budget: str | None = None):
        # Pin the model so the parent constructor doesn't override it
        # with config.GEMINI_MODEL_QC.
        super().__init__(
            api_key=api_key,
            daily_cap=daily_cap,
            model_name="gemini-3.5-flash",
        )
        # Resolve thinking budget : explicit arg > env config > "medium".
        if thinking_budget is not None:
            self.thinking_budget = thinking_budget
        else:
            try:
                from config import config as _cfg
                self.thinking_budget = (
                    getattr(_cfg, "GEMINI_THINKING_BUDGET", None) or "medium"
                )
            except Exception:
                self.thinking_budget = "medium"

    async def analyze_clip(self, task: AITask) -> AnalysisResult:
        """Forward to gemini_client.analyze with model + thinking budget pinned.

        Same failure surface as the parent — ProviderUnavailable on any
        SDK / quota / parse error so the router falls back to the next
        provider (typically the standard GeminiProvider on 3-flash or
        3.1-flash-lite).
        """
        if not self.api_key:
            raise ProviderUnavailable("gemini_premium: no API key configured")

        from services import gemini_client

        video_path = task.clip_url if task.requires_vision else None
        try:
            raw = await gemini_client.analyze(
                task.prompt,
                video_path=video_path,
                model=self.model_name,
                thinking_budget=self.thinking_budget,
            )
        except Exception as e:
            log.warn("gemini_premium_threw", error=str(e)[:200])
            raise ProviderUnavailable(
                f"gemini_premium exception: {type(e).__name__}"
            ) from e

        if raw is None:
            raise ProviderUnavailable("gemini_premium returned None")

        usage = raw.get("_usage") or {}
        return AnalysisResult(
            highlight_score=raw.get("highlight_score"),
            tags=raw.get("tags") or [],
            description=raw.get("description_fr") or raw.get("description"),
            confidence=raw.get("confidence_score") or raw.get("confidence"),
            input_tokens=usage.get("prompt_tokens"),
            output_tokens=usage.get("candidates_tokens"),
            raw_response=raw,
            text=raw.get("text") if isinstance(raw.get("text"), str) else None,
        )
