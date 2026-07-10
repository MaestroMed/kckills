"""enqueue_golgg_clips.py — push gol.gg raw kills into the clip pipeline.

Runs AFTER backfill_vods_leaguepedia.py has filled games.vod_youtube_id.
The transitioner would eventually enqueue these on its own, but gol_gg kills
carry event_epoch=0 (they sort last in the transitioner's event_epoch.desc
scan) and the live clip.create backlog keeps it throttled — so they'd be
starved. This script enqueues them explicitly, in factual-priority order.

highlight_score is NULL for 100% of gol_gg kills (no Gemini yet), so priority
is derived from the pre-clip factual signals gol.gg gives us: multi-kill tier,
first blood, Vi (the Yike showcase champion), and KC-as-killer. Best moments
clip first.

Only kills whose GAME already has a vod_youtube_id are eligible (the clipper
needs it; the rest would fail no_vod). Enqueue is idempotent via the
pipeline_jobs unique partial index, so re-runs are safe. After a successful
enqueue the kill is moved raw -> enriched (invisible to the transitioner's raw
scan, mirrors backfill_clip_errors.py).

Usage:
  python scripts/enqueue_golgg_clips.py --dry-run
  python scripts/enqueue_golgg_clips.py --limit 50        # warm-up
  python scripts/enqueue_golgg_clips.py                   # full run
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

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from services import job_queue  # noqa: E402
from services.observability import run_logged  # noqa: E402
from services.supabase_client import get_db  # noqa: E402

PAGE_SIZE = 500
MAX_RETRIES = 3
_MULTI = {"penta": 70, "quadra": 50, "triple": 30, "double": 14}


def _priority(kill: dict) -> int:
    """Factual priority (highlight_score is NULL for all gol_gg). Higher = sooner.
    Range ~30 (routine victim) .. ~131 (penta + first blood + Vi + KC killer)."""
    p = 30
    p += _MULTI.get((kill.get("multi_kill") or "").lower(), 0)
    if kill.get("is_first_blood"):
        p += 15
    if (kill.get("killer_champion") or "") == "Vi":
        p += 18
    if kill.get("tracked_team_involvement") == "team_killer":
        p += 8
    return min(p, 131)


def _vod_ready_game_ids(db) -> list[str]:
    ids: list[str] = []
    offset = 0
    while True:
        r = httpx.get(
            f"{db.base}/games", headers=db.headers,
            params={"select": "id", "data_source": "eq.gol_gg",
                    "vod_youtube_id": "not.is.null",
                    # vod-only games carry offset NULL until the daemon's
                    # vod_offset_finder calibrates them — clipping before
                    # that would cut at the wrong spot. Only enqueue when
                    # the offset is known.
                    "vod_offset_seconds": "not.is.null",
                    "limit": str(PAGE_SIZE), "offset": str(offset)},
            timeout=30.0,
        )
        r.raise_for_status()
        page = r.json() or []
        ids += [g["id"] for g in page]
        if len(page) < PAGE_SIZE:
            break
        offset += len(page)
    return ids


def _fetch_raw_kills(db, game_ids: list[str], highlights_only: bool) -> list[dict]:
    """Always fetch from offset 0: processed kills leave status='raw', so the
    filtered window shrinks as we go — advancing an offset over a shrinking
    set skips every other page (that's how a first run stopped at 1000/2000)."""
    params = {
        "select": ("id,game_id,killer_champion,multi_kill,"
                   "is_first_blood,tracked_team_involvement"),
        "data_source": "eq.gol_gg",
        "status": "eq.raw",
        "game_id": f"in.({','.join(game_ids)})",
        "order": "id.asc",
        "limit": str(PAGE_SIZE),
    }
    if highlights_only:
        # curated scope: multi-kills, first bloods, Vi (Yike showcase)
        params["or"] = "(multi_kill.not.is.null,is_first_blood.eq.true,killer_champion.eq.Vi)"
    r = httpx.get(f"{db.base}/kills", headers=db.headers, params=params,
                  timeout=40.0)
    r.raise_for_status()
    return r.json() or []


def _set_enriched(db, kill_id: str) -> bool:
    try:
        r = httpx.patch(
            f"{db.base}/kills",
            headers={**db.headers, "Prefer": "return=minimal"},
            params={"id": f"eq.{kill_id}"},
            json={"status": "enriched", "retry_count": 0}, timeout=15.0,
        )
        return r.status_code in (200, 204)
    except Exception:
        return False


@run_logged(module_name="enqueue_golgg_clips")
async def _amain(*, dry_run: bool, limit: int | None, highlights_only: bool = False) -> dict:
    db = get_db()
    if db is None:
        print("FATAL: Supabase env vars missing.")
        return {"items_scanned": 0, "items_processed": 0, "items_failed": 1}

    print("=" * 60)
    print("  enqueue_golgg_clips — push gol.gg raw kills into clip.create")
    print(f"  dry_run={dry_run}  limit={limit if limit is not None else 'all'}")
    print("=" * 60)

    game_ids = await asyncio.to_thread(_vod_ready_game_ids, db)
    print(f"  VOD-ready gol_gg games: {len(game_ids)}")
    if not game_ids:
        print("  aucun game gol_gg avec VOD -> lance d'abord backfill_vods_leaguepedia.py")
        return {"items_scanned": 0, "items_processed": 0, "items_failed": 0}

    scanned = enqueued = skipped = errors = 0
    by_tier: dict[str, int] = {}
    seen: set[str] = set()
    while True:
        if limit is not None and scanned >= limit:
            break
        try:
            page = await asyncio.to_thread(_fetch_raw_kills, db, game_ids, highlights_only)
        except Exception as e:
            print(f"  [error] fetch: {e}")
            errors += 1
            break
        # anti-infinite-loop guard: a page of only already-seen ids means
        # those kills failed their status reset — stop instead of spinning
        page = [k for k in page if k.get("id") not in seen]
        if not page:
            break
        seen.update(k["id"] for k in page)

        # priority order within the page (best first)
        page.sort(key=_priority, reverse=True)
        for k in page:
            if limit is not None and scanned >= limit:
                break
            scanned += 1
            kid, gid = k.get("id"), k.get("game_id")
            if not kid or not gid:
                skipped += 1
                continue
            pr = _priority(k)
            tier = (k.get("multi_kill") or ("vi" if k.get("killer_champion") == "Vi"
                    else ("fb" if k.get("is_first_blood") else "std")))
            by_tier[tier] = by_tier.get(tier, 0) + 1
            if dry_run:
                enqueued += 1
                continue
            jid = await asyncio.to_thread(
                job_queue.enqueue, "clip.create", "kill", kid,
                {"kill_id": kid, "game_id": gid}, pr, None, MAX_RETRIES)
            if jid is None:
                # already queued (idempotent) — still advance state
                if await asyncio.to_thread(_set_enriched, db, kid):
                    skipped += 1
                else:
                    errors += 1
                continue
            if await asyncio.to_thread(_set_enriched, db, kid):
                enqueued += 1
            else:
                print(f"  [warn] enqueued but state reset failed {kid[:8]}")
                errors += 1

        print(f"  [progress] scanned={scanned} enqueued={enqueued} "
              f"skipped={skipped} errors={errors}")

    print("-" * 60)
    print(f"  scanned  : {scanned}")
    print(f"  enqueued : {enqueued}")
    print(f"  skipped  : {skipped}  (déjà en file)")
    print(f"  errors   : {errors}")
    print(f"  par tier : {dict(sorted(by_tier.items(), key=lambda x: -x[1]))}")
    if dry_run:
        print("  (dry-run — aucun write)")
    return {"items_scanned": scanned, "items_processed": enqueued,
            "items_skipped": skipped, "items_failed": errors, "dry_run": dry_run}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--highlights-only", action="store_true",
                    help="multi-kills + first bloods + Vi uniquement")
    args = ap.parse_args()
    asyncio.run(_amain(dry_run=args.dry_run, limit=args.limit,
                       highlights_only=args.highlights_only))
    return 0


if __name__ == "__main__":
    sys.exit(main())
