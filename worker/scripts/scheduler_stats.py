"""scheduler_stats.py — live scheduler ledger (Wave 33).

Affiche les compteurs courants du scheduler partagé :
  - RPD utilisée par service (gemini, youtube_search)
  - USD dépensé sur le jour (Wave 33 cost guard)
  - Headroom restant sur les deux axes

Sert au monitoring ops : "est-ce qu'on est près de la quota Gemini ?",
"combien il reste de budget $ aujourd'hui ?". Peut être appelé en cron
toutes les 10 minutes pour balancer un message Discord avec l'état.

Usage :
  python worker/scripts/scheduler_stats.py
  python worker/scripts/scheduler_stats.py --json   # output machine-readable
"""

from __future__ import annotations

import argparse
import json
import os
import sys

# Windows console default code page (cp1252) chokes on the box-drawing
# characters we use for the ASCII bars + headers. Force UTF-8 on stdout
# so the script works as-is in `cmd.exe` / scheduled tasks too.
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

_THIS = os.path.dirname(os.path.abspath(__file__))
_WORKER_ROOT = os.path.dirname(_THIS)
sys.path.insert(0, _WORKER_ROOT)

from scheduler import scheduler  # noqa: E402
from config import config  # noqa: E402


def _bar(pct: float, width: int = 24) -> str:
    """Tiny ASCII bar at the given percent (0-100)."""
    pct = max(0.0, min(100.0, pct))
    filled = int(width * pct / 100)
    return "█" * filled + "░" * (width - filled)


def main(as_json: bool) -> int:
    stats = scheduler.get_stats()
    if as_json:
        # Add some derived fields useful for downstream consumers
        out = {
            **stats,
            "tier": config._GEMINI_TIER,
            "models": {
                "analyzer": config.GEMINI_MODEL_ANALYZER,
                "qc":       config.GEMINI_MODEL_QC,
                "offset":   config.GEMINI_MODEL_OFFSET,
                "quotes":   config.GEMINI_MODEL_QUOTES,
            },
            "auto_upgrade_threshold": config.GEMINI_AUTO_UPGRADE_SCORE_THRESHOLD,
            "auto_upgrade_model": config.GEMINI_AUTO_UPGRADE_MODEL,
            "thinking_budget": config.GEMINI_THINKING_BUDGET,
        }
        print(json.dumps(out, indent=2, default=str))
        return 0

    print("═" * 64)
    print(f"  SCHEDULER STATS — reset_date={stats.get('reset_date', '?')}")
    print("═" * 64)
    print(f"  Tier : {config._GEMINI_TIER}")
    print(f"  Auto-upgrade : threshold={config.GEMINI_AUTO_UPGRADE_SCORE_THRESHOLD} "
          f"model={config.GEMINI_AUTO_UPGRADE_MODEL}")
    print(f"  Thinking budget : {config.GEMINI_THINKING_BUDGET}")
    print()
    print("  ── RPD (Requests Per Day) ─────────────────────────────")
    counts = stats.get("daily_counts", {})
    remaining = stats.get("daily_remaining", {})
    for service in sorted(counts):
        used = counts[service]
        rem = remaining.get(service, 0)
        total = used + rem
        pct = (100 * used / total) if total else 0
        print(f"  {service:<18} {used:>5,} / {total:>5,}  "
              f"[{_bar(pct)}] {pct:5.1f}%  rem={rem:,}")
    if not counts:
        print("  (aucun call enregistré aujourd'hui)")

    print()
    print("  ── Budget USD (Wave 33 cost guard) ─────────────────────")
    cost_usd = stats.get("daily_cost_usd", {})
    cost_rem = stats.get("daily_cost_remaining_usd", {})
    if not cost_usd and not cost_rem:
        print("  (aucun cap configuré ou aucune dépense enregistrée)")
    else:
        for service in sorted({*cost_usd, *cost_rem}):
            spent = cost_usd.get(service, 0.0)
            rem = cost_rem.get(service)
            if rem is None:
                # No cap configured — just show spend.
                print(f"  {service:<18} ${spent:.3f}  (no cap)")
                continue
            cap = spent + rem
            pct = (100 * spent / cap) if cap > 0 else 0
            print(f"  {service:<18} ${spent:6.3f} / ${cap:6.2f}  "
                  f"[{_bar(pct)}] {pct:5.1f}%  rem=${rem:.3f}")

    print("═" * 64)
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true", help="JSON output")
    args = parser.parse_args()
    sys.exit(main(args.json))
