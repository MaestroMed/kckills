"""AnthropicProvider — Anthropic Claude Haiku 4.5.

Wave 11 promotion : `analyze_text` is now a real implementation using
the official `anthropic` Python SDK. `analyze_clip` still refuses
vision-on-clip tasks with a clear ProviderUnavailable("clip-vision...")
because the keyframe-extraction pipeline isn't wired here yet (the
analyzer module owns that).

Routing role
------------
* PII-safe : Anthropic's enterprise tier comes with a no-train DPA.
  Router prefers Anthropic for has_pii=True tasks (user comment
  moderation, sensitive translations).
* EU data plane available — Anthropic operates in eu-central-1.
* Cost : $1.00/M input, $5.00/M output. Most expensive of the text
  providers, so the router only picks Anthropic for moderation /
  PII-safe text tasks ; backfill text routes to DeepSeek/Grok.

The `import anthropic` is intentionally lazy (inside analyze_text) so
the test suite can patch sys.modules['anthropic'] BEFORE the import
fires.
"""

from __future__ import annotations

import json
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
    # Wave 11 — Anthropic is on US enterprise tier with PII-friendly DPA.
    # Router will route has_pii=True tasks (user comment moderation) here.
    is_pii_safe: bool = True

    DEFAULT_MAX_TOKENS: int = 1024

    def __init__(self, api_key: str | None = None):
        self.api_key = api_key or os.environ.get("ANTHROPIC_API_KEY") or ""

    async def analyze_clip(self, task: AITask) -> AnalysisResult:
        """Route to analyze_text for non-vision tasks ; refuse vision.

        Anthropic supports vision on Claude Haiku, but our pipeline
        sends video URLs not keyframes — extracting keyframes via ffmpeg
        is the analyzer module's responsibility. Until that wiring lands,
        we surface a clear ProviderUnavailable("clip-vision ...") so the
        router falls back to Gemini (which DOES handle MP4 directly).
        """
        if task.requires_vision:
            raise ProviderUnavailable(
                "anthropic: clip-vision pipeline not wired yet "
                "(analyzer must extract keyframes first)"
            )
        return await self.analyze_text(task.prompt, system=task.system)

    async def analyze_text(
        self, prompt: str, system: str | None = None,
    ) -> AnalysisResult:
        """Run a text-only call via the Anthropic SDK.

        The SDK's `messages.create` is synchronous — we call it without
        an asyncio executor for now (the provider is the slow path so
        the worker's loop blocks fine ; future improvement is run_in_
        executor when traffic justifies it). Errors from the SDK become
        ProviderUnavailable so the router can fall back.
        """
        if not self.api_key:
            raise ProviderUnavailable("anthropic: no API key configured")

        # Lazy import so tests can patch sys.modules['anthropic'].
        try:
            import anthropic  # type: ignore
        except ImportError as e:
            raise ProviderUnavailable(
                f"anthropic: SDK not installed ({e})"
            )

        client = anthropic.Anthropic(api_key=self.api_key)
        try:
            msg = client.messages.create(
                model=self.model_name,
                max_tokens=self.DEFAULT_MAX_TOKENS,
                system=system or "",
                messages=[{"role": "user", "content": prompt}],
            )
        except Exception as e:
            raise ProviderUnavailable(
                f"anthropic: SDK call failed: {type(e).__name__}: "
                f"{str(e)[:160]}"
            )

        # Extract text content. Claude returns content blocks ; the first
        # text block is what we want for translation / moderation.
        text = ""
        try:
            content = getattr(msg, "content", None) or []
            if content:
                first = content[0]
                text = (getattr(first, "text", None) or "").strip()
        except Exception as e:
            raise ProviderUnavailable(
                f"anthropic: malformed SDK response: {e}"
            )

        # Strip ```json fences (Haiku occasionally wraps despite "JSON only").
        # Wave 27.6 — use the shared strip_json_fence which handles
        # leading commentary, missing closing fence, and tilde fences
        # the old startswith("```") guard rejected outright.
        from services.ai_providers._text_utils import strip_json_fence
        text = strip_json_fence(text)

        # Optional JSON parse for callers that expect structured output.
        parsed: dict | None = None
        if text.startswith("{") or text.startswith("["):
            try:
                parsed = json.loads(text)
            except json.JSONDecodeError:
                parsed = None

        usage = getattr(msg, "usage", None)
        input_tokens = getattr(usage, "input_tokens", None) if usage else None
        output_tokens = getattr(usage, "output_tokens", None) if usage else None

        return AnalysisResult(
            text=text,
            description=text,
            highlight_score=parsed.get("highlight_score")
                if isinstance(parsed, dict) else None,
            tags=list(parsed.get("tags") or [])
                if isinstance(parsed, dict) else [],
            confidence=parsed.get("confidence_score")
                if isinstance(parsed, dict) else None,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            raw_response={
                "text": text,
                "parsed": parsed,
                "model": getattr(msg, "model", self.model_name),
                "stop_reason": getattr(msg, "stop_reason", None),
            },
        )

    async def quota_remaining(self) -> int | None:
        """Return None — Anthropic paid tier has no daily-call ceiling
        we track locally. The router relies on the daily_budget_usd
        ceiling (configured per-provider) to throttle spend.
        """
        if not self.api_key:
            return 0
        return None
