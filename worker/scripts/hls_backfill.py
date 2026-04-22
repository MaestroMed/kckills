"""HLS backfill — re-encode every published clip without hls_master_url.

The daemon's hls_packager module caps at 5 clips per 30-min run (so it
doesn't starve other modules and doesn't spike R2 storage). For 340
backlog clips that's ~34h of waiting. This one-shot script bypasses
the cap and processes everything sequentially.

Usage (from worker/ dir):
    .venv\\Scripts\\python.exe -m scripts.hls_backfill
    .venv\\Scripts\\python.exe -m scripts.hls_backfill --limit 50
    .venv\\Scripts\\python.exe -m scripts.hls_backfill --dry-run

Cost estimate (340 clips):
  R2 storage: ~340 × 6 MB ≈ 2 GB additional (free tier 10 GB OK)
  Bandwidth: ~340 × 3 MB ingress + 6 MB egress ≈ 3 GB total
  ffmpeg time: ~30s per clip on a typical PC ≈ 3h total
  No Gemini cost — pure local re-encoding.

Each clip is processed end-to-end (download → ffmpeg → upload → DB
update) before moving to the next. Crash-safe: re-runs are idempotent
because we filter on hls_master_url IS NULL.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import httpx
import structlog

from services.supabase_client import get_db, safe_update
from modules.hls_packager import package_clip

log = structlog.get_logger()


def fetch_pending(limit: int | None) -> list[dict]:
    """Get every published kill that has an MP4 but no HLS master URL."""
    db = get_db()
    if not db:
        raise SystemExit("ERROR: no Supabase config")

    out: list[dict] = []
    offset = 0
    page_size = 200
    while True:
        params = {
            "select": "id,clip_url_vertical,killer_champion,victim_champion,highlight_score",
            "status": "eq.published",
            "hls_master_url": "is.null",
            "limit": page_size,
            "offset": offset,
            "order": "highlight_score.desc.nullslast",
        }
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


async def main_async(limit: int | None, dry_run: bool):
    pending = fetch_pending(limit)
    print(f"Found {len(pending)} clips without HLS (limit={limit or 'none'})")
    if pending:
        print(f"\nFirst 10 candidates:")
        for k in pending[:10]:
            score = k.get("highlight_score")
            score_str = f"{score:.1f}" if score is not None else "?"
            print(f"  {k['id'][:8]} score={score_str:>5} {k.get('killer_champion')} -> {k.get('victim_champion')}")
        if len(pending) > 10:
            print(f"  ... +{len(pending) - 10} more")

    if dry_run:
        print("\nDry-run mode — no encoding done.")
        return

    if not pending:
        print("Nothing to do.")
        return

    print(f"\nStart processing {len(pending)} clips. Press Ctrl+C to stop cleanly.")
    print("(Already-processed clips on re-run are skipped — safe to interrupt.)\n")

    ok = 0
    fail = 0
    skipped = 0
    for i, kill in enumerate(pending, 1):
        kid = kill["id"]
        mp4_url = kill["clip_url_vertical"]
        prefix = f"[{i}/{len(pending)}] {kid[:8]}"
        print(f"{prefix} encoding...", flush=True)
        try:
            master_url = await package_clip(kid, mp4_url)
        except Exception as e:
            print(f"{prefix} CRASH: {str(e)[:120]}")
            fail += 1
            continue
        if master_url:
            safe_update("kills", {"hls_master_url": master_url}, "id", kid)
            ok += 1
            print(f"{prefix} OK -> {master_url[:80]}")
        else:
            fail += 1
            print(f"{prefix} FAILED (returned None)")

    print(f"\nDone. ok={ok} fail={fail} skipped={skipped}")
    print("Daemon will pick up any remaining at 30-min intervals.")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=None,
                    help="Cap the number of clips to process (default: all).")
    ap.add_argument("--dry-run", action="store_true",
                    help="List candidates without encoding.")
    args = ap.parse_args()

    asyncio.run(main_async(args.limit, args.dry_run))


if __name__ == "__main__":
    main()
