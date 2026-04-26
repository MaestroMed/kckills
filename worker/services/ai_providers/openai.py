"""OpenAIProvider — OpenAI gpt-4o-mini.

Wave 11 promotion : `analyze_text` is now a real implementation using
the OpenAI-compatible chat completions HTTP endpoint (api.openai.com/v1).
We use httpx directly rather than the openai SDK to share the same
backoff + parse logic with DeepSeek/Grok — all three vendors expose
the same wire protocol so one path covers them all.

ZDR contract enforcement
------------------------
OpenAI's standard API retains prompts for 30 days for abuse-detection.
EU-origin user content (comments, IGN-personalized prompts) crosses a
GDPR boundary unless the operator has signed a Zero Data Retention
addendum with OpenAI. We refuse calls with a clear ProviderUnavailable
message until `zero_data_retention=True` is passed at construction.

Routing role
------------
* Vision-capable but currently the analyzer pipeline doesn't extract
  keyframes for non-Gemini vision providers, so analyze_clip refuses
  vision tasks the same way Anthropic does.
* PII-safe iff ZDR is on (see is_pii_safe property).
* Cost : $0.15/M input, $0.60/M output. Cheaper than Anthropic, more
  expensive than DeepSeek/Grok.
"""

from __future__ import annotations

import asyncio
import json
import os

import httpx
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

    BASE_URL: str = "https://api.openai.com/v1"
    DEFAULT_TIMEOUT: float = 30.0
    MAX_RETRIES: int = 3
    BACKOFF_BASE: float = 1.0  # seconds, doubles each retry

    def __init__(self, api_key: str | None = None,
                 zero_data_retention: bool = False,
                 base_url: str | None = None):
        self.api_key = api_key or os.environ.get("OPENAI_API_KEY") or ""
        # The operator must explicitly affirm a ZDR contract is in place
        # before the router will use this provider for EU-origin tasks.
        # Default False = safe by default.
        self.zero_data_retention = zero_data_retention
        self.base_url = (base_url or self.BASE_URL).rstrip("/")

    @property
    def is_pii_safe(self) -> bool:
        """Wave 11 — OpenAI is PII-safe ONLY if Zero Data Retention is on.

        OpenAI's standard API retains prompts for 30 days for abuse-detection
        unless the customer signs a ZDR addendum. The router will refuse to
        route has_pii=True tasks here unless `zero_data_retention=True` was
        passed at construction time (operator-level affirmation).
        """
        return bool(self.zero_data_retention)

    async def analyze_clip(self, task: AITask) -> AnalysisResult:
        """Route to analyze_text for non-vision tasks ; refuse vision.

        Vision support is gated behind keyframe extraction in the
        analyzer module, which currently only feeds Gemini. Until that
        wiring exists for OpenAI, we surface a ProviderUnavailable
        message so the router falls back to Gemini.
        """
        if task.requires_vision:
            raise ProviderUnavailable(
                "openai: clip-vision pipeline not wired yet "
                "(analyzer must extract keyframes first)"
            )
        return await self.analyze_text(task.prompt, system=task.system)

    async def analyze_text(
        self, prompt: str, system: str | None = None,
    ) -> AnalysisResult:
        """Run a text-only call via OpenAI chat completions endpoint.

        Same wire protocol as DeepSeek/Grok (OpenAI invented it). Refuses
        if ZDR isn't affirmed — the operator must pass
        `zero_data_retention=True` to the constructor before any call,
        even for AI-generated (non-PII) text. We err on the side of the
        EU privacy contract being explicit.
        """
        if not self.zero_data_retention:
            raise ProviderUnavailable(
                "openai: zero_data_retention not affirmed; refusing call"
            )
        if not self.api_key:
            raise ProviderUnavailable("openai: no API key configured")

        messages: list[dict] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        body = {
            "model": self.model_name,
            "messages": messages,
            "max_tokens": 1024,
        }

        last_error: str | None = None
        payload: dict | None = None
        for attempt in range(self.MAX_RETRIES):
            try:
                async with httpx.AsyncClient(timeout=self.DEFAULT_TIMEOUT) as client:
                    resp = await client.post(
                        f"{self.base_url}/chat/completions",
                        headers={
                            "Authorization": f"Bearer {self.api_key}",
                            "Content-Type": "application/json",
                        },
                        json=body,
                    )
                    if resp.status_code >= 500 or resp.status_code == 429:
                        last_error = f"HTTP {resp.status_code} — {resp.text[:200]}"
                        if attempt < self.MAX_RETRIES - 1:
                            backoff = self.BACKOFF_BASE * (2 ** attempt)
                            log.warn(
                                "openai_retry",
                                attempt=attempt + 1,
                                backoff=backoff,
                                status=resp.status_code,
                            )
                            await asyncio.sleep(backoff)
                            continue
                        raise ProviderUnavailable(f"openai: {last_error}")
                    if resp.status_code >= 400:
                        raise ProviderUnavailable(
                            f"openai: HTTP {resp.status_code} — {resp.text[:200]}"
                        )
                    payload = resp.json()
                    break  # success
            except ProviderUnavailable:
                raise
            except (httpx.HTTPError, asyncio.TimeoutError) as e:
                last_error = f"{type(e).__name__}: {e}"
                if attempt < self.MAX_RETRIES - 1:
                    backoff = self.BACKOFF_BASE * (2 ** attempt)
                    log.warn(
                        "openai_retry_network",
                        attempt=attempt + 1,
                        backoff=backoff,
                        error=str(e)[:120],
                    )
                    await asyncio.sleep(backoff)
                    continue
                raise ProviderUnavailable(f"openai: network error: {last_error}")

        if payload is None:
            raise ProviderUnavailable("openai: empty payload after retries")

        try:
            choice = payload["choices"][0]
            text = (choice.get("message") or {}).get("content") or ""
            usage = payload.get("usage") or {}
            input_tokens = usage.get("prompt_tokens")
            output_tokens = usage.get("completion_tokens")
        except (KeyError, IndexError, TypeError) as e:
            raise ProviderUnavailable(f"openai: malformed response: {e}")

        text = text.strip()
        if text.startswith("```"):
            parts = text.split("```")
            if len(parts) >= 2:
                inner = parts[1]
                if inner.startswith("json"):
                    inner = inner[4:]
                text = inner.strip()

        parsed: dict | None = None
        if text.startswith("{") or text.startswith("["):
            try:
                parsed = json.loads(text)
            except json.JSONDecodeError:
                parsed = None

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
            raw_response={"text": text, "parsed": parsed,
                          "model": payload.get("model")},
        )

    async def quota_remaining(self) -> int | None:
        """Return None — OpenAI paid tier has no published daily-call
        ceiling we track locally. The router relies on daily_budget_usd.
        """
        if not self.api_key:
            return 0
        return None
