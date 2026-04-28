"""
release_zombie_claims.py — One-shot maintenance to free pipeline_jobs
zombies that the regular `fn_release_stale_pipeline_locks` can't catch.

Background
──────────
The 2026-04-28 incident found 198 `clip.create` jobs in `claimed` state
held by a long-dead worker (`clipper-24312`) with `attempts = 4` against
`max_attempts = 3`. Two pathological aspects :

1. `attempts > max_attempts` should never happen via the legitimate
   path — `fn_claim_pipeline_jobs` re-claims via the OR clause only
   when `attempts < max_attempts`. A race condition during concurrent
   claim() calls (FOR UPDATE SKIP LOCKED + the OR predicate not being
   serialized) is the most likely cause. The state is "impossible"
   from any single-call perspective but can land via concurrent ones.

2. `locked_until` was 1.2 min in the FUTURE — lease seemingly fresh —
   so neither the conservative nor the aggressive cutoff in
   `fn_release_stale_pipeline_locks` would release them. Some other
   touchpoint is mis-renewing the lease without resetting attempts.
   (Suspect : a downstream module patches `locked_until` indirectly
   via PATCH /pipeline_jobs without going through renew_lease().)

This script :
  * Finds all `claimed` rows where `attempts >= max_attempts`.
  * Resets them to `pending` with `attempts = max_attempts - 1` so
    the queue gives them ONE more chance instead of going straight
    to DLQ on the next failure.
  * Clears `locked_by` and `locked_until` so the next claim() sees
    the row as a fresh candidate.

Run it ad-hoc whenever the queue feels stuck despite
`fn_release_stale_pipeline_locks` returning 0. If this becomes a
recurring problem, wire it into `queue_health.py` or schedule it
via Vercel cron / pg_cron.

Usage
─────
    python worker/scripts/release_zombie_claims.py [--dry-run] [--type clip.create]

`--dry-run` reports what would be released without writing.
`--type` restricts to one job type (default : all types).
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

# Allow `from services.X` imports when run from the repo root or worker/
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx  # noqa: E402


def supabase_creds() -> tuple[str, str]:
    """Read Supabase URL + service key from worker/.env."""
    env_path = Path(__file__).resolve().parent.parent / ".env"
    text = env_path.read_text(encoding="utf-8")
    url = next(
        (line.split("=", 1)[1].strip() for line in text.splitlines()
         if line.startswith("SUPABASE_URL=")),
        os.environ.get("SUPABASE_URL", ""),
    )
    key = next(
        (line.split("=", 1)[1].strip() for line in text.splitlines()
         if line.startswith("SUPABASE_SERVICE_KEY=")),
        os.environ.get("SUPABASE_SERVICE_KEY", ""),
    )
    if not url or not key:
        raise RuntimeError("SUPABASE_URL / SUPABASE_SERVICE_KEY not set")
    return url, key


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true",
                        help="Report only — don't write")
    parser.add_argument("--type", default=None,
                        help="Restrict to one job type (e.g. clip.create)")
    args = parser.parse_args()

    url, key = supabase_creds()
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}

    # Find zombies. PostgREST uses URL filters with column=op.value.
    params: dict[str, str] = {
        "select": "id,type,attempts,max_attempts,locked_by,locked_until",
        "status": "eq.claimed",
        # PostgREST has no "column1 >= column2" filter — we filter
        # client-side after fetching all claimed rows for the type(s).
        "limit": "5000",
    }
    if args.type:
        params["type"] = f"eq.{args.type}"

    r = httpx.get(f"{url}/rest/v1/pipeline_jobs", headers=headers,
                  params=params, timeout=30)
    r.raise_for_status()
    all_claimed = r.json()
    zombies = [
        j for j in all_claimed
        if int(j.get("attempts") or 0) >= int(j.get("max_attempts") or 3)
    ]

    print(f"Total claimed (matching filter): {len(all_claimed)}")
    print(f"Zombies (attempts >= max_attempts): {len(zombies)}")
    if not zombies:
        print("Nothing to release.")
        return

    by_type: dict[str, int] = {}
    for j in zombies:
        by_type[j["type"]] = by_type.get(j["type"], 0) + 1
    print("By type:")
    for t, n in sorted(by_type.items(), key=lambda x: -x[1]):
        print(f"  {t:25s} {n}")

    if args.dry_run:
        print("\n[--dry-run] No writes performed.")
        return

    # Reset to pending. We bulk-patch by setting attempts back to
    # max_attempts - 1 so they get ONE more legitimate retry. Multi-row
    # PATCH via PostgREST with `id=in.(...)` filter.
    ids = [j["id"] for j in zombies]
    print(f"\nReleasing {len(ids)} zombie claims...")
    written = 0
    for i in range(0, len(ids), 100):
        chunk = ids[i:i + 100]
        ids_csv = ",".join(chunk)
        r = httpx.patch(
            f"{url}/rest/v1/pipeline_jobs",
            headers={**headers, "Prefer": "return=minimal"},
            params={"id": f"in.({ids_csv})"},
            json={
                "status": "pending",
                "locked_by": None,
                "locked_until": None,
                # Drop attempts back to (max - 1) so next failure goes
                # straight to DLQ (no infinite re-zombie loop).
                "attempts": 2,
                "last_error": "[released by release_zombie_claims.py]",
            },
            timeout=60,
        )
        if r.status_code in (200, 204):
            written += len(chunk)
        else:
            print(f"  batch {i} failed: {r.status_code} {r.text[:200]}")
    print(f"Released: {written}")


if __name__ == "__main__":
    main()
