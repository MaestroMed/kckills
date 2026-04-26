"""Tests for the Wave 11 production providers (real impls, mocked HTTP).

Coverage :
  * Real provider classes carry the right pricing + flags (PII / vision).
  * DeepSeek + Grok succeed on a mocked OpenAI-compatible response.
  * DeepSeek refuses vision tasks defensively.
  * Grok refuses vision tasks defensively.
  * DeepSeek backs off + retries on 5xx (then succeeds).
  * Anthropic uses the SDK and parses JSON when present.
  * OpenAI refuses without zero_data_retention=True (Wave 10 contract).
  * Router prefers DeepSeek for non-PII text-only backfill tasks.
  * Router REFUSES DeepSeek/Grok for has_pii=True text tasks.
  * Router falls back to Anthropic when DeepSeek is in cooldown.
  * build_default_router instantiates only providers with set env keys.
  * Provider Protocol satisfied by every shipped class.

Every HTTP call is mocked via patching httpx.AsyncClient or the
anthropic SDK. No real network. No env vars required (each test that
needs a key supplies it via the constructor or monkeypatch).
"""

from __future__ import annotations

import json
import os
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# Ensure worker root is on sys.path so `from services...` works.
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from services.ai_router import (  # noqa: E402
    AIProvider,
    AIRouter,
    AITask,
    AnalysisResult,
    ProviderUnavailable,
    build_default_router,
)
from services.ai_providers import (  # noqa: E402
    AnthropicProvider,
    CerebrasProvider,
    DeepSeekProvider,
    GeminiProvider,
    GrokProvider,
    OpenAIProvider,
)


# ─── Provider constants + protocol ──────────────────────────────────


def test_deepseek_provider_constants():
    """DeepSeek V4 Flash : verified pricing + non-vision + non-PII."""
    p = DeepSeekProvider(api_key="fake")
    assert p.name == "deepseek"
    assert p.cost_per_m_input == 0.14
    assert p.cost_per_m_output == 0.28
    assert p.cost_per_m_input_cache_hit == 0.028
    assert p.supports_vision is False
    assert p.is_pii_safe is False


def test_grok_provider_constants():
    """Grok 4.1 Fast : verified pricing + non-vision + non-PII."""
    p = GrokProvider(api_key="fake")
    assert p.name == "grok"
    assert p.cost_per_m_input == 0.20
    assert p.cost_per_m_output == 0.50
    assert p.supports_vision is False
    assert p.is_pii_safe is False


def test_pii_safe_flags_for_existing_providers():
    """The Wave 10 providers all become PII-safe in Wave 11."""
    assert GeminiProvider(api_key="fake").is_pii_safe is True
    assert AnthropicProvider(api_key="fake").is_pii_safe is True
    assert OpenAIProvider(api_key="fake", zero_data_retention=True).is_pii_safe is True
    assert CerebrasProvider(api_key="fake").is_pii_safe is True


def test_all_providers_satisfy_protocol():
    """isinstance(p, AIProvider) checks the full Protocol surface."""
    instances = [
        GeminiProvider(api_key="fake"),
        AnthropicProvider(api_key="fake"),
        OpenAIProvider(api_key="fake", zero_data_retention=True),
        CerebrasProvider(api_key="fake"),
        DeepSeekProvider(api_key="fake"),
        GrokProvider(api_key="fake"),
    ]
    for p in instances:
        assert isinstance(p, AIProvider), (
            f"{type(p).__name__} does not satisfy AIProvider Protocol"
        )


# ─── DeepSeek HTTP success + retries ────────────────────────────────


def _mock_chat_response(content: str, prompt_tokens: int = 100,
                       completion_tokens: int = 20) -> MagicMock:
    """Build a fake httpx.Response with an OpenAI-compatible JSON body."""
    resp = MagicMock()
    resp.status_code = 200
    resp.json.return_value = {
        "choices": [{"message": {"content": content}}],
        "usage": {
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
        },
        "model": "deepseek-chat",
    }
    return resp


def _mock_async_client_post(post_response: MagicMock) -> MagicMock:
    """Build a fake httpx.AsyncClient context manager that returns
    `post_response` from `client.post(...)`. The post mock can be a side
    effect (list of responses) for retry tests.
    """
    client = MagicMock()
    if isinstance(post_response, list):
        client.post = AsyncMock(side_effect=post_response)
    else:
        client.post = AsyncMock(return_value=post_response)
    cm = MagicMock()
    cm.__aenter__ = AsyncMock(return_value=client)
    cm.__aexit__ = AsyncMock(return_value=False)
    return cm


@pytest.mark.asyncio
async def test_deepseek_text_success():
    """DeepSeek returns a translation, we parse it cleanly."""
    p = DeepSeekProvider(api_key="fake-key")
    fake_resp = _mock_chat_response('{"translation": "Hello world"}')
    with patch("services.ai_providers.deepseek.httpx.AsyncClient",
               return_value=_mock_async_client_post(fake_resp)):
        result = await p.analyze_text("Bonjour le monde", system="Translate to EN")
    assert isinstance(result, AnalysisResult)
    assert result.text == '{"translation": "Hello world"}'
    assert result.input_tokens == 100
    assert result.output_tokens == 20
    # The parsed JSON keys aren't translation-aware on the AnalysisResult
    # (tags/score) — they stay None, which is correct for a translation
    # task. The caller (translator) parses .text on its own.


@pytest.mark.asyncio
async def test_deepseek_refuses_vision():
    """DeepSeek has no vision support — must refuse loudly."""
    p = DeepSeekProvider(api_key="fake-key")
    with pytest.raises(ProviderUnavailable, match="vision"):
        await p.analyze_clip(AITask(prompt="x", requires_vision=True))


@pytest.mark.asyncio
async def test_deepseek_no_key_returns_zero_quota():
    p = DeepSeekProvider(api_key="")
    assert await p.quota_remaining() == 0


@pytest.mark.asyncio
async def test_deepseek_retries_on_500_then_succeeds(monkeypatch):
    """5xx triggers exponential backoff retry, success on attempt 2."""
    # Speed up backoff to avoid test slowness — patch sleep to be instant.
    async def _instant_sleep(_s):
        return None
    monkeypatch.setattr("services.ai_providers.deepseek.asyncio.sleep", _instant_sleep)

    p = DeepSeekProvider(api_key="fake-key")
    err_resp = MagicMock()
    err_resp.status_code = 503
    err_resp.text = "service unavailable"
    ok_resp = _mock_chat_response('{"translation": "ok"}')

    with patch("services.ai_providers.deepseek.httpx.AsyncClient",
               return_value=_mock_async_client_post([err_resp, ok_resp])):
        result = await p.analyze_text("hi")
    assert "ok" in result.text


@pytest.mark.asyncio
async def test_deepseek_4xx_surfaces_immediately(monkeypatch):
    """4xx auth errors don't retry — they surface as ProviderUnavailable."""
    async def _instant_sleep(_s):
        return None
    monkeypatch.setattr("services.ai_providers.deepseek.asyncio.sleep", _instant_sleep)

    p = DeepSeekProvider(api_key="fake-key")
    err_resp = MagicMock()
    err_resp.status_code = 401
    err_resp.text = "invalid api key"
    with patch("services.ai_providers.deepseek.httpx.AsyncClient",
               return_value=_mock_async_client_post(err_resp)):
        with pytest.raises(ProviderUnavailable, match="401"):
            await p.analyze_text("hi")


# ─── Grok HTTP success ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_grok_text_success():
    p = GrokProvider(api_key="fake-key")
    fake_resp = _mock_chat_response('{"translation": "Hola mundo"}')
    with patch("services.ai_providers.grok.httpx.AsyncClient",
               return_value=_mock_async_client_post(fake_resp)):
        result = await p.analyze_text("Bonjour", system="Translate to ES")
    assert "Hola" in result.text


@pytest.mark.asyncio
async def test_grok_refuses_vision():
    p = GrokProvider(api_key="fake-key")
    with pytest.raises(ProviderUnavailable, match="vision"):
        await p.analyze_clip(AITask(prompt="x", requires_vision=True))


# ─── Anthropic SDK path ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_anthropic_text_success():
    """Anthropic SDK is mocked — verifies we extract content+usage."""
    p = AnthropicProvider(api_key="fake-key")

    fake_anthropic = MagicMock()
    fake_msg = MagicMock()
    fake_block = MagicMock()
    fake_block.text = '{"translation": "Hi there"}'
    fake_msg.content = [fake_block]
    fake_msg.usage = MagicMock()
    fake_msg.usage.input_tokens = 50
    fake_msg.usage.output_tokens = 10
    fake_msg.model = "claude-haiku-4-5-20251001"
    fake_msg.stop_reason = "end_turn"
    fake_anthropic.Anthropic.return_value.messages.create.return_value = fake_msg

    with patch.dict(sys.modules, {"anthropic": fake_anthropic}):
        result = await p.analyze_text("Salut", system="Translate")

    assert "Hi there" in result.text
    assert result.input_tokens == 50
    assert result.output_tokens == 10


@pytest.mark.asyncio
async def test_anthropic_refuses_clip_vision():
    """Anthropic vision-on-clip not implemented — refuses with clear error."""
    p = AnthropicProvider(api_key="fake-key")
    with pytest.raises(ProviderUnavailable, match="clip-vision"):
        await p.analyze_clip(AITask(
            prompt="x", clip_url="https://r2/clip.mp4", requires_vision=True,
        ))


# ─── OpenAI ZDR contract ────────────────────────────────────────────


@pytest.mark.asyncio
async def test_openai_refuses_without_zdr():
    """OpenAI must refuse calls until zero_data_retention=True."""
    p = OpenAIProvider(api_key="fake", zero_data_retention=False)
    with pytest.raises(ProviderUnavailable, match="zero_data_retention"):
        await p.analyze_text("hi")


@pytest.mark.asyncio
async def test_openai_text_success_with_zdr():
    """With ZDR affirmed, OpenAI works like the OpenAI-compat providers."""
    p = OpenAIProvider(api_key="fake-key", zero_data_retention=True)
    fake_resp = _mock_chat_response('{"translation": "hello"}')
    with patch("services.ai_providers.openai.httpx.AsyncClient",
               return_value=_mock_async_client_post(fake_resp)):
        result = await p.analyze_text("salut")
    assert "hello" in result.text


# ─── Router behavior with the new providers ─────────────────────────


@pytest.mark.asyncio
async def test_router_prefers_deepseek_for_non_pii_backfill():
    """For backfill text tasks with no PII, DeepSeek wins on cost."""
    deepseek = DeepSeekProvider(api_key="dk")
    grok = GrokProvider(api_key="gk")
    gemini = GeminiProvider(api_key="gm")

    # Patch HTTP so DeepSeek "succeeds" returning a known body
    fake_resp = _mock_chat_response('{"translation": "ok"}')
    with patch("services.ai_providers.deepseek.httpx.AsyncClient",
               return_value=_mock_async_client_post(fake_resp)):
        router = AIRouter([gemini, grok, deepseek])
        result = await router.route(AITask(
            prompt="translate this",
            requires_vision=False,
            has_pii=False,
            priority="backfill",
        ))
    # DeepSeek = $0.14/M input is the cheapest → wins on backfill.
    assert result.provider_name == "deepseek"
    assert result.cost_usd is not None and result.cost_usd >= 0.0


@pytest.mark.asyncio
async def test_router_skips_deepseek_grok_for_pii():
    """has_pii=True must filter out DeepSeek + Grok regardless of cost."""
    deepseek = DeepSeekProvider(api_key="dk")
    grok = GrokProvider(api_key="gk")
    anthropic = AnthropicProvider(api_key="ak")

    # Patch the Anthropic SDK so our fallback actually returns something.
    fake_anthropic = MagicMock()
    fake_msg = MagicMock()
    fake_msg.content = [MagicMock(text='{"translation": "ok"}')]
    fake_msg.usage = MagicMock(input_tokens=10, output_tokens=5)
    fake_msg.model = "claude-haiku-4-5-20251001"
    fake_msg.stop_reason = "end_turn"
    fake_anthropic.Anthropic.return_value.messages.create.return_value = fake_msg

    with patch.dict(sys.modules, {"anthropic": fake_anthropic}):
        router = AIRouter([deepseek, grok, anthropic])
        result = await router.route(AITask(
            prompt="moderate this user comment",
            requires_vision=False,
            has_pii=True,
            priority="normal",
        ))
    # DeepSeek + Grok filtered → Anthropic wins (the only PII-safe option).
    assert result.provider_name == "anthropic"


@pytest.mark.asyncio
async def test_router_falls_back_when_deepseek_in_cooldown(monkeypatch):
    """A DeepSeek failure puts it in cooldown, second call goes to Grok.

    Note on the mock setup : `services.ai_providers.deepseek.httpx` and
    `services.ai_providers.grok.httpx` resolve to the SAME `httpx`
    module object, so two separate `patch()` calls on the same attribute
    only keep the last one. To get per-provider routing of mocked
    responses we use ONE patch on the shared `httpx.AsyncClient` with a
    side_effect that returns the err-cm for the first 3 calls (DeepSeek
    retries) and the ok-cm for the 4th call (Grok succeeds).
    """
    async def _instant_sleep(_s):
        return None
    monkeypatch.setattr("services.ai_providers.deepseek.asyncio.sleep", _instant_sleep)

    deepseek = DeepSeekProvider(api_key="dk")
    grok = GrokProvider(api_key="gk")

    err_resp = MagicMock()
    err_resp.status_code = 503
    err_resp.text = "down"
    ok_resp = _mock_chat_response('{"translation": "ok"}')

    cm_err = _mock_async_client_post([err_resp, err_resp, err_resp])
    cm_ok = _mock_async_client_post(ok_resp)
    # Single shared httpx.AsyncClient mock — DeepSeek opens a new client
    # each retry (3 times) then Grok opens its own (1 time) → 4 cms total.
    with patch("httpx.AsyncClient", side_effect=[cm_err, cm_err, cm_err, cm_ok]):
        router = AIRouter([deepseek, grok])
        result = await router.route(AITask(
            prompt="translate", requires_vision=False, priority="backfill",
        ))
    assert result.provider_name == "grok"
    assert result.fallback_used is True
    assert result.attempts == ["deepseek", "grok"]


# ─── build_default_router ───────────────────────────────────────────


def test_build_default_router_skips_providers_without_keys(monkeypatch):
    """Only providers with non-empty env keys get instantiated."""
    # Strip every provider env first, then set only DeepSeek + Anthropic.
    for var in (
        "GEMINI_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY",
        "KCKILLS_OPENAI_API_KEY", "CEREBRAS_API_KEY",
        "KCKILLS_DEEPSEEK_API_KEY", "KCKILLS_GROK_API_KEY",
    ):
        monkeypatch.delenv(var, raising=False)

    monkeypatch.setenv("KCKILLS_DEEPSEEK_API_KEY", "dk-test")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "ak-test")
    monkeypatch.setenv("KCKILLS_AI_DAILY_BUDGET_USD", "5.00")

    router = build_default_router()
    names = [p.name for p in router.providers]
    assert names == ["deepseek", "anthropic"]
    # Budget split evenly : $5 / 2 = $2.50 each
    assert router.daily_budget_usd["deepseek"] == pytest.approx(2.50)
    assert router.daily_budget_usd["anthropic"] == pytest.approx(2.50)


def test_build_default_router_raises_when_no_keys(monkeypatch):
    for var in (
        "GEMINI_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY",
        "KCKILLS_OPENAI_API_KEY", "CEREBRAS_API_KEY",
        "KCKILLS_DEEPSEEK_API_KEY", "KCKILLS_GROK_API_KEY",
    ):
        monkeypatch.delenv(var, raising=False)
    with pytest.raises(RuntimeError, match="no provider keys"):
        build_default_router()
