"""
RUNTIME_STATUS — Print the EFFECTIVE worker tuning after env overrides.

Run this when you're wondering :
  - "Why is the worker only running 4 clip workers ? I set
     KCKILLS_PARALLEL_CLIPPER=12."
  - "Did my KCKILLS_LOW_POWER=1 actually take effect ?"
  - "What's the current interval the daemon will use for analyzer ?"

Output is a plain-text table sized for a 100-col terminal. NO secrets,
NO Supabase contact — just the tuning. Safe to run anywhere, anytime.

Usage :
  cd worker
  python -m scripts.runtime_status

Exit code is always 0 (this script never fails ; it's diagnostic only).
"""

from __future__ import annotations

import os
import sys

# Make the worker root importable when invoked as `python -m scripts.runtime_status`
# from inside worker/. Same path-fix pattern used by tests/test_scheduler.py.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services import runtime_tuning, throttle  # noqa: E402  (after sys.path)


# Box-drawing characters kept ASCII-friendly so the output renders the
# same in cmd.exe / PowerShell / WSL / Linux terminals. No unicode
# surprises on the Windows console codepage.
_HR = "-" * 96


def _format_row(name: str, parallel: int, interval: int, batch: int, lease: int) -> str:
    """One module row in the table."""
    interval_h = _humanize_seconds(interval)
    return (
        f"  {name:<22}"
        f"  parallel={parallel:>3}"
        f"  interval={interval:>5}s ({interval_h:<7})"
        f"  batch={batch:>4}"
        f"  lease={lease:>4}s"
    )


def _humanize_seconds(s: int) -> str:
    """Render an interval in shortest sensible unit. Examples :
        30   -> '30s'
        300  -> '5m'
        3600 -> '1h'
        21600 -> '6h'
    """
    if s < 60:
        return f"{s}s"
    if s < 3600:
        m = s // 60
        return f"{m}m"
    h = s // 3600
    return f"{h}h"


def _highlight_overrides() -> list[str]:
    """List env vars that are currently overriding a default.

    Used at the bottom of the table so the operator can see exactly which
    knobs they (or their startup script) have pushed. Anything not in
    this list is on its hardcoded default.
    """
    out: list[str] = []
    for name in runtime_tuning.known_modules():
        for kind, env_prefix in (
            ("parallel", "KCKILLS_PARALLEL_"),
            ("interval", "KCKILLS_INTERVAL_"),
            ("batch",    "KCKILLS_BATCH_"),
            ("lease",    "KCKILLS_LEASE_"),
        ):
            env_var = f"{env_prefix}{name.upper()}"
            raw = os.environ.get(env_var)
            if raw:
                out.append(f"  {env_var}={raw}")
    if throttle.is_low_power_mode():
        out.append(f"  {throttle.ENV_VAR}={os.environ.get(throttle.ENV_VAR)}")
    return out


def main() -> int:
    snap = runtime_tuning.snapshot()

    print(_HR)
    print("  KCKILLS Worker — Effective Runtime Tuning")
    print(_HR)
    print(f"  {throttle.describe()}")
    print(_HR)

    for name in runtime_tuning.known_modules():
        cfg = snap[name]
        print(_format_row(
            name,
            parallel=cfg["parallel"],
            interval=cfg["interval"],
            batch=cfg["batch"],
            lease=cfg["lease"],
        ))

    print(_HR)
    overrides = _highlight_overrides()
    if overrides:
        print("  Active env overrides :")
        for line in overrides:
            print(line)
    else:
        print("  No env overrides set — every module is on its hardcoded default.")
    print(_HR)
    print(
        "  Tip : restart the worker after changing any KCKILLS_* env var.\n"
        "        Values are cached at process start (one-shot) for safety.",
    )
    print(_HR)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
