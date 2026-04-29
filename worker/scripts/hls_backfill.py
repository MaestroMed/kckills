"""HLS backfill — re-encode every published clip without hls_master_url.

Parallelised version (6 workers). On a modern multi-core PC each ffmpeg
instance saturates ~1.5 cores, so 6 workers = ~9 cores busy. R2 download
+ upload is I/O-bound and parallelises trivially via asyncio.

The daemon's hls_packager module caps at MAX_PER_RUN=5 clips per 30-min
run (so it doesn't starve the other modules). For a 340-clip backlog
the daemon would take ~34h. This one-shot script bypasses the cap and
runs N workers in parallel.

Usage (from worker/ dir):
    .venv\\Scripts\\python.exe -m scripts.hls_backfill
    .venv\\Scripts\\python.exe -m scripts.hls_backfill --workers 8
    .venv\\Scripts\\python.exe -m scripts.hls_backfill --limit 50
    .venv\\Scripts\\python.exe -m scripts.hls_backfill --dry-run

Cost estimate (340 clips at --workers 6):
  R2 storage: ~340 × 6 MB ≈ 2 GB additional (free tier 10 GB OK)
  Bandwidth: ~340 × 3 MB ingress + 6 MB egress ≈ 3 GB total
  ffmpeg time: ~30s per clip × 340 / 6 = ~30min total (vs ~3h serial)
  No Gemini cost — pure local re-encoding.

Idempotent (filters on hls_master_url IS NULL). Safe to interrupt.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import httpx
import structlog

from services.supabase_client import get_db, safe_update
from modules.hls_packager import package_clip

log = structlog.get_logger()


def fetch_pending(limit: int | None, force_reencode: bool) -> list[dict]:
    """Get published kills needing HLS encoding.

    `force_reencode=True` includes ALL published clips (not just ones
    with hls_master_url IS NULL) — used when the encoding pipeline
    changed (e.g. added a 4th variant 1080p in PR2) and the existing
    HLS need a refresh.
    """
    db = get_db()
    if not db:
        raise SystemExit("ERROR: no Supabase config")

    out: list[dict] = []
    offset = 0
    page_size = 200
    while True:
        params: dict = {
            "select": "id,clip_url_vertical,killer_champion,victim_champion,highlight_score,hls_master_url",
            "status": "eq.published",
            "limit": page_size,
            "offset": offset,
            "order": "highlight_score.desc.nullslast",
        }
        if not force_reencode:
            params["hls_master_url"] = "is.null"
        r = httpx.get(f"{db.base}/kills", headers=db.headers, params=params, timeout=30.0)
        r.raise_for_status()
        page = r.json()
        rows = [k for k in page if k.get("clip_url_vertical")]
        out.extend(rows)
        if len(page) < page_size:
            break
        offset += page_size
        if limit and len(out) >= limit:
            break
    return out[: limit] if limit else out


async def process_one(
    kill: dict,
    sem: asyncio.Semaphore,
    counters: dict,
    total: int,
):
    """Process a single clip under the semaphore. Updates counters in-place.

    Side-effect: prints a one-line status per clip on completion (success
    or failure). The semaphore is released automatically when the async
    context manager exits.
    """
    async with sem:
        kid = kill["id"]
        mp4_url = kill["clip_url_vertical"]
        idx = counters["started"] + 1
        counters["started"] = idx
        prefix = f"[{idx:>3}/{total}] {kid[:8]}"
        t0 = time.monotonic()
        try:
            master_url = await package_clip(kid, mp4_url)
        except Exception as e:
            counters["fail"] += 1
            print(f"{prefix} CRASH: {str(e)[:120]}")
            return
        elapsed = time.monotonic() - t0
        if master_url:
            safe_update("kills", {"hls_master_url": master_url}, "id", kid)
            counters["ok"] += 1
            print(f"{prefix} OK  {elapsed:5.1f}s  -> {master_url[:80]}")
        else:
            counters["fail"] += 1
            print(f"{prefix} FAIL {elapsed:5.1f}s  (returned None)")


async def main_async(limit: int | None, dry_run: bool, workers: int, force_reencode: bool):
    pending = fetch_pending(limit, force_reencode)
    mode = "FORCE-REENCODE all" if force_reencode else "without HLS"
    print(f"Found {len(pending)} clips {mode} (limit={limit or 'none'}, workers={workers})")
    if pending:
        print(f"\nFirst 5 candidates:")
        for k in pending[:5]:
            score = k.get("highlight_score")
            score_str = f"{score:.1f}" if score is not None else "?"
            print(f"  {k['id'][:8]} score={score_str:>5} {k.get('killer_champion')} -> {k.get('victim_champion')}")
        if len(pending) > 5:
            print(f"  ... +{len(pending) - 5} more")

    if dry_run:
        print("\nDry-run mode — no encoding done.")
        return

    if not pending:
        print("Nothing to do.")
        return

    print(f"\nStart processing {len(pending)} clips with {workers} workers in parallel.")
    print("Press Ctrl+C to stop cleanly. Already-processed clips on re-run are skipped.\n")

    sem = asyncio.Semaphore(workers)
    counters = {"started": 0, "ok": 0, "fail": 0}
    t0 = time.monotonic()
    tasks = [
        asyncio.create_task(process_one(kill, sem, counters, len(pending)))
        for kill in pending
    ]
    # Wave 13f: NOT migrated to TaskGroup — this is a one-shot backfill
    # script (not a daemon hot path), and the explicit
    # KeyboardInterrupt → cancel-all → drain pattern is intentional for
    # interactive use. TaskGroup's BaseException handling would interact
    # awkwardly with the manual cancel/await loop here.
    try:
        await asyncio.gather(*tasks, return_exceptions=False)
    except KeyboardInterrupt:
        print("\nInterrupted — cancelling remaining tasks...")
        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    elapsed = time.monotonic() - t0
    rate = counters["ok"] / max(elapsed / 60, 0.01)
    print(f"\nDone in {elapsed/60:.1f}min. ok={counters['ok']} fail={counters['fail']} rate={rate:.1f}/min")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=None,
                    help="Cap the number of clips to process (default: all).")
    ap.add_argument("--dry-run", action="store_true",
                    help="List candidates without encoding.")
    ap.add_argument("--workers", type=int, default=6,
                    help="Number of parallel ffmpeg workers (default: 6).")
    ap.add_argument("--force-reencode", action="store_true",
                    help="Re-encode ALL published clips, not just ones "
                         "missing HLS. Use after the encoding ladder "
                         "changes (e.g. 3-variant → 4-variant 1080p). "
                         "Doubles R2 cost — old segments overwritten "
                         "by new at same path hls/<id>/.")
    args = ap.parse_args()

    asyncio.run(main_async(args.limit, args.dry_run, args.workers, args.force_reencode))


if __name__ == "__main__":
    main()
