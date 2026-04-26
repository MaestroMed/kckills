"""GrokProvider — xAI Grok 4.1 Fast (production, NO vision, NOT PII-safe).

Wave 11 NEW provider. OpenAI-compatible endpoint at api.x.ai.

Routing role
------------
* Second-cheapest text provider after DeepSeek :
    Grok 4.1 Fast : $0.20/M input, $0.50/M output (live verified
    2026-04-25). 2M context window — even bigger than DeepSeek's 1M.
* Backup for DeepSeek when DeepSeek is rate-limited or in cooldown.
  Same routing class : non-PII text tasks.
* NO vision support on the Fast tier (Grok Vision is the bigger model
  at higher cost — out of scope for the cheap-text routing wave).
* NOT PII-safe : xAI's data handling for non-enterprise customers
  doesn't yet meet the EU bar we hold OpenAI/Anthropic to. Refused for
  any task with has_pii=True.
"""

from __future__ import annotations

import asyncio
import json
import os

import httpx
import structlog

from services.ai_router import (
    AITask,
    AnalysisResult,
    ProviderUnavailable,
)

log = structlog.get_logger()


class GrokProvider:
    """Implements AIProvider for xAI Grok 4.1 Fast (text only, non-PII)."""

    name: str = "grok"
    model_name: str = "grok-4-fast"  # the published model id on api.x.ai
    cost_per_m_input: float = 0.20
    cost_per_m_output: float = 0.50
    supports_vision: bool = False
    is_pii_safe: bool = False

    BASE_URL: str = "https://api.x.ai/v1"
    DEFAULT_TIMEOUT: float = 30.0
    MAX_RETRIES: int = 3
    BACKOFF_BASE: float = 1.0  # seconds, doubles each retry

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        model: str | None = None,
    ):
        self.api_key = api_key or os.environ.get("KCKILLS_GROK_API_KEY") or ""
        self.base_url = (base_url or self.BASE_URL).rstrip("/")
        if model:
            self.model_name = model
        elif os.environ.get("GROK_MODEL"):
            self.model_name = os.environ["GROK_MODEL"]

    async def analyze_clip(self, task: AITask) -> AnalysisResult:
        """Grok 4.1 Fast has no vision support. Refuse loudly.

        Forwards `task.system` to analyze_text so prompt-engineered
        daemons (translator) can prepend role / output-format guidance.
        """
        if task.requires_vision:
            raise ProviderUnavailable(
                "grok: vision required but unsupported (4.1 Fast)"
            )
        return await self.analyze_text(task.prompt, system=task.system)

    async def analyze_text(
        self, prompt: str, system: str | None = None,
    ) -> AnalysisResult:
        """Run a text-only call via Grok OpenAI-compatible endpoint.

        Mirrors the DeepSeek implementation : exponential backoff on
        5xx + 429, immediate surface on 4xx auth errors.
        """
        if not self.api_key:
            raise ProviderUnavailable("grok: no API key configured")

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
                                "grok_retry",
                                attempt=attempt + 1,
                                backoff=backoff,
                                status=resp.status_code,
                            )
                            await asyncio.sleep(backoff)
                            continue
                        raise ProviderUnavailable(f"grok: {last_error}")
                    if resp.status_code >= 400:
                        raise ProviderUnavailable(
                            f"grok: HTTP {resp.status_code} — {resp.text[:200]}"
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
                        "grok_retry_network",
                        attempt=attempt + 1,
                        backoff=backoff,
                        error=str(e)[:120],
                    )
                    await asyncio.sleep(backoff)
                    continue
                raise ProviderUnavailable(f"grok: network error: {last_error}")

        try:
            choice = payload["choices"][0]
            text = (choice.get("message") or {}).get("content") or ""
            usage = payload.get("usage") or {}
            input_tokens = usage.get("prompt_tokens")
            output_tokens = usage.get("completion_tokens")
        except (KeyError, IndexError, TypeError) as e:
            raise ProviderUnavailable(f"grok: malformed response: {e}")

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
            highlight_score=parsed.get("highlight_score") if isinstance(parsed, dict) else None,
            tags=list(parsed.get("tags") or []) if isinstance(parsed, dict) else [],
            confidence=parsed.get("confidence_score") if isinstance(parsed, dict) else None,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            raw_response={"text": text, "parsed": parsed, "model": payload.get("model")},
        )

    async def quota_remaining(self) -> int | None:
        """Return None — Grok paid tier has no published daily-call
        ceiling we track locally. The router relies on daily_budget_usd.
        """
        if not self.api_key:
            return 0
        return None
