"""
seed_bracket.py — Monthly bracket tournament seeder (Wave 30h).

Calls `fn_seed_monthly_bracket(p_month_year)` on Supabase to create a
new tournament + Round 1 seed for the target calendar month. Designed
to run on the 1st of each month (or manually for backfill).

Usage:
    # Seed the PREVIOUS calendar month (default mode — what cron should call):
    python seed_bracket.py

    # Seed a specific month (admin / backfill):
    python seed_bracket.py --month 2026-04

    # Dry-run : show what month would be seeded without hitting Supabase:
    python seed_bracket.py --dry-run

Behaviour:
    * If the target month's tournament already exists (slug collision), the
      RPC is idempotent and returns the existing row — no duplicate writes.
    * The RPC enforces `service_role` GRANT, so we MUST use the service
      key (SUPABASE_SERVICE_KEY env var), not the anon key.
    * Logs the resulting tournament's id + slug + bracket_size for
      operator confirmation.

Integration TODO (cron / daemon hooks — NOT yet implemented):
    * Cron : add `0 2 1 * * cd /path/worker && python seed_bracket.py`
      to seed every 1st of the month at 02:00 UTC.
    * Task Scheduler (Windows) : create a monthly trigger pointing at
      install_task.ps1 wrapper.
    * The orchestrator (worker/main.py) could also fire this as a
      `at_startup_then_monthly` task — useful when the box has been
      offline through a month boundary.
    * Push notifications (Wave 30g infra) : when a new round opens,
      ping subscribers via /api/push/send. Add the trigger to the
      same daemon that calls fn_close_round daily — this script
      only HANDLES seeding, not round transitions.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import urllib.request
import urllib.error

from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")


def previous_month_iso() -> str:
    """Return the previous calendar month as 'YYYY-MM'."""
    today = dt.date.today()
    first_of_this_month = today.replace(day=1)
    last_of_prev = first_of_this_month - dt.timedelta(days=1)
    return f"{last_of_prev.year:04d}-{last_of_prev.month:02d}"


def call_seed_rpc(month_year: str) -> dict:
    """POST to fn_seed_monthly_bracket via Supabase REST. Returns the first row."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise RuntimeError(
            "SUPABASE_URL or SUPABASE_SERVICE_KEY missing from environment. "
            "Set them in .env or the shell before running."
        )

    url = f"{SUPABASE_URL}/rest/v1/rpc/fn_seed_monthly_bracket"
    payload = json.dumps({"p_month_year": month_year}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        method="POST",
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            body = r.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(
            f"seed RPC failed ({e.code} {e.reason}): {body}"
        ) from e

    rows = json.loads(body)
    if not isinstance(rows, list) or len(rows) == 0:
        raise RuntimeError(f"seed RPC returned no rows: {body}")
    return rows[0]


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Seed the monthly bracket tournament.",
    )
    parser.add_argument(
        "--month",
        help="Target month as YYYY-MM. Defaults to the previous calendar month.",
        default=None,
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the target month and exit without hitting Supabase.",
    )
    args = parser.parse_args()

    target = args.month or previous_month_iso()

    # Validate format early so we get a clean local error vs a 400 from PG.
    if not target or len(target) != 7 or target[4] != "-":
        print(f"[seed_bracket] invalid month format: {target!r} (expected YYYY-MM)", file=sys.stderr)
        return 2
    try:
        year, month = int(target[:4]), int(target[5:7])
        if year < 2020 or year > 2099 or month < 1 or month > 12:
            raise ValueError
    except ValueError:
        print(f"[seed_bracket] invalid month: {target!r}", file=sys.stderr)
        return 2

    print(f"[seed_bracket] target month: {target}")

    if args.dry_run:
        print("[seed_bracket] dry-run — exiting without hitting Supabase.")
        return 0

    try:
        row = call_seed_rpc(target)
    except RuntimeError as e:
        print(f"[seed_bracket] ERROR: {e}", file=sys.stderr)
        return 1

    tid = row.get("tournament_id")
    slug = row.get("slug")
    name = row.get("name")
    size = row.get("bracket_size")
    seeded = row.get("seeded_kills")

    print(f"[seed_bracket] OK")
    print(f"  tournament_id : {tid}")
    print(f"  slug          : {slug}")
    print(f"  name          : {name}")
    print(f"  bracket_size  : {size}")
    print(f"  seeded_kills  : {seeded}")
    print(f"")
    print(f"  /bracket/{slug} will go live once the bracket opens.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
