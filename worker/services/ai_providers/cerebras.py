"""CerebrasProvider — Cerebras Llama 3.3 70B stub (NO vision).

Phase 1 : skeleton implementing services.ai_router.AIProvider.
analyze_clip() raises ProviderUnavailable until phase 2 wires the
real `cerebras-cloud-sdk` call.

Cerebras runs Llama 3.3 70B at ~2000 tokens/second — 30x faster than
any vision-capable provider. We use it ONLY for text-only tasks :
re-tagging from existing descriptions, summarising highlights for the
"kill of the week" digest, and any future editorial copy generation.

The router excludes Cerebras from vision tasks via
supports_vision=False — see the `_select_candidates` filter logic in
ai_router.py.
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


class CerebrasProvider:
    """Implements AIProvider for Cerebras Llama 3.3 70B (text only)."""

    name: str = "cerebras"
    model_name: str = "llama-3.3-70b"
    # USD per 1M tokens at the published Cerebras rate.
    cost_per_m_input: float = 0.60
    cost_per_m_output: float = 0.60
    supports_vision: bool = False  # critical — router uses this to skip us

    def __init__(self, api_key: str | None = None):
        self.api_key = api_key or os.environ.get("CEREBRAS_API_KEY") or ""

    async def analyze_clip(self, task: AITask) -> AnalysisResult:
        """STUB — phase 2 wires the cerebras-cloud-sdk SDK.

        Phase 2 sketch :
            from cerebras.cloud.sdk import AsyncCerebras
            client = AsyncCerebras(api_key=self.api_key)
            resp = await client.chat.completions.create(
                model=self.model_name,
                messages=[{"role": "user", "content": task.prompt}],
                response_format={"type": "json_object"},
                max_tokens=400,
            )
            payload = json.loads(resp.choices[0].message.content)
            return AnalysisResult(
                highlight_score=payload.get("highlight_score"),
                tags=payload.get("tags") or [],
                description=payload.get("description_fr"),
                confidence=payload.get("confidence_score"),
                input_tokens=resp.usage.prompt_tokens,
                output_tokens=resp.usage.completion_tokens,
                raw_response=payload,
            )

        Defensive guard : Cerebras has no vision capability, so the
        router should never even reach us with task.requires_vision=True.
        We re-check here as a belt-and-suspenders measure.
        """
        if task.requires_vision:
            raise ProviderUnavailable(
                "cerebras: vision required but unsupported"
            )
        if not self.api_key:
            raise ProviderUnavailable("cerebras: no API key configured")
        log.info("cerebras_provider_stub_called", urgency=task.urgency)
        raise ProviderUnavailable("router phase 2")

    async def quota_remaining(self) -> int | None:
        """Return None — Cerebras paid tier has no daily-call ceiling
        we track locally. The router relies on daily_budget_usd.
        """
        if not self.api_key:
            return 0
        return None
