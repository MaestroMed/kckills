"""
THROTTLE — Operator-facing low-power switch for the worker.

Public entry point :
    from services.throttle import is_low_power_mode

When True, the runtime_tuning getters automatically halve parallelism and
double intervals — the worker stops competing for CPU/GPU/network so the
operator can launch a game without the clipper queueing up 8 ffmpeg passes
at once.

Usage :
    # Bash : KCKILLS_LOW_POWER=1 python main.py
    # PowerShell : $env:KCKILLS_LOW_POWER=1; python main.py
    # CMD : set KCKILLS_LOW_POWER=1 && python main.py

The env var is read ONCE at process start (cached in runtime_tuning).
Toggle = restart the worker. We could watch the env at runtime but the
risk-vs-benefit isn't there — `Stop daemon → set var → start daemon` is
~3 seconds and avoids races between the change taking effect mid-cycle.

Also exposes the multipliers as module-level constants so the status
script can render "low-power: ON (parallel x0.5, interval x2)" without
duplicating the math.
"""

from __future__ import annotations

import os
from typing import Final

# Multipliers are duplicated from runtime_tuning so the status script can
# show them without importing the private symbol. They MUST stay in sync —
# a unit test in tests/test_throttle.py asserts equality.
PARALLEL_MULTIPLIER: Final[float] = 0.5
INTERVAL_MULTIPLIER: Final[float] = 2.0

# Env var name documented here (single source of truth so the .env.example
# section, the docstrings, and the test all agree).
ENV_VAR: Final[str] = "KCKILLS_LOW_POWER"

# Truthy values accepted. We're permissive on case + a few common spellings
# because the operator sets this from a shell rc / startup script and we
# don't want a typo to silently fall back to "off".
_TRUTHY: Final[frozenset[str]] = frozenset({"1", "true", "yes", "on"})


def is_low_power_mode() -> bool:
    """Return True when KCKILLS_LOW_POWER is set to a truthy value.

    Read on every call (NOT cached) — this getter is the test-time hook,
    and runtime_tuning has its own one-shot cache for the resolved values
    that actually drive the worker. Keeping this getter live lets a test
    flip the env between assertions.
    """
    raw = os.environ.get(ENV_VAR, "")
    return raw.strip().lower() in _TRUTHY


def apply_parallel(value: int) -> int:
    """Apply low-power multiplier to a parallelism count, floor 1.

    Used by callers that want to scale a value computed elsewhere (e.g.
    a test asserting the math). Production code should call
    runtime_tuning.get_parallelism() instead, which already applies this.
    """
    if not is_low_power_mode():
        return value
    return max(1, int(value * PARALLEL_MULTIPLIER))


def apply_interval(value: int) -> int:
    """Apply low-power multiplier to an interval (seconds).

    Same notes as apply_parallel — production code should go through
    runtime_tuning.get_interval(). This helper exists so test code and
    diagnostic scripts can compute the same scaled value without
    duplicating the multiplier.
    """
    if not is_low_power_mode():
        return value
    return int(value * INTERVAL_MULTIPLIER)


def describe() -> str:
    """One-line human description for the status script + log lines.

    Examples :
        "low-power: OFF (parallel x1.0, interval x1.0)"
        "low-power: ON  (parallel x0.5, interval x2.0)"
    """
    on = is_low_power_mode()
    if on:
        return (
            f"low-power: ON  "
            f"(parallel x{PARALLEL_MULTIPLIER}, interval x{INTERVAL_MULTIPLIER})"
        )
    return "low-power: OFF (parallel x1.0, interval x1.0)"
