"""Tests for services.throttle — the operator-facing low-power switch.

Covers :
  * is_low_power_mode() detects the env var (truthy / falsy / unset).
  * apply_parallel() / apply_interval() apply the multipliers.
  * Multipliers stay in sync with runtime_tuning's internal constants.
  * describe() renders both ON and OFF states cleanly.
  * Falsy values (0, false, no, "") are NOT treated as on.
"""

from __future__ import annotations

import os
import sys

import pytest

# Add worker root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from services import throttle  # noqa: E402


def _clear_low_power(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(throttle.ENV_VAR, raising=False)


def test_is_low_power_mode_unset(monkeypatch: pytest.MonkeyPatch):
    """No env var → low-power off."""
    _clear_low_power(monkeypatch)
    assert throttle.is_low_power_mode() is False


def test_is_low_power_mode_truthy_values(monkeypatch: pytest.MonkeyPatch):
    """1 / true / yes / on (any case) all flip the switch."""
    for raw in ("1", "true", "TRUE", "True", "yes", "YES", "on", "ON", " 1 "):
        monkeypatch.setenv(throttle.ENV_VAR, raw)
        assert throttle.is_low_power_mode() is True, f"failed for {raw!r}"


def test_is_low_power_mode_falsy_values(monkeypatch: pytest.MonkeyPatch):
    """0 / false / no / "" all stay off — no surprise toggles."""
    for raw in ("0", "false", "FALSE", "no", "off", "", "potato"):
        monkeypatch.setenv(throttle.ENV_VAR, raw)
        assert throttle.is_low_power_mode() is False, f"failed for {raw!r}"


def test_apply_parallel_off(monkeypatch: pytest.MonkeyPatch):
    """When low-power is off, apply_parallel is the identity function."""
    _clear_low_power(monkeypatch)
    assert throttle.apply_parallel(8) == 8
    assert throttle.apply_parallel(1) == 1
    assert throttle.apply_parallel(100) == 100


def test_apply_parallel_on(monkeypatch: pytest.MonkeyPatch):
    """Low-power halves parallelism, floored at 1.

    int(8*0.5)=4 ; int(5*0.5)=2 ; int(2*0.5)=1 ; int(1*0.5)=0 → floored to 1.
    """
    monkeypatch.setenv(throttle.ENV_VAR, "1")
    assert throttle.apply_parallel(8) == 4
    assert throttle.apply_parallel(5) == 2
    assert throttle.apply_parallel(2) == 1
    assert throttle.apply_parallel(1) == 1   # floor kicks in
    assert throttle.apply_parallel(0) == 1   # floor kicks in (defensive)


def test_apply_interval_off(monkeypatch: pytest.MonkeyPatch):
    """When low-power is off, apply_interval is the identity function."""
    _clear_low_power(monkeypatch)
    assert throttle.apply_interval(300) == 300
    assert throttle.apply_interval(60) == 60


def test_apply_interval_on(monkeypatch: pytest.MonkeyPatch):
    """Low-power doubles intervals."""
    monkeypatch.setenv(throttle.ENV_VAR, "1")
    assert throttle.apply_interval(300) == 600
    assert throttle.apply_interval(60) == 120
    assert throttle.apply_interval(1800) == 3600


def test_describe_off(monkeypatch: pytest.MonkeyPatch):
    """describe() shows OFF when env unset."""
    _clear_low_power(monkeypatch)
    out = throttle.describe()
    assert "OFF" in out
    assert "x1.0" in out


def test_describe_on(monkeypatch: pytest.MonkeyPatch):
    """describe() shows ON + the multipliers when env truthy."""
    monkeypatch.setenv(throttle.ENV_VAR, "1")
    out = throttle.describe()
    assert "ON" in out
    assert "x0.5" in out
    assert "x2.0" in out


def test_multipliers_match_runtime_tuning():
    """throttle's public multipliers MUST equal runtime_tuning's private
    constants. If they drift, the operator-facing knob and the actual
    tuning math diverge — exactly the bug this whole module is here to
    prevent.
    """
    # Re-import so we always see the latest values, not a stale cache.
    import importlib
    if "services.runtime_tuning" in sys.modules:
        importlib.reload(sys.modules["services.runtime_tuning"])
    import services.runtime_tuning as rt
    assert throttle.PARALLEL_MULTIPLIER == rt._LOW_POWER_PARALLEL_MULTIPLIER
    assert throttle.INTERVAL_MULTIPLIER == rt._LOW_POWER_INTERVAL_MULTIPLIER
