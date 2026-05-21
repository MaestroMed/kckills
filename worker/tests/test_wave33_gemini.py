"""Tests Wave 33 — Gemini 3.5 Flash tier system + auto-upgrade + cost guard.

Couverture :
  * ai_pricing : gemini-3.5-flash dans la table, cached input rate plus bas
  * compute_gemini_cost gère cached_input_tokens (split full/cached)
  * config.gemini_model_for_stage resolve les 4 stages
  * GeminiPremiumProvider hérite + pin le model + thinking budget
  * scheduler.record_cost + DAILY_COST_CAPS_USD short-circuit wait_for
  * analyze_kill_row auto-upgrade : multi_kill, first_blood, score threshold
  * _build_thinking_config : allowlist 3.5-* + double-try string/int

Aucun appel réseau, aucune env var requise. Tous les mocks sont créés
dans le test.
"""

from __future__ import annotations

import asyncio
import os
import sys
from unittest.mock import patch

import pytest

# worker root → sys.path (même pattern que test_ai_router.py)
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))


# ════════════════════════════════════════════════════════════════════
# ai_pricing — table + cached input
# ════════════════════════════════════════════════════════════════════


def test_gemini_3_5_flash_in_price_table():
    from services.ai_pricing import GEMINI_PRICES, GEMINI_CACHED_INPUT_PRICES

    assert "gemini-3.5-flash" in GEMINI_PRICES
    in_p, out_p = GEMINI_PRICES["gemini-3.5-flash"]
    # Specs Google : $1.50 in / $9.00 out
    assert in_p == 1.50
    assert out_p == 9.00
    # Cached input = $0.15/M (10× moins)
    assert GEMINI_CACHED_INPUT_PRICES["gemini-3.5-flash"] == 0.15


def test_compute_cost_splits_full_and_cached_tokens():
    from services.ai_pricing import compute_gemini_cost

    # 1000 input total, 600 cached, 500 output
    # Full input    : 400 × $1.50/M = $0.0006
    # Cached input  : 600 × $0.15/M = $0.00009
    # Output        : 500 × $9.00/M = $0.0045
    # Total : $0.00519
    cost = compute_gemini_cost(
        "gemini-3.5-flash",
        input_tokens=1000,
        output_tokens=500,
        cached_input_tokens=600,
    )
    assert cost == pytest.approx(0.00519, rel=1e-3)


def test_compute_cost_no_cache_full_input():
    from services.ai_pricing import compute_gemini_cost

    # Pas de cached_input_tokens → tout au full rate.
    # 1000 × $1.50/M + 500 × $9.00/M = $0.006
    cost = compute_gemini_cost("gemini-3.5-flash", 1000, 500)
    assert cost == pytest.approx(0.006, rel=1e-3)


def test_compute_cost_unknown_model_falls_back_to_lite():
    from services.ai_pricing import compute_gemini_cost

    # Modèle inconnu → fallback flash-lite ($0.10/$0.40)
    cost = compute_gemini_cost("gemini-99-unicorn", 1000, 500)
    expected = (1000 * 0.10 + 500 * 0.40) / 1_000_000
    assert cost == pytest.approx(expected, rel=1e-6)


# ════════════════════════════════════════════════════════════════════
# config — tier resolution + stage helper
# ════════════════════════════════════════════════════════════════════


def test_config_stage_helper_resolves_4_stages():
    from config import Config

    # Default tier `free` → tout flash-lite
    assert Config.gemini_model_for_stage("analyzer") == Config.GEMINI_MODEL_ANALYZER
    assert Config.gemini_model_for_stage("qc") == Config.GEMINI_MODEL_QC
    assert Config.gemini_model_for_stage("offset") == Config.GEMINI_MODEL_OFFSET
    assert Config.gemini_model_for_stage("quotes") == Config.GEMINI_MODEL_QUOTES


def test_config_stage_helper_unknown_falls_back_to_qc():
    from config import Config

    # Stage inconnu → fallback QC (cheap by default).
    assert Config.gemini_model_for_stage("nonsense") == Config.GEMINI_MODEL_QC


def test_tier_defaults_have_quotes_stage():
    """Wave 33 added the `quotes` stage to every tier."""
    from config import Config

    for tier_name, mapping in Config._TIER_DEFAULTS.items():
        assert "quotes" in mapping, f"tier {tier_name} missing `quotes`"
        assert isinstance(mapping["quotes"], str)
        assert mapping["quotes"].startswith("gemini-")


def test_premium_tier_uses_3_5_flash():
    """Wave 33 — `premium` was 2.5-pro, now upgraded to 3.5-flash."""
    from config import Config

    assert Config._TIER_DEFAULTS["premium"]["analyzer"] == "gemini-3.5-flash"


def test_pro_legacy_tier_kept_for_25_pro():
    """Le tier `pro-legacy` garde 2.5-pro pour les backfills budgetés."""
    from config import Config

    assert Config._TIER_DEFAULTS["pro-legacy"]["analyzer"] == "gemini-2.5-pro"


# ════════════════════════════════════════════════════════════════════
# GeminiPremiumProvider
# ════════════════════════════════════════════════════════════════════


def test_premium_provider_pins_3_5_flash():
    from services.ai_providers.gemini_premium import GeminiPremiumProvider

    # Pas d'API key requise pour cette assertion structurelle
    with patch.dict(os.environ, {"GEMINI_API_KEY": "fake"}):
        p = GeminiPremiumProvider()
    assert p.model_name == "gemini-3.5-flash"
    assert p.cost_per_m_input == 1.50
    assert p.cost_per_m_output == 9.00
    assert p.supports_vision is True


def test_premium_provider_resolves_thinking_budget_from_config():
    from services.ai_providers.gemini_premium import GeminiPremiumProvider

    with patch.dict(os.environ, {"GEMINI_API_KEY": "fake"}):
        # Default = medium (Google's default)
        p = GeminiPremiumProvider()
    assert p.thinking_budget == "medium"


def test_premium_provider_explicit_thinking_budget_wins():
    from services.ai_providers.gemini_premium import GeminiPremiumProvider

    with patch.dict(os.environ, {"GEMINI_API_KEY": "fake"}):
        p = GeminiPremiumProvider(thinking_budget="high")
    assert p.thinking_budget == "high"


def test_premium_provider_has_distinct_name():
    """Router uses provider.name as the dispatch key — 'gemini_premium'
    must be distinct from the standard 'gemini'."""
    from services.ai_providers.gemini import GeminiProvider
    from services.ai_providers.gemini_premium import GeminiPremiumProvider

    with patch.dict(os.environ, {"GEMINI_API_KEY": "fake"}):
        std = GeminiProvider()
        prem = GeminiPremiumProvider()
    assert std.name == "gemini"
    assert prem.name == "gemini_premium"
    assert std.name != prem.name


# ════════════════════════════════════════════════════════════════════
# scheduler — daily $-cost guard
# ════════════════════════════════════════════════════════════════════


def test_scheduler_record_cost_increments_ledger():
    from scheduler import LoLTokScheduler

    s = LoLTokScheduler()
    s.record_cost("gemini", 0.05)
    s.record_cost("gemini", 0.10)
    stats = s.get_stats()
    assert stats["daily_cost_usd"]["gemini"] == pytest.approx(0.15, rel=1e-6)


def test_scheduler_record_cost_ignores_bad_input():
    from scheduler import LoLTokScheduler

    s = LoLTokScheduler()
    s.record_cost("gemini", "not-a-number")  # type: ignore[arg-type]
    s.record_cost("gemini", None)  # type: ignore[arg-type]
    s.record_cost("gemini", -1.0)  # negative ignored
    stats = s.get_stats()
    assert stats["daily_cost_usd"].get("gemini", 0.0) == 0.0


def test_scheduler_wait_for_blocks_when_cost_cap_exceeded():
    from scheduler import LoLTokScheduler

    async def run():
        s = LoLTokScheduler()
        # Pin the cap low so we can exceed it cleanly.
        s.DAILY_COST_CAPS_USD = {"gemini": 1.0}
        # Spend the budget
        s.record_cost("gemini", 1.5)
        # wait_for should refuse now
        ok = await s.wait_for("gemini")
        return ok

    ok = asyncio.run(run())
    assert ok is False


def test_scheduler_wait_for_allows_when_under_cost_cap():
    from scheduler import LoLTokScheduler

    async def run():
        s = LoLTokScheduler()
        s.DAILY_COST_CAPS_USD = {"gemini": 1.0}
        s.record_cost("gemini", 0.50)
        ok = await s.wait_for("gemini")
        return ok

    ok = asyncio.run(run())
    assert ok is True


def test_scheduler_stats_surfaces_cost_remaining():
    from scheduler import LoLTokScheduler

    s = LoLTokScheduler()
    s.DAILY_COST_CAPS_USD = {"gemini": 10.0}
    s.record_cost("gemini", 3.25)
    stats = s.get_stats()
    assert "daily_cost_usd" in stats
    assert "daily_cost_remaining_usd" in stats
    assert stats["daily_cost_remaining_usd"]["gemini"] == pytest.approx(6.75)


# ════════════════════════════════════════════════════════════════════
# Auto-upgrade rule in analyze_kill_row
# ════════════════════════════════════════════════════════════════════


def _mock_analyze_kill_capture(captured: dict):
    """Replace `modules.analyzer.analyze_kill` with a coroutine that
    records its kwargs and returns a stub result."""

    async def fake(*args, **kwargs):
        captured.update(kwargs)
        return {"highlight_score": 5.0, "description_fr": "stub"}

    return fake


def test_auto_upgrade_on_penta():
    """Penta-kill triggers premium model regardless of base tier."""
    import modules.analyzer as A

    captured: dict = {}
    orig = A.analyze_kill
    A.analyze_kill = _mock_analyze_kill_capture(captured)
    try:
        row = {
            "killer_champion": "Jhin",
            "victim_champion": "Aatrox",
            "multi_kill": "penta",
            "is_first_blood": False,
            "tracked_team_involvement": "team_killer",
        }
        result = asyncio.run(A.analyze_kill_row(row))
    finally:
        A.analyze_kill = orig

    assert captured["model_override"] == "gemini-3.5-flash"
    assert result["_auto_upgraded"] is True


def test_auto_upgrade_on_first_blood():
    import modules.analyzer as A

    captured: dict = {}
    A.analyze_kill = _mock_analyze_kill_capture(captured)
    row = {
        "killer_champion": "Jhin",
        "victim_champion": "Aatrox",
        "multi_kill": None,
        "is_first_blood": True,
        "tracked_team_involvement": "team_killer",
    }
    asyncio.run(A.analyze_kill_row(row))
    assert captured["model_override"] == "gemini-3.5-flash"


def test_no_auto_upgrade_on_routine_kill():
    """Banal kill (no signals) → uses base tier (None override)."""
    import modules.analyzer as A

    captured: dict = {}
    A.analyze_kill = _mock_analyze_kill_capture(captured)
    row = {
        "killer_champion": "Jhin",
        "victim_champion": "Aatrox",
        "multi_kill": None,
        "is_first_blood": False,
        "tracked_team_involvement": "team_killer",
    }
    asyncio.run(A.analyze_kill_row(row))
    assert captured["model_override"] is None  # No override → base tier


def test_caller_model_override_wins_over_auto_upgrade():
    """Lab generator / reanalyze scripts pin their own model — they
    must NOT be overridden by the auto-upgrade rule."""
    import modules.analyzer as A

    captured: dict = {}
    A.analyze_kill = _mock_analyze_kill_capture(captured)
    row = {
        "killer_champion": "Jhin",
        "victim_champion": "Aatrox",
        "multi_kill": "penta",  # would auto-upgrade
        "is_first_blood": True,  # would auto-upgrade
        "_model_override": "gemini-2.5-pro",  # explicit caller wins
        "tracked_team_involvement": "team_killer",
    }
    asyncio.run(A.analyze_kill_row(row))
    assert captured["model_override"] == "gemini-2.5-pro"


# ════════════════════════════════════════════════════════════════════
# _build_thinking_config — allowlist + signature fallback
# ════════════════════════════════════════════════════════════════════


def test_thinking_config_returns_none_for_lite_model():
    """Older flash-lite models don't support thinking budget — helper
    must return None so we don't pass the kwarg."""
    from services.gemini_client import _build_thinking_config

    # Fake `types` module so we don't pull in google.genai for this test
    class FakeTypes:
        class ThinkingConfig:
            def __init__(self, **kwargs):
                self.kwargs = kwargs

    cfg = _build_thinking_config(FakeTypes, "gemini-3.1-flash-lite", "medium")
    assert cfg is None


def test_thinking_config_returns_none_when_budget_empty():
    from services.gemini_client import _build_thinking_config

    class FakeTypes:
        class ThinkingConfig:
            def __init__(self, **kwargs):
                self.kwargs = kwargs

    cfg = _build_thinking_config(FakeTypes, "gemini-3.5-flash", None)
    assert cfg is None
    cfg = _build_thinking_config(FakeTypes, "gemini-3.5-flash", "")
    assert cfg is None


def test_thinking_config_passes_string_budget_to_3_5_flash():
    from services.gemini_client import _build_thinking_config

    class FakeTypes:
        class ThinkingConfig:
            def __init__(self, **kwargs):
                # New SDK accepts string enum
                self.kwargs = kwargs

    cfg = _build_thinking_config(FakeTypes, "gemini-3.5-flash", "high")
    assert cfg is not None
    assert cfg.kwargs == {"thinking_budget": "high"}


def test_thinking_config_falls_back_to_int_on_old_sdk():
    """If the SDK rejects string budgets, we fall back to int map."""
    from services.gemini_client import _build_thinking_config

    class FakeTypes:
        class ThinkingConfig:
            def __init__(self, **kwargs):
                # Simulate old SDK that rejects strings
                if isinstance(kwargs.get("thinking_budget"), str):
                    raise TypeError("budget must be int")
                self.kwargs = kwargs

    cfg = _build_thinking_config(FakeTypes, "gemini-3.5-flash", "medium")
    assert cfg is not None
    # Medium maps to 1024 in the legacy int budget
    assert cfg.kwargs == {"thinking_budget": 1024}
