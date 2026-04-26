"""ai_providers package — one class per LLM vendor.

The original 4 (gemini, anthropic, openai, cerebras) are PHASE-1 stubs
that raise ProviderUnavailable until phase 2 wires real SDK calls. The
Wave 11 additions (deepseek, grok) are FULL production implementations
talking to OpenAI-compatible HTTP endpoints — they're the cheap-text
path used by the translator daemon.

Public re-exports for convenience :
  GeminiProvider       — Google Gemini 2.5 Flash-Lite (vision, stub)
  AnthropicProvider    — Anthropic Claude Haiku 4.5 (PII-safe, stub)
  OpenAIProvider       — OpenAI gpt-4o-mini (vision, stub)
  CerebrasProvider     — Cerebras Llama 3.3 70B (no vision, stub)
  DeepSeekProvider     — DeepSeek V4 Flash (no vision, NOT PII-safe, LIVE)
  GrokProvider         — xAI Grok 4.1 Fast (no vision, NOT PII-safe, LIVE)
"""

from __future__ import annotations

from services.ai_providers.anthropic import AnthropicProvider
from services.ai_providers.cerebras import CerebrasProvider
from services.ai_providers.deepseek import DeepSeekProvider
from services.ai_providers.gemini import GeminiProvider
from services.ai_providers.grok import GrokProvider
from services.ai_providers.openai import OpenAIProvider

__all__ = [
    "GeminiProvider",
    "AnthropicProvider",
    "OpenAIProvider",
    "CerebrasProvider",
    "DeepSeekProvider",
    "GrokProvider",
]
