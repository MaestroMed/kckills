"""Tests for services.runtime_tuning — env-driven worker knobs.

Covers :
  * Defaults are returned when no env var is set.
  * Env vars override defaults when set.
  * Cache prevents env changes from being picked up mid-run.
  * Low-power mode halves parallelism + doubles intervals.
  * Low-power floor : parallelism never drops below 1.
  * Batch + lease are NOT scaled by low-power.
  * Unknown modules fall back to a generic default (no exception).
  * Negative / zero / garbage env values are ignored.
  * The DEFAULTS table covers every daemon module listed in main.py.
"""

from __future__ import annotations

import importlib
import os
import sys

import pytest

# Add worker root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))


def _reload(monkeypatch: pytest.MonkeyPatch, **env: str):
    """Reimport runtime_tuning with the given env vars set, fresh cache.

    Required because runtime_tuning resolves _LOW_POWER at module-import
    time as a Final[bool]. Toggling KCKILLS_LOW_POWER between assertions
    has no effect unless we reload the module.
    """
    # Clear any KCKILLS_* the test runner might already have inherited.
    for k in list(os.environ.keys()):
        if k.startswith("KCKILLS_"):
            monkeypatch.delenv(k, raising=False)
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    if "services.runtime_tuning" in sys.modules:
        importlib.reload(sys.modules["services.runtime_tuning"])
    import services.runtime_tuning as rt
    rt.reset_cache()
    return rt


def test_defaults_returned_when_env_unset(monkeypatch: pytest.MonkeyPatch):
    """With no KCKILLS_* env, the DEFAULTS table values come back as-is."""
    rt = _reload(monkeypatch)
    # Spot-check the most important modules — clipper drives throughput,
    # analyzer drives Gemini cost, embedder drives the slow cron.
    assert rt.get_parallelism("clipper") == 8
    assert rt.get_interval("clipper") == 300
    assert rt.get_batch_size("clipper") == 200
    assert rt.get_lease_seconds("clipper") == 600

    assert rt.get_parallelism("analyzer") == 5
    assert rt.get_interval("analyzer") == 600
    assert rt.get_batch_size("analyzer") == 80
    assert rt.get_lease_seconds("analyzer") == 900

    assert rt.get_parallelism("embedder") == 1
    assert rt.get_interval("embedder") == 1800


def test_env_overrides_defaults(monkeypatch: pytest.MonkeyPatch):
    """KCKILLS_PARALLEL_<MODULE> et al. take precedence over DEFAULTS."""
    rt = _reload(
        monkeypatch,
        KCKILLS_PARALLEL_CLIPPER="12",
        KCKILLS_INTERVAL_CLIPPER="120",
        KCKILLS_BATCH_CLIPPER="500",
        KCKILLS_LEASE_CLIPPER="1200",
    )
    assert rt.get_parallelism("clipper") == 12
    assert rt.get_interval("clipper") == 120
    assert rt.get_batch_size("clipper") == 500
    assert rt.get_lease_seconds("clipper") == 1200
    # Other modules untouched.
    assert rt.get_parallelism("analyzer") == 5


def test_cache_freezes_after_first_call(monkeypatch: pytest.MonkeyPatch):
    """Once a value is resolved, changing the env mid-run has no effect.

    This is the contract : "restart to tune". Tests the cache path
    explicitly.
    """
    rt = _reload(monkeypatch, KCKILLS_PARALLEL_CLIPPER="6")
    assert rt.get_parallelism("clipper") == 6
    # Mutate the env post-resolution. Should NOT show up.
    monkeypatch.setenv("KCKILLS_PARALLEL_CLIPPER", "999")
    assert rt.get_parallelism("clipper") == 6


def test_low_power_halves_parallelism(monkeypatch: pytest.MonkeyPatch):
    """KCKILLS_LOW_POWER=1 → parallelism × 0.5 (rounded down, floor 1)."""
    rt = _reload(monkeypatch, KCKILLS_LOW_POWER="1")
    # clipper default = 8 → 4
    assert rt.get_parallelism("clipper") == 4
    # analyzer default = 5 → 2 (int(5*0.5) = 2)
    assert rt.get_parallelism("analyzer") == 2
    # og_generator default = 4 → 2
    assert rt.get_parallelism("og_generator") == 2
    # embedder default = 1 → floor 1 (NOT 0)
    assert rt.get_parallelism("embedder") == 1


def test_low_power_doubles_intervals(monkeypatch: pytest.MonkeyPatch):
    """KCKILLS_LOW_POWER=1 → interval × 2."""
    rt = _reload(monkeypatch, KCKILLS_LOW_POWER="1")
    assert rt.get_interval("clipper") == 600    # 300 * 2
    assert rt.get_interval("analyzer") == 1200  # 600 * 2
    assert rt.get_interval("embedder") == 3600  # 1800 * 2


def test_low_power_does_not_scale_batch_or_lease(monkeypatch: pytest.MonkeyPatch):
    """Batch + lease stay the same under low-power.

    Rationale : batch is a per-cycle CAP — slower cycles already mean
    fewer total rows/hour. Halving the cap does nothing useful and only
    risks under-using the rare cycle that has work to do. Lease must
    stay generous regardless — a slow Gemini call still takes 5-15s.
    """
    rt = _reload(monkeypatch, KCKILLS_LOW_POWER="1")
    assert rt.get_batch_size("clipper") == 200
    assert rt.get_lease_seconds("clipper") == 600


def test_low_power_combined_with_env_override(monkeypatch: pytest.MonkeyPatch):
    """Low-power applies AFTER the env override.

    Example : operator sets PARALLEL_CLIPPER=12 AND LOW_POWER=1.
    Effective = int(12 * 0.5) = 6.
    """
    rt = _reload(
        monkeypatch,
        KCKILLS_PARALLEL_CLIPPER="12",
        KCKILLS_LOW_POWER="1",
    )
    assert rt.get_parallelism("clipper") == 6


def test_unknown_module_falls_back_gracefully(monkeypatch: pytest.MonkeyPatch):
    """Asking for a module not in DEFAULTS returns _FALLBACK, not KeyError."""
    rt = _reload(monkeypatch)
    # Don't crash, return the fallback (1 parallel, 300s interval, etc.)
    assert rt.get_parallelism("does_not_exist") == 1
    assert rt.get_interval("does_not_exist") == 300
    assert rt.get_batch_size("does_not_exist") == 50
    assert rt.get_lease_seconds("does_not_exist") == 300


def test_invalid_env_values_are_ignored(monkeypatch: pytest.MonkeyPatch):
    """Negative, zero, and non-int values fall through to the default."""
    rt = _reload(
        monkeypatch,
        KCKILLS_PARALLEL_CLIPPER="0",         # zero ignored
        KCKILLS_INTERVAL_ANALYZER="-100",     # negative ignored
        KCKILLS_BATCH_CLIPPER="potato",       # garbage ignored
    )
    assert rt.get_parallelism("clipper") == 8       # default
    assert rt.get_interval("analyzer") == 600       # default
    assert rt.get_batch_size("clipper") == 200      # default


def test_snapshot_returns_every_module(monkeypatch: pytest.MonkeyPatch):
    """snapshot() walks DEFAULTS and resolves every entry."""
    rt = _reload(monkeypatch)
    snap = rt.snapshot()
    assert "clipper" in snap
    assert "analyzer" in snap
    assert "embedder" in snap
    # Every entry has all four fields.
    for name, cfg in snap.items():
        assert set(cfg.keys()) == {"parallel", "interval", "batch", "lease"}, name
        assert cfg["parallel"] >= 1, name
        assert cfg["interval"] > 0, name


def test_defaults_table_matches_main_py_intervals(monkeypatch: pytest.MonkeyPatch):
    """Hardcoded intervals in DEFAULTS must match what main.py would
    have used pre-PR. Drift here = silent behaviour change for any
    module not yet env-overridden. This is the regression guard.
    """
    rt = _reload(monkeypatch)
    # Sample of modules whose pre-PR interval is well-known.
    expected = {
        "sentinel":         300,
        "harvester":        600,
        "clipper":          300,
        "analyzer":         600,
        "og_generator":     900,
        "embedder":         1800,
        "moderator":        180,
        "discord_autopost": 60,
        "hls_packager":     1800,
        "heartbeat":        21600,
        "watchdog":         1800,
        "queue_health":     300,
        "job_runner":       30,
    }
    for name, want in expected.items():
        got = rt.get_interval(name)
        assert got == want, f"interval drift for {name}: got {got}, want {want}"


def test_reset_cache_drops_resolved_values(monkeypatch: pytest.MonkeyPatch):
    """reset_cache() lets a test re-resolve after an env mutation.

    This is intentionally test-only — production code does NOT call
    reset_cache(). The test guards that the helper actually works so
    other tests can rely on it.
    """
    rt = _reload(monkeypatch, KCKILLS_PARALLEL_CLIPPER="3")
    assert rt.get_parallelism("clipper") == 3
    monkeypatch.setenv("KCKILLS_PARALLEL_CLIPPER", "9")
    rt.reset_cache()
    assert rt.get_parallelism("clipper") == 9
