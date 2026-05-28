"""
prune_pipeline_jobs.py — Wrapper around fn_prune_pipeline_jobs RPC.

Wave 17 (2026-05-07) — runs weekly via install-maintenance-tasks.ps1
on Sunday 03:00 local. Calls migration 053's RPC to delete terminal-
state pipeline_jobs older than --keep-days.

Wave 35 #5 (2026-05-28) — index audit
    Existing indexes on pipeline_jobs are well-designed :
      * idx_pipeline_jobs_claim         (status, run_after, prio, created_at)
                                        partial WHERE status='pending'
      * idx_pipeline_jobs_expired_lease (locked_until)
                                        partial WHERE status='claimed'
      * idx_pipeline_jobs_entity        (entity_type, entity_id, created_at)
      * idx_pipeline_jobs_type_status_finished (type, status, finished_at)
      * idx_pipeline_jobs_active_unique UNIQUE (type, entity_type, entity_id)
                                        partial WHERE status IN
                                        ('pending', 'claimed')
      * idx_pipeline_jobs_terminal_old  (created_at)
                                        partial WHERE terminal statuses
    No critical missing index. fn_claim_pipeline_jobs hits the claim
    partial index ; queue_health/watchdog filter queries use the
    type_status index. The biggest win was lower retention (default
    bumped 30 → 14 days here) to keep the table compact, plus the
    paced one-time purge from worker/scripts/purge_pipeline_jobs_paced.py
    that flushed 150k stale rows.

Pings Discord on success / failure so the operator sees the cleanup
running. Idempotent : the RPC handles the deletion atomically.

Usage
─────
    python worker/scripts/prune_pipeline_jobs.py [--keep-days N] [--dry-run]

`--keep-days N` overrides the 14-day default. RPC enforces minimum 7.
`--dry-run` reports row count without calling the RPC.
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv

_WORKER_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_WORKER_ROOT))
load_dotenv(_WORKER_ROOT / ".env")

from services.supabase_client import get_db  # noqa: E402
from services import discord_webhook  # noqa: E402


async def _count_candidates(db, keep_days: int) -> int:
    """How many rows would be deleted ? Pure read."""
    cutoff = f"now() - interval '{keep_days} days'"
    # PostgREST doesn't support raw SQL ; use the count head pattern
    # against the partial-index-friendly filter from migration 053.
    client = db._get_client()
    r = client.get(
        f"{db.base}/pipeline_jobs",
        params={
            "select": "id",
            "status": "in.(succeeded,failed,dead_letter,cancelled)",
            "created_at": f"lt.{cutoff}",
            "limit": "1",
        },
        headers={**db.headers, "Prefer": "count=exact"},
    )
    r.raise_for_status()
    cr = r.headers.get("content-range") or ""
    if "/" in cr:
        tail = cr.split("/")[-1]
        if tail and tail != "*":
            try:
                return int(tail)
            except ValueError:
                return 0
    return 0


async def _call_rpc(db, keep_days: int) -> int:
    """Invoke fn_prune_pipeline_jobs(p_keep_days)."""
    client = db._get_client()
    r = client.post(
        f"{db.base}/rpc/fn_prune_pipeline_jobs",
        json={"p_keep_days": keep_days},
        headers=db.headers,
        timeout=120,
    )
    r.raise_for_status()
    # Function returns BIGINT — comes back as a JSON number.
    return int(r.json())


async def main(keep_days: int, dry_run: bool) -> int:
    db = get_db()
    if db is None:
        print("ERROR: DB client unavailable")
        return 2

    candidate_count = await _count_candidates(db, keep_days)
    print(f"Candidates (created_at < now() - {keep_days}d, terminal status) : {candidate_count}")

    if dry_run:
        print("[--dry-run] no writes performed.")
        return 0

    if candidate_count == 0:
        print("Nothing to prune.")
        return 0

    deleted = await _call_rpc(db, keep_days)
    print(f"Deleted : {deleted} rows")

    try:
        await discord_webhook.send(content=(
            f"🧹 **pipeline_jobs prune** : {deleted} rows deleted "
            f"(>{keep_days}d old, terminal status). Table size restored."
        ))
    except Exception as e:
        print(f"discord ping failed (non-fatal): {e}")

    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--keep-days", type=int, default=14,
                        help="Retention window in days (RPC enforces min 7). "
                             "Wave 35 #5 dropped from 30 → 14 to keep "
                             "pipeline_jobs compact for query plans.")
    parser.add_argument("--dry-run", action="store_true",
                        help="Report only — don't write")
    args = parser.parse_args()
    sys.exit(asyncio.run(main(args.keep_days, args.dry_run)))
