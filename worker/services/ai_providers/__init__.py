"""ai_providers package — one stub class per LLM vendor.

Each module exposes a class implementing services.ai_router.AIProvider.
None of them make real API calls yet — analyze_clip() raises
ProviderUnavailable("router phase 2") so the AIRouter can exercise
its fallback path in tests and so the operator can wire each provider
incrementally without breaking the others.

Public re-exports for convenience :
  GeminiProvider       — Google Gemini 2.5 Flash-Lite
  AnthropicProvider    — Anthropic Claude Haiku 4.5
  OpenAIProvider       — OpenAI gpt-4o-mini
  CerebrasProvider     — Cerebras Llama 3.3 70B (no vision)
"""

from __future__ import annotations

from services.ai_providers.anthropic import AnthropicProvider
from services.ai_providers.cerebras import CerebrasProvider
from services.ai_providers.gemini import GeminiProvider
from services.ai_providers.openai import OpenAIProvider

__all__ = [
    "GeminiProvider",
    "AnthropicProvider",
    "OpenAIProvider",
    "CerebrasProvider",
]
