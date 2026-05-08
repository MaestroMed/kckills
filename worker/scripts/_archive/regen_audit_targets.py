"""Regenerate the 45 problematic clip descriptions identified by the
Opus 4.7 audit on /scroll content quality.

Usage:
    python -m scripts.regen_audit_targets
    python -m scripts.regen_audit_targets --dry-run   # list targets only
    python -m scripts.regen_audit_targets --limit 10  # cap N for safety

Targets two buckets per the audit:
  - 14 critical (encoding, hallucination, credit_wrong) — MUST regen
  - 31 shallow (creux / generic / sub-3.5 score) — SHOULD regen

Each target row is reset:
  - status        → 'clipped' (the analyzer pass picks it up)
  - retry_count   → 0
  - ai_description → NULL (forces re-write)
  - ai_tags        → []

The analyzer module's new prompt v4 + post-validation will catch any
quality regression before re-publishing.
"""

from __future__ import annotations

import argparse
import sys
import os
from pathlib import Path

# Allow running from worker/ directly via `python -m scripts.regen_audit_targets`
ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import httpx
import structlog

from services.supabase_client import get_db

log = structlog.get_logger()


# ─── Audit Opus 4.7 — IDs problematiques identifies ────────────────────
# Section 7 du rapport. ID = 8 premiers caracteres du UUID, complete par
# le script en lookup live (les UUIDs evoluent rarement).

CRITICAL_PREFIXES = [
    "1bd24fb9",  # encoding LaTeX residual
    "0c02536c",  # HTML entities
    "648c9659",  # hallucination Kalista (matchup = Maokai)
    "d34e19d6",  # hallucination Blitzcrank + faux team G2
    "04adf926",  # hallucination Nami
    "ba3af2ec",  # credit Canna alors que Kyeahoo
    "6c2ec3d0",  # credit Canna alors que Caliste (Xayah)
    "6f66ec48",  # credit Yike alors que Caliste (Corki)
    "182e935c",  # oxymore "teamfight sans assistance"
    "1d6240ee",  # invention "lance-tolet"
    "86f5c7a9",  # credit Caliste sur Aurora (mauvaise lane)
    "fba802c0",  # formulation confuse Caliste/Ashe
    "3c7d6adf",  # "721 HP" sans kill_visible suspect
    "ac2f9887",  # Nautilus cite mais Busio joue Rell
]

SHALLOW_PREFIXES = [
    "1a6c36fa", "2169600b", "30fdd590", "b4b6f292", "4abaa5da",
    "2bc14254", "32d66b30", "a817524c", "ab5d2511", "c657a8ce",
    "54e461ac", "cff78383", "4c045e4d", "72f20f63", "a99cc105",
    "bf7ecfd5", "b7f7674f", "16d705d6", "1ac82c0f", "1c371756",
    "faecb93a", "9414a3f7", "0fad7063", "af68581e", "4310e903",
    "7f02ec85", "471e80f9", "ca7e53f6", "c79330c0", "22c7819a",
    "b3365265",
]

ALL_PREFIXES = CRITICAL_PREFIXES + SHALLOW_PREFIXES


def fetch_full_uuids(db, prefixes: list[str]) -> dict[str, dict]:
    """Resolve 8-char prefixes to full UUIDs via a single batched query."""
    # Postgres LIKE on UUID requires a text cast.
    # We avoid OR-chaining by using `id::text ILIKE` — but PostgREST
    # doesn't support arbitrary functions, so we fetch all published
    # rows and filter client-side. With 340-500 rows this is fast.
    r = httpx.get(
        f"{db.base}/kills",
        headers=db.headers,
        params={
            "select": "id,killer_champion,victim_champion,ai_description,status,highlight_score",
            "status": "eq.published",
            "limit": 1000,
        },
        timeout=30.0,
    )
    r.raise_for_status()
    all_rows = r.json()
    out: dict[str, dict] = {}
    prefix_set = {p.lower() for p in prefixes}
    for row in all_rows:
        rid = row.get("id", "")
        prefix = rid[:8].lower()
        if prefix in prefix_set:
            out[prefix] = row
    return out


def reset_for_regen(db, kill_id: str) -> bool:
    """Reset a single row so the analyzer will re-process it."""
    pr = httpx.patch(
        f"{db.base}/kills",
        headers={**db.headers, "Prefer": "return=minimal"},
        params={"id": f"eq.{kill_id}"},
        json={
            "status": "clipped",
            "retry_count": 0,
            "ai_description": None,
            "ai_tags": [],
        },
        timeout=20.0,
    )
    pr.raise_for_status()
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true",
                    help="List targets without modifying anything.")
    ap.add_argument("--limit", type=int, default=None,
                    help="Cap the number of resets (safety).")
    ap.add_argument("--critical-only", action="store_true",
                    help="Only the 14 critical IDs (skip the 31 shallow).")
    args = ap.parse_args()

    db = get_db()
    if not db:
        print("ERROR: no Supabase config", file=sys.stderr)
        sys.exit(1)

    targets = CRITICAL_PREFIXES if args.critical_only else ALL_PREFIXES
    print(f"Target prefixes: {len(targets)} ({len(CRITICAL_PREFIXES)} critical + "
          f"{len(SHALLOW_PREFIXES) if not args.critical_only else 0} shallow)")

    print("Resolving prefixes to full UUIDs...")
    resolved = fetch_full_uuids(db, targets)
    print(f"Resolved: {len(resolved)} / {len(targets)}")
    missing = [p for p in targets if p not in resolved]
    if missing:
        print(f"MISSING (not in published table): {missing}")

    items = list(resolved.values())
    if args.limit:
        items = items[: args.limit]

    print(f"\nWill reset {len(items)} rows for regeneration:\n")
    for row in items:
        kid = row["id"]
        prefix = kid[:8]
        is_critical = prefix in CRITICAL_PREFIXES
        tag = "[CRIT]" if is_critical else "[SOFT]"
        score = row.get("highlight_score")
        score_str = f"{score:.1f}" if score is not None else "?"
        desc = (row.get("ai_description") or "(empty)")[:70]
        print(f"  {tag} {prefix} score={score_str} {row.get('killer_champion')} -> {row.get('victim_champion')}")
        print(f"         \"{desc}\"")

    if args.dry_run:
        print("\nDry-run mode — no changes made.")
        return

    print("\nProceed? Type 'yes' to reset:")
    confirm = input("> ").strip().lower()
    if confirm != "yes":
        print("Aborted.")
        return

    ok = 0
    fail = 0
    for row in items:
        try:
            reset_for_regen(db, row["id"])
            ok += 1
        except Exception as e:
            print(f"  FAILED {row['id'][:8]}: {e}")
            fail += 1

    print(f"\nDone. reset={ok} fail={fail}")
    print("\nNext step: the daemon's analyzer module will pick these up on the")
    print("next cycle (~10 min) and re-write descriptions with prompt v4 +")
    print("post-validation. Tail the worker log to follow:")
    print("  python main.py analyzer    # to run one pass immediately")


if __name__ == "__main__":
    main()
