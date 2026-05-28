"""
purge_pipeline_jobs_paced.py — Wave 35 #1

Purge pipeline_jobs en batches paced pour libérer le compute Supabase
sans hit le statement_timeout / API gateway timeout.

Pourquoi pas le SQL Editor DELETE direct :
  - DELETE FROM pipeline_jobs WHERE created_at < ... timeout (>30s) sur
    147k+ rows à supprimer en une seule transaction.
  - Le Supabase SQL Editor wrap en transaction → kills l'opération entière.

Stratégie ici :
  - Batches de 500 rows (small enough pour ne pas timeout)
  - 200ms entre batches (rate-limit safe, ~2.5 batches/s)
  - Sort by created_at ASC → drain oldest first
  - Retention configurable (default 3 jours pour succeeded, 7 jours pour failed)
  - Idempotent : safe to re-run sans risque

Usage :
  python worker/scripts/purge_pipeline_jobs_paced.py
  python worker/scripts/purge_pipeline_jobs_paced.py --keep-succeeded-days 7
  python worker/scripts/purge_pipeline_jobs_paced.py --dry-run
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from datetime import datetime, timedelta, timezone

import httpx
from dotenv import load_dotenv

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

_THIS = os.path.dirname(os.path.abspath(__file__))
_WORKER_ROOT = os.path.dirname(_THIS)
sys.path.insert(0, _WORKER_ROOT)
load_dotenv(os.path.join(_WORKER_ROOT, ".env"))

SB_URL = os.environ["SUPABASE_URL"]
SB_KEY = os.environ["SUPABASE_SERVICE_KEY"]
HEADERS = {"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}", "Content-Type": "application/json"}

BATCH_SIZE = 500
DELAY_MS = 200


def count_planned(status: str, cutoff_iso: str) -> int:
    """Quick estimated count via PostgREST head + Range."""
    try:
        r = httpx.head(
            f"{SB_URL}/rest/v1/pipeline_jobs",
            params={"select": "id", "status": f"eq.{status}", "created_at": f"lt.{cutoff_iso}", "limit": "1"},
            headers={**HEADERS, "Prefer": "count=planned", "Range": "0-0"},
            timeout=10,
        )
        cr = r.headers.get("content-range", "")
        if "/" in cr:
            return int(cr.split("/")[-1])
    except Exception:
        pass
    return -1


def purge_status(status: str, cutoff_iso: str, dry_run: bool) -> int:
    """Delete in batches of BATCH_SIZE until no rows remain. Returns total deleted."""
    print(f"\n  Purging status={status} created_at < {cutoff_iso[:19]} ...")
    estimated = count_planned(status, cutoff_iso)
    print(f"    Estimated rows to delete : {estimated:,}")
    if dry_run:
        print("    [DRY RUN] no writes performed")
        return 0
    if estimated <= 0:
        print("    Nothing to purge.")
        return 0

    total = 0
    batches = 0
    started = time.monotonic()
    last_progress = started

    while True:
        # Fetch a batch of IDs to delete (smaller than BATCH_SIZE so the
        # subsequent DELETE WHERE id IN (...) URL stays under 8KB limit).
        try:
            r = httpx.get(
                f"{SB_URL}/rest/v1/pipeline_jobs",
                params={
                    "select": "id",
                    "status": f"eq.{status}",
                    "created_at": f"lt.{cutoff_iso}",
                    "order": "created_at.asc",
                    "limit": str(BATCH_SIZE),
                },
                headers=HEADERS,
                timeout=15,
            )
            if r.status_code != 200:
                print(f"    ! select batch failed status={r.status_code} body={r.text[:200]}")
                break
            rows = r.json()
            if not rows:
                break
            ids = [row["id"] for row in rows]
        except httpx.ReadTimeout:
            print("    ! select batch timed out — retrying in 2s")
            time.sleep(2)
            continue
        except Exception as e:
            print(f"    ! select exception : {e}")
            break

        # DELETE WHERE id IN (...) via PostgREST IN filter
        in_clause = "in.(" + ",".join(ids) + ")"
        try:
            d = httpx.delete(
                f"{SB_URL}/rest/v1/pipeline_jobs",
                params={"id": in_clause},
                headers=HEADERS,
                timeout=20,
            )
            if d.status_code not in (200, 204):
                print(f"    ! delete batch failed status={d.status_code} body={d.text[:200]}")
                break
        except httpx.ReadTimeout:
            print("    ! delete batch timed out — retrying in 3s")
            time.sleep(3)
            continue
        except Exception as e:
            print(f"    ! delete exception : {e}")
            break

        total += len(ids)
        batches += 1
        now = time.monotonic()
        if now - last_progress >= 5 or len(ids) < BATCH_SIZE:
            rate = total / max(1, now - started)
            pct = (100 * total / estimated) if estimated > 0 else 0
            print(f"    progress : {total:,} / ~{estimated:,} ({pct:.1f}%)  rate={rate:.0f} rows/s")
            last_progress = now

        if len(ids) < BATCH_SIZE:
            break  # last partial batch

        time.sleep(DELAY_MS / 1000.0)

    elapsed = time.monotonic() - started
    print(f"    DONE — {total:,} rows deleted in {elapsed:.1f}s ({batches} batches)")
    return total


def main(succeeded_keep_days: int, failed_keep_days: int, dry_run: bool) -> int:
    print("=" * 72)
    print(f"  Pipeline jobs purge — {datetime.now(timezone.utc).isoformat()[:19]} UTC")
    print(f"  Mode : {'DRY RUN' if dry_run else 'APPLY'}")
    print(f"  Keep succeeded : {succeeded_keep_days} days")
    print(f"  Keep failed    : {failed_keep_days} days")
    print("=" * 72)

    now = datetime.now(timezone.utc)
    succeeded_cutoff = (now - timedelta(days=succeeded_keep_days)).isoformat()
    failed_cutoff = (now - timedelta(days=failed_keep_days)).isoformat()

    grand_total = 0
    for status, cutoff in [
        ("succeeded", succeeded_cutoff),
        ("failed", failed_cutoff),
        ("cancelled", succeeded_cutoff),
    ]:
        grand_total += purge_status(status, cutoff, dry_run)

    print(f"\n{'=' * 72}")
    print(f"  TOTAL DELETED : {grand_total:,}")
    print("=" * 72)
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--keep-succeeded-days", type=int, default=3,
                        help="Retention pour status=succeeded (default 3)")
    parser.add_argument("--keep-failed-days", type=int, default=7,
                        help="Retention pour status=failed (default 7)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Compter sans supprimer")
    args = parser.parse_args()
    sys.exit(main(args.keep_succeeded_days, args.keep_failed_days, args.dry_run))
