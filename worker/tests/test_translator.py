"""Tests for the translator daemon (Wave 11).

Mocks the AI router + supabase_client at the module boundary so the
suite is fully deterministic — no network, no DB, no env vars required.

Coverage :
  * Disabled by default (KCKILLS_TRANSLATOR_ENABLED unset → returns 0).
  * No providers configured → soft-fail (return 0, log warning).
  * Skip rows whose 3 target languages are already filled.
  * Skip rows missing the FR source.
  * Translate ONE missing language, leave the others alone (idempotent).
  * Translate ALL THREE missing languages in one row.
  * Route to DeepSeek for non-PII text tasks (verified via the AITask
    constructor args : has_pii=False, requires_vision=False, priority='backfill').
  * Falls through gracefully when the router raises (counts route_failed,
    doesn't crash the daemon).
  * Stamps ai_descriptions_translated_at on every successful write.
  * Parses ```json fences in DeepSeek's reply.
"""

from __future__ import annotations

import os
import sys
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# Add worker root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from modules import translator  # noqa: E402
from services.ai_router import AnalysisResult, ProviderUnavailable  # noqa: E402


# ─── Fixtures ────────────────────────────────────────────────────────


@pytest.fixture
def enabled(monkeypatch):
    """Enable the translator + clear any prior key state."""
    monkeypatch.setenv("KCKILLS_TRANSLATOR_ENABLED", "true")
    yield


def _mock_router(reply_text: str = '{"translation": "translated"}'):
    """Build a fake router whose route() returns a baked AnalysisResult.

    Each call increments .call_count and records the AITask passed in
    so the tests can assert routing decisions (priority, has_pii, etc.).
    """
    router = MagicMock()
    router.tasks_routed = []

    async def _fake_route(task):
        router.tasks_routed.append(task)
        return AnalysisResult(
            text=reply_text,
            description=reply_text,
            provider_name="deepseek",
            model_name="deepseek-chat",
            cost_usd=0.0001,
            latency_ms=120,
            input_tokens=80,
            output_tokens=10,
        )

    router.route = AsyncMock(side_effect=_fake_route)
    router.total_spent_usd_today = MagicMock(return_value=0.0001)
    return router


# ─── Feature flag + provider-availability gating ─────────────────────


@pytest.mark.asyncio
async def test_run_disabled_by_default_returns_zero(monkeypatch):
    """KCKILLS_TRANSLATOR_ENABLED unset → return 0 immediately."""
    monkeypatch.delenv("KCKILLS_TRANSLATOR_ENABLED", raising=False)
    result = await translator.run()
    assert result == 0


@pytest.mark.asyncio
async def test_run_no_providers_soft_fails(enabled, monkeypatch):
    """build_default_router raises → log warning + return 0, no crash."""
    def _raise(*a, **kw):
        raise RuntimeError("no provider keys configured")

    with patch("modules.translator.build_default_router", side_effect=_raise):
        result = await translator.run()
    assert result == 0


# ─── Skip behavior ───────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_run_skips_rows_with_all_languages_filled(enabled):
    """A row with EN/KO/ES already populated is dropped before routing."""
    fake_router = _mock_router()
    rows = [
        {
            "id": "kill-1",
            "ai_description": "FR text",
            "ai_description_en": "EN text",
            "ai_description_ko": "KO text",
            "ai_description_es": "ES text",
        }
    ]
    with patch("modules.translator.build_default_router", return_value=fake_router), \
         patch("modules.translator.safe_select", return_value=rows), \
         patch("modules.translator.safe_update", return_value=True):
        written = await translator.run()
    assert written == 0
    assert fake_router.route.call_count == 0  # nothing was routed


@pytest.mark.asyncio
async def test_run_skips_rows_without_french_source(enabled):
    """No ai_description AND no ai_description_fr → skip entirely."""
    fake_router = _mock_router()
    rows = [
        {
            "id": "kill-2",
            "ai_description": None,
            "ai_description_fr": None,
            "ai_description_en": None,
        }
    ]
    with patch("modules.translator.build_default_router", return_value=fake_router), \
         patch("modules.translator.safe_select", return_value=rows), \
         patch("modules.translator.safe_update", return_value=True):
        written = await translator.run()
    assert written == 0
    assert fake_router.route.call_count == 0


# ─── Translation flow ───────────────────────────────────────────────


@pytest.mark.asyncio
async def test_run_translates_single_missing_language(enabled):
    """A row with EN+KO done but ES missing → 1 router call, only ES is written."""
    fake_router = _mock_router('{"translation": "Spanish text"}')
    rows = [
        {
            "id": "kill-3",
            "ai_description": "FR text",
            "ai_description_en": "EN already",
            "ai_description_ko": "KO already",
            "ai_description_es": None,
        }
    ]
    update_calls: list[tuple[str, dict, str, str]] = []

    def _fake_update(table, data, col, val):
        update_calls.append((table, data, col, val))
        return True

    with patch("modules.translator.build_default_router", return_value=fake_router), \
         patch("modules.translator.safe_select", return_value=rows), \
         patch("modules.translator.safe_update", side_effect=_fake_update):
        written = await translator.run()

    assert written == 1
    assert fake_router.route.call_count == 1  # only ES routed
    # Only the ES column written + the timestamp
    assert len(update_calls) == 1
    table, patch_body, col, val = update_calls[0]
    assert table == "kills"
    assert col == "id"
    assert val == "kill-3"
    assert patch_body.get("ai_description_es") == "Spanish text"
    assert "ai_description_en" not in patch_body
    assert "ai_description_ko" not in patch_body
    assert "ai_descriptions_translated_at" in patch_body


@pytest.mark.asyncio
async def test_run_translates_all_three_missing(enabled):
    """A row with no translations → 3 router calls, all 3 columns written."""
    fake_router = _mock_router('{"translation": "stub"}')
    rows = [
        {
            "id": "kill-4",
            "ai_description": "FR text",
            "ai_description_en": None,
            "ai_description_ko": None,
            "ai_description_es": None,
        }
    ]
    update_calls: list[dict] = []

    def _fake_update(_table, data, _col, _val):
        update_calls.append(data)
        return True

    with patch("modules.translator.build_default_router", return_value=fake_router), \
         patch("modules.translator.safe_select", return_value=rows), \
         patch("modules.translator.safe_update", side_effect=_fake_update):
        written = await translator.run()

    assert written == 1
    assert fake_router.route.call_count == 3
    assert len(update_calls) == 1
    body = update_calls[0]
    for col in ("ai_description_en", "ai_description_ko", "ai_description_es"):
        assert body.get(col) == "stub"


@pytest.mark.asyncio
async def test_run_routes_with_correct_task_attributes(enabled):
    """Verify the AITask sent to the router has the expected flags."""
    fake_router = _mock_router('{"translation": "x"}')
    rows = [
        {
            "id": "kill-5",
            "ai_description": "Caliste finit la Caitlyn",
            "ai_description_en": None,
            "ai_description_ko": "KO done",
            "ai_description_es": "ES done",
        }
    ]
    with patch("modules.translator.build_default_router", return_value=fake_router), \
         patch("modules.translator.safe_select", return_value=rows), \
         patch("modules.translator.safe_update", return_value=True):
        await translator.run()

    assert len(fake_router.tasks_routed) == 1
    task = fake_router.tasks_routed[0]
    assert task.requires_vision is False
    assert task.has_pii is False
    assert task.priority == "backfill"
    assert task.clip_url is None
    assert task.system is not None  # a system prompt is supplied
    assert "Caliste" in task.prompt   # FR source survives into the prompt


# ─── Error handling ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_run_router_failure_does_not_crash_daemon(enabled):
    """If the router raises, the row is skipped + counted, daemon survives."""
    fake_router = MagicMock()
    fake_router.tasks_routed = []
    fake_router.route = AsyncMock(side_effect=RuntimeError("all providers failed"))
    fake_router.total_spent_usd_today = MagicMock(return_value=0.0)

    rows = [
        {
            "id": "kill-6",
            "ai_description": "FR text",
            "ai_description_en": None,
            "ai_description_ko": None,
            "ai_description_es": None,
        }
    ]
    with patch("modules.translator.build_default_router", return_value=fake_router), \
         patch("modules.translator.safe_select", return_value=rows), \
         patch("modules.translator.safe_update", return_value=True):
        written = await translator.run()
    assert written == 0  # nothing translated, but no exception


@pytest.mark.asyncio
async def test_run_provider_unavailable_propagates_as_skip(enabled):
    """ProviderUnavailable is caught + logged, like RuntimeError."""
    fake_router = MagicMock()
    fake_router.route = AsyncMock(
        side_effect=ProviderUnavailable("deepseek down")
    )
    fake_router.total_spent_usd_today = MagicMock(return_value=0.0)

    rows = [
        {
            "id": "kill-7",
            "ai_description": "FR",
            "ai_description_en": None,
            "ai_description_ko": "ok",
            "ai_description_es": "ok",
        }
    ]
    with patch("modules.translator.build_default_router", return_value=fake_router), \
         patch("modules.translator.safe_select", return_value=rows), \
         patch("modules.translator.safe_update", return_value=True):
        written = await translator.run()
    assert written == 0


# ─── Reply parsing ──────────────────────────────────────────────────


def test_parse_translation_clean_json():
    assert translator.parse_translation('{"translation": "hi"}') == "hi"


def test_parse_translation_with_json_fence():
    fenced = '```json\n{"translation": "hola"}\n```'
    assert translator.parse_translation(fenced) == "hola"


def test_parse_translation_extracts_object_from_noisy_text():
    noisy = 'Sure! Here is your translation: {"translation": "bonjour"}.'
    assert translator.parse_translation(noisy) == "bonjour"


def test_parse_translation_returns_none_on_garbage():
    assert translator.parse_translation("not json at all") is None
    assert translator.parse_translation("") is None
    assert translator.parse_translation('{"wrong_key": "x"}') is None


def test_build_prompt_contains_all_required_fields():
    p = translator.build_prompt("KC Caliste win", "English")
    assert "KC Caliste win" in p
    assert "English" in p
    assert "JSON" in p
