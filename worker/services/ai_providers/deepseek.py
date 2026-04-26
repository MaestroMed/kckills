"""DeepSeekProvider — DeepSeek V4 Flash (production, NO vision, NOT PII-safe).

Wave 11 NEW provider. OpenAI-compatible endpoint at api.deepseek.com.

Routing role
------------
* Cheapest text provider on the worker by a wide margin :
    DeepSeek V4 Flash : $0.14/M input, $0.028/M cache hit, $0.28/M output
    Compare : Cerebras $0.60/$0.60, OpenAI $0.15/$0.60, Gemini $0.10/$0.40,
              Anthropic $1.00/$5.00.
  → Wins for backfill text tasks (translator FR→EN/KO/ES) and any
  non-PII text classification.
* DeepSeek V4 Pro -75% promo until 5 mai 2026 = $0.435/M input, $0.87/M
  output. We default to V4 Flash for backfill ; Pro is selectable via
  the DEEPSEEK_MODEL env override for higher-quality work.
* 1M context window — fits entire match transcripts if we ever need it.
* NO vision support. The router filters us out of vision tasks via
  supports_vision=False.
* NOT PII-safe : Chinese jurisdiction. The router refuses to send any
  task with has_pii=True here, regardless of cost. User comments stay
  on Anthropic Haiku.
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


class DeepSeekProvider:
    """Implements AIProvider for DeepSeek V4 Flash (text only, non-PII)."""

    name: str = "deepseek"
    # V4 Flash by default. Set DEEPSEEK_MODEL=deepseek-v4-pro to switch
    # to the higher-quality (still discounted until 5 mai) tier.
    model_name: str = "deepseek-chat"  # alias for V4 Flash on the API
    # USD per 1M tokens — V4 Flash standard rate (live verified 2026-04-25).
    cost_per_m_input: float = 0.14
    cost_per_m_output: float = 0.28
    # Cache-hit input cost (we don't currently use prompt caching so this
    # is documented but unused in router math).
    cost_per_m_input_cache_hit: float = 0.028
    supports_vision: bool = False  # critical — no vision on V4 Flash
    is_pii_safe: bool = False      # critical — Chinese jurisdiction

    BASE_URL: str = "https://api.deepseek.com/v1"
    DEFAULT_TIMEOUT: float = 30.0
    MAX_RETRIES: int = 3
    BACKOFF_BASE: float = 1.0  # seconds, doubles each retry

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        model: str | None = None,
    ):
        self.api_key = (
            api_key or os.environ.get("KCKILLS_DEEPSEEK_API_KEY") or ""
        )
        self.base_url = (base_url or self.BASE_URL).rstrip("/")
        # Operator can switch to V4 Pro via env (pricier but higher quality).
        env_model = os.environ.get("DEEPSEEK_MODEL")
        if model:
            self.model_name = model
        elif env_model:
            self.model_name = env_model
            # If they pick V4 Pro, bump the rate-card numbers used by
            # estimate_cost_usd. The user explicitly approved the Pro
            # promo pricing in the wave brief.
            if "pro" in env_model.lower():
                self.cost_per_m_input = 0.435
                self.cost_per_m_output = 0.87

    async def analyze_clip(self, task: AITask) -> AnalysisResult:
        """DeepSeek V4 Flash has no vision support. Refuse loudly.

        The router filters supports_vision=False providers out of vision
        candidates, so this branch should NEVER fire. Belt-and-suspenders
        guard for the case where someone instantiates the provider
        directly and bypasses the router.

        `task.system` is forwarded to analyze_text so prompt-engineered
        daemons (translator) can prepend role / output-format guidance.
        """
        if task.requires_vision:
            raise ProviderUnavailable(
                "deepseek: vision required but unsupported (V4 Flash)"
            )
        return await self.analyze_text(task.prompt, system=task.system)

    async def analyze_text(
        self, prompt: str, system: str | None = None,
    ) -> AnalysisResult:
        """Run a text-only call via DeepSeek OpenAI-compatible endpoint.

        Implements exponential backoff on 5xx + 429 (3 attempts, 1s/2s/4s).
        Auth + 4xx errors are surfaced immediately — no retry would help.
        """
        if not self.api_key:
            raise ProviderUnavailable("deepseek: no API key configured")

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
                                "deepseek_retry",
                                attempt=attempt + 1,
                                backoff=backoff,
                                status=resp.status_code,
                            )
                            await asyncio.sleep(backoff)
                            continue
                        raise ProviderUnavailable(f"deepseek: {last_error}")
                    if resp.status_code >= 400:
                        raise ProviderUnavailable(
                            f"deepseek: HTTP {resp.status_code} — {resp.text[:200]}"
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
                        "deepseek_retry_network",
                        attempt=attempt + 1,
                        backoff=backoff,
                        error=str(e)[:120],
                    )
                    await asyncio.sleep(backoff)
                    continue
                raise ProviderUnavailable(f"deepseek: network error: {last_error}")

        try:
            choice = payload["choices"][0]
            text = (choice.get("message") or {}).get("content") or ""
            usage = payload.get("usage") or {}
            input_tokens = usage.get("prompt_tokens")
            output_tokens = usage.get("completion_tokens")
        except (KeyError, IndexError, TypeError) as e:
            raise ProviderUnavailable(f"deepseek: malformed response: {e}")

        text = text.strip()
        # Strip ```json fences if the model returned them
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
        """Return None — DeepSeek paid tier has no published daily-call
        ceiling we track locally. The router relies on daily_budget_usd.
        """
        if not self.api_key:
            return 0
        return None
