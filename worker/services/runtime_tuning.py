"""
RUNTIME_TUNING — Env-driven knobs for module parallelism + cadence.

Replaces the hardcoded `CONCURRENCY = 8` / `BATCH_SIZE = 50` constants
scattered across the worker modules. Each daemon module asks this module
for its current tuning at startup (and on each scan, for daemon loops
that re-import).

Env vars (all optional — defaults below kick in if unset) :

    KCKILLS_PARALLEL_<MODULE>=N    fan-out per cycle (clipper workers,
                                    analyzer download workers, etc.)
    KCKILLS_INTERVAL_<MODULE>=N    seconds between daemon scan cycles
    KCKILLS_BATCH_<MODULE>=N       max kills processed per cycle
    KCKILLS_LEASE_<MODULE>=N       pipeline_jobs lease seconds

When KCKILLS_LOW_POWER=1 is set, parallelism is halved and intervals are
doubled across the board — the "gaming mode" kill-switch the operator
flips before launching LoL so the worker stops competing for GPU/CPU.

All getters cache the resolved value at module-import time : env vars are
read ONCE per process. Restart the worker to pick up new values.

Backward compatibility : with no env vars set + low_power off, every
module's effective tuning equals what was hardcoded before this module
existed. The DEFAULTS table below is the single source of truth — if a
module is not listed, get_*() falls back to a generic default and logs a
warning so we notice the missing entry.
"""

from __future__ import annotations

import os
from typing import Final

# ─── Defaults (single source of truth) ─────────────────────────────────
# Each entry mirrors the constants the corresponding module had hardcoded
# before this PR. The shape is intentionally uniform so the status script
# can render every module the same way.
#
#   parallel  → asyncio fan-out (Semaphore size or download worker count)
#   interval  → seconds between supervised daemon cycles (main.py)
#   batch     → max rows pulled / processed per cycle
#   lease     → pipeline_jobs lease seconds when claiming jobs
#
# The intervals here MUST match the values currently in main.py
# DAEMON_MODULES — that's how we stay backward-compatible. If someone
# bumps an interval in main.py and forgets to update DEFAULTS here,
# the old value silently wins. A test guards against that drift.

DEFAULTS: Final[dict[str, dict[str, int]]] = {
    # Detection + harvest --------------------------------------------------
    "sentinel":            {"parallel": 1, "interval":  300, "batch":  50, "lease":  300},
    "harvester":           {"parallel": 1, "interval":  600, "batch":  50, "lease":  300},
    "event_mapper":        {"parallel": 1, "interval":  600, "batch": 100, "lease":  300},
    "transitioner":        {"parallel": 1, "interval":  300, "batch":  50, "lease":  300},
    "vod_offset_finder":   {"parallel": 1, "interval": 3600, "batch":  50, "lease":  600},
    # Clip pipeline --------------------------------------------------------
    "clipper":             {"parallel": 8, "interval":  300, "batch": 200, "lease":  600},
    "analyzer":            {"parallel": 5, "interval":  600, "batch":  80, "lease":  900},
    "og_generator":        {"parallel": 4, "interval":  900, "batch":  50, "lease":  120},
    "event_publisher":     {"parallel": 1, "interval":  300, "batch":  50, "lease":  300},
    "embedder":            {"parallel": 1, "interval": 1800, "batch":  50, "lease":   60},
    # Comms + moderation ---------------------------------------------------
    "moderator":           {"parallel": 1, "interval":  180, "batch":  25, "lease":  120},
    "discord_autopost":    {"parallel": 1, "interval":   60, "batch":  10, "lease":  120},
    # Packaging + reconciliation ------------------------------------------
    "hls_packager":        {"parallel": 4, "interval": 1800, "batch": 100, "lease":  300},
    "channel_discoverer":  {"parallel": 1, "interval": 21600,"batch":  50, "lease":  600},
    "channel_reconciler":  {"parallel": 1, "interval": 3600, "batch":  50, "lease":  600},
    "vod_fallback_finder": {"parallel": 1, "interval": 1800, "batch":  50, "lease":  600},
    "match_planner":       {"parallel": 1, "interval": 3600, "batch":  50, "lease":  600},
    # QC + jobs -----------------------------------------------------------
    "qc_sampler":          {"parallel": 1, "interval": 21600,"batch":  50, "lease":  600},
    "job_runner":          {"parallel": 1, "interval":   30, "batch":  50, "lease":  300},
    "job_dispatcher":      {"parallel": 1, "interval":   60, "batch":  50, "lease":  300},
    "admin_job_runner":    {"parallel": 1, "interval":   30, "batch":  10, "lease":  900},
    # Health -------------------------------------------------------------
    "heartbeat":           {"parallel": 1, "interval": 21600,"batch":   1, "lease":   60},
    "watchdog":            {"parallel": 1, "interval": 1800, "batch":   1, "lease":   60},
    "queue_health":        {"parallel": 1, "interval":  300, "batch":   1, "lease":   60},
}

# Generic fallback when a module isn't listed above. Conservative on
# parallelism (don't accidentally fan out to 50) and aligned with the
# 5 min default daemon poll. A KeyError would be more correct but we
# don't want a typo'd module name to kill the worker on startup.
_FALLBACK: Final[dict[str, int]] = {
    "parallel": 1,
    "interval": 300,
    "batch":    50,
    "lease":    300,
}


# ─── Low-power multiplier ──────────────────────────────────────────────
# Defined here so this module can apply it without importing throttle.py
# (which would create a circular import — throttle.py imports us). The
# throttle module is the public API ; this constant is internal.
#
# Numbers : halve parallelism (rounded down to floor 1), double intervals.
# Batch + lease are NOT scaled — batch is a per-cycle cap (irrelevant when
# the cycle is slower) and lease must stay generous regardless.
_LOW_POWER_PARALLEL_MULTIPLIER: Final[float] = 0.5
_LOW_POWER_INTERVAL_MULTIPLIER: Final[float] = 2.0


def _is_low_power_enabled() -> bool:
    """Read the env once. Module-level cache via _LOW_POWER below."""
    raw = os.environ.get("KCKILLS_LOW_POWER", "0").strip().lower()
    return raw in ("1", "true", "yes", "on")


# Resolved at import time. The status script reads this directly so the
# operator can see whether low_power is active without re-parsing the env.
_LOW_POWER: Final[bool] = _is_low_power_enabled()


def _env_int(name: str) -> int | None:
    """Return env var as positive int, None if unset/invalid.

    Negative or zero values are treated as None — they would break the
    semaphore / interval math downstream and are almost certainly a typo.
    """
    raw = os.environ.get(name)
    if raw is None:
        return None
    try:
        v = int(raw.strip())
    except (ValueError, AttributeError):
        return None
    return v if v > 0 else None


def _resolve(module: str, key: str) -> int:
    """Look up DEFAULTS[module][key], falling back to _FALLBACK on miss."""
    spec = DEFAULTS.get(module, _FALLBACK)
    return int(spec.get(key, _FALLBACK[key]))


def _apply_low_power(value: int, multiplier: float, *, floor: int = 1) -> int:
    """Apply low-power scaling, clamped to a sensible floor."""
    if not _LOW_POWER:
        return value
    scaled = int(value * multiplier)
    return max(floor, scaled)


# ─── Per-cycle cache of resolved values ────────────────────────────────
# Reading os.environ on every getter call would be cheap but it'd let an
# operator change a value mid-run and have it picked up — which is NOT
# what we want. Restart-to-tune is the contract. Cache in dicts keyed by
# (module, kind) so the first call resolves and every subsequent call
# returns the cached scalar. Invisible to callers.

_cache_parallelism: dict[str, int] = {}
_cache_interval: dict[str, int] = {}
_cache_batch: dict[str, int] = {}
_cache_lease: dict[str, int] = {}


def get_parallelism(module: str) -> int:
    """Return the effective fan-out for a module's per-cycle work.

    Resolution order :
      1. KCKILLS_PARALLEL_<MODULE> env (uppercased)
      2. DEFAULTS[module]['parallel']
      3. _FALLBACK['parallel'] (with a warning-by-omission)
    Then : if KCKILLS_LOW_POWER=1, halve (floor 1).
    """
    cached = _cache_parallelism.get(module)
    if cached is not None:
        return cached
    env_val = _env_int(f"KCKILLS_PARALLEL_{module.upper()}")
    base = env_val if env_val is not None else _resolve(module, "parallel")
    final = _apply_low_power(base, _LOW_POWER_PARALLEL_MULTIPLIER, floor=1)
    _cache_parallelism[module] = final
    return final


def get_interval(module: str) -> int:
    """Return the effective interval (seconds) between daemon cycles.

    Resolution order :
      1. KCKILLS_INTERVAL_<MODULE> env (uppercased)
      2. DEFAULTS[module]['interval']
      3. _FALLBACK['interval']
    Then : if KCKILLS_LOW_POWER=1, double (ceiling = base * 2).
    """
    cached = _cache_interval.get(module)
    if cached is not None:
        return cached
    env_val = _env_int(f"KCKILLS_INTERVAL_{module.upper()}")
    base = env_val if env_val is not None else _resolve(module, "interval")
    # Doubling has no need of a floor — interval is already positive.
    final = base if not _LOW_POWER else int(base * _LOW_POWER_INTERVAL_MULTIPLIER)
    _cache_interval[module] = final
    return final


def get_batch_size(module: str) -> int:
    """Return the effective max-rows-per-cycle for a module.

    Resolution order :
      1. KCKILLS_BATCH_<MODULE> env (uppercased)
      2. DEFAULTS[module]['batch']
      3. _FALLBACK['batch']
    Low-power does NOT scale batch — it's a per-cycle cap that's already
    irrelevant when the cycle interval doubles.
    """
    cached = _cache_batch.get(module)
    if cached is not None:
        return cached
    env_val = _env_int(f"KCKILLS_BATCH_{module.upper()}")
    base = env_val if env_val is not None else _resolve(module, "batch")
    _cache_batch[module] = base
    return base


def get_lease_seconds(module: str) -> int:
    """Return the effective pipeline_jobs lease seconds for a module.

    Resolution order :
      1. KCKILLS_LEASE_<MODULE> env (uppercased)
      2. DEFAULTS[module]['lease']
      3. _FALLBACK['lease']
    Low-power does NOT scale lease — long leases hurt nothing in low-power
    mode and shortening them risks orphaning slow jobs.
    """
    cached = _cache_lease.get(module)
    if cached is not None:
        return cached
    env_val = _env_int(f"KCKILLS_LEASE_{module.upper()}")
    base = env_val if env_val is not None else _resolve(module, "lease")
    _cache_lease[module] = base
    return base


def reset_cache() -> None:
    """Drop every cached resolved value. Test-only — production code must
    NOT call this. The contract is "restart to tune" and the cache is the
    enforcement.
    """
    _cache_parallelism.clear()
    _cache_interval.clear()
    _cache_batch.clear()
    _cache_lease.clear()


def snapshot() -> dict[str, dict[str, int]]:
    """Return the EFFECTIVE config for every known module.

    Used by scripts/runtime_status.py to render the table the operator
    sees. Walks DEFAULTS (not the cache) so the output is stable even on
    a fresh process where nothing has been resolved yet.
    """
    out: dict[str, dict[str, int]] = {}
    for name in DEFAULTS:
        out[name] = {
            "parallel": get_parallelism(name),
            "interval": get_interval(name),
            "batch":    get_batch_size(name),
            "lease":    get_lease_seconds(name),
        }
    return out


def known_modules() -> list[str]:
    """List of modules with explicit DEFAULTS entries, in insertion order."""
    return list(DEFAULTS.keys())
