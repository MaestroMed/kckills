"""OpenAIProvider — OpenAI gpt-4o-mini stub.

Phase 1 : skeleton implementing services.ai_router.AIProvider.
analyze_clip() raises ProviderUnavailable until phase 2 wires the
real `openai` SDK call.

OpenAI is the third vision-capable fallback. Note the EU privacy
caveat documented in `docs/loltok-ai-multi-provider.md` — the operator
must sign a Zero Data Retention agreement with OpenAI before routing
EU-content traffic here, otherwise we cross a GDPR boundary the rest
of the stack carefully avoids.
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


class OpenAIProvider:
    """Implements AIProvider for OpenAI gpt-4o-mini."""

    name: str = "openai"
    model_name: str = "gpt-4o-mini"
    # USD per 1M tokens at the published OpenAI rate.
    cost_per_m_input: float = 0.15
    cost_per_m_output: float = 0.60
    supports_vision: bool = True

    def __init__(self, api_key: str | None = None,
                 zero_data_retention: bool = False):
        self.api_key = api_key or os.environ.get("OPENAI_API_KEY") or ""
        # The operator must explicitly affirm a ZDR contract is in place
        # before the router will use this provider for EU-origin tasks.
        # Default False = safe by default.
        self.zero_data_retention = zero_data_retention

    async def analyze_clip(self, task: AITask) -> AnalysisResult:
        """STUB — phase 2 wires the openai SDK.

        Phase 2 sketch :
            import openai
            client = openai.AsyncOpenAI(api_key=self.api_key)
            messages = [{"role": "user", "content": [
                {"type": "text", "text": task.prompt},
            ]}]
            if task.clip_url:
                # OpenAI accepts video frames as image_url blocks.
                # Same keyframe extraction as Anthropic.
                messages[0]["content"].append({
                    "type": "image_url",
                    "image_url": {"url": "data:image/jpeg;base64,..."},
                })
            resp = await client.chat.completions.create(
                model=self.model_name,
                messages=messages,
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
        """
        if not self.api_key:
            raise ProviderUnavailable("openai: no API key configured")
        if not self.zero_data_retention:
            raise ProviderUnavailable(
                "openai: zero_data_retention not affirmed; refusing EU traffic"
            )
        log.info("openai_provider_stub_called", urgency=task.urgency)
        raise ProviderUnavailable("router phase 2")

    async def quota_remaining(self) -> int | None:
        """Return None — OpenAI paid tier has no published daily-call
        ceiling we track locally. The router relies on daily_budget_usd.
        """
        if not self.api_key:
            return 0
        return None
