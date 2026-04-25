"""AnthropicProvider — Anthropic Claude Haiku 4.5 stub.

Phase 1 : skeleton implementing services.ai_router.AIProvider.
analyze_clip() raises ProviderUnavailable until phase 2 wires the
real `anthropic` SDK call.

Haiku 4.5 is the natural fallback when Gemini Flash-Lite quota is
exhausted or its quality dips. EU-friendly (Anthropic operates a
EU data plane) so it's the preferred secondary for European traffic.
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


class AnthropicProvider:
    """Implements AIProvider for Claude Haiku 4.5."""

    name: str = "anthropic"
    model_name: str = "claude-haiku-4-5-20251001"
    # USD per 1M tokens at the published Anthropic rate.
    cost_per_m_input: float = 1.00
    cost_per_m_output: float = 5.00
    supports_vision: bool = True

    def __init__(self, api_key: str | None = None):
        self.api_key = api_key or os.environ.get("ANTHROPIC_API_KEY") or ""

    async def analyze_clip(self, task: AITask) -> AnalysisResult:
        """STUB — phase 2 wires the anthropic SDK.

        Phase 2 sketch :
            import anthropic, base64
            client = anthropic.Anthropic(api_key=self.api_key)
            content_blocks = [{"type": "text", "text": task.prompt}]
            if task.clip_url:
                # Anthropic accepts video frames as base64 image blocks.
                # The analyzer would extract 4-8 keyframes via ffmpeg
                # and encode each as image/jpeg.
                content_blocks.append({"type": "image", "source": ...})
            msg = client.messages.create(
                model=self.model_name,
                max_tokens=400,
                messages=[{"role": "user", "content": content_blocks}],
            )
            payload = json.loads(msg.content[0].text)
            return AnalysisResult(
                highlight_score=payload.get("highlight_score"),
                tags=payload.get("tags") or [],
                description=payload.get("description_fr"),
                confidence=payload.get("confidence_score"),
                input_tokens=msg.usage.input_tokens,
                output_tokens=msg.usage.output_tokens,
                raw_response=payload,
            )

        Special case for backfill: route via the Anthropic batch API
        (50% discount, 24h SLA). Implementation detail for phase 2 —
        the router signals batch eligibility via task.urgency='backfill'.
        """
        if not self.api_key:
            raise ProviderUnavailable("anthropic: no API key configured")
        log.info("anthropic_provider_stub_called", urgency=task.urgency)
        raise ProviderUnavailable("router phase 2")

    async def quota_remaining(self) -> int | None:
        """Return None — Anthropic paid tier has no daily-call ceiling
        we track locally. The router relies on the daily_budget_usd
        ceiling (configured per-provider) to throttle spend.
        """
        if not self.api_key:
            return 0
        return None
