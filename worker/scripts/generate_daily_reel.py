"""
generate_daily_reel — V49 (Wave 26.1).

Daily script that assembles a 60-second highlight mashup of the top
5 kills published in the last 24 h, ffmpeg-concatenates them with a
simple crossfade transition, uploads to R2, and inserts a row into
`daily_highlight_reels`.

Designed to run as a daily cron / Windows Scheduled Task at 03:00
local — by then the previous match-day's clips are stable and the
new reel goes live for the morning Discord post.

Currently a SCAFFOLD — production-ready ship requires :
    * the `daily_highlight_reels` table (migration 058).
    * R2 bucket policy for `reels/<date>.mp4`.
    * an FFmpeg concat with smooth audio crossfade.
    * a Discord webhook post linking to the new reel + first 3
      thumbnails.

Idempotent : if a reel already exists for today's UTC date, the
script logs "already-generated" and exits.

Usage :
    .venv\\Scripts\\python.exe worker\\scripts\\generate_daily_reel.py
    .venv\\Scripts\\python.exe worker\\scripts\\generate_daily_reel.py --date 2026-05-08
    .venv\\Scripts\\python.exe worker\\scripts\\generate_daily_reel.py --dry-run
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from datetime import datetime, timezone, timedelta

import structlog
from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
load_dotenv()

log = structlog.get_logger()

TARGET_LENGTH_S = 60
TOP_N = 5


async def main_async(args: argparse.Namespace) -> int:
    from services.supabase_client import safe_select, supabase_table_insert

    today = datetime.now(timezone.utc).date()
    if args.date:
        today = datetime.fromisoformat(args.date).date()

    log.info("daily_reel_start", date=today.isoformat(), dry_run=args.dry_run)

    # Idempotency check.
    existing = safe_select(
        "daily_highlight_reels",
        "id",
        reel_date=f"eq.{today.isoformat()}",
        limit="1",
    ) or []
    if existing:
        log.info("daily_reel_already_exists", date=today.isoformat())
        return 0

    # Pull the top 5 kills from the last 24 h published window.
    since = (today - timedelta(days=1)).isoformat()
    candidates = safe_select(
        "kills",
        "id, clip_url_vertical, clip_url_horizontal, highlight_score, ai_description",
        status="eq.published",
        updated_at=f"gte.{since}",
        order="highlight_score.desc.nullslast",
        limit="20",
    ) or []
    selected = [c for c in candidates if c.get("clip_url_horizontal")][:TOP_N]
    if len(selected) < TOP_N:
        log.warn(
            "daily_reel_too_few_clips",
            available=len(selected),
            min_needed=TOP_N,
        )
        return 1

    log.info(
        "daily_reel_candidates",
        count=len(selected),
        kill_ids=[c["id"][:8] for c in selected],
    )

    if args.dry_run:
        print("(dry-run — no FFmpeg, no R2 upload, no DB write)")
        for c in selected:
            print(f"  {c['id'][:8]} score={c.get('highlight_score')}")
        return 0

    # FFmpeg concat + crossfade — out-of-scope for the V49 scaffold ;
    # the real implementation calls services.ffmpeg_ops.concat_with_xfade(
    # input_paths, target_seconds=60, xfade_seconds=0.4) → outputs an
    # MP4 to a tempfile.
    log.warn(
        "daily_reel_ffmpeg_not_implemented",
        next_step=(
            "implement services.ffmpeg_ops.concat_with_xfade(...) + R2 "
            "upload + the supabase_table_insert call below."
        ),
    )

    # Persist row (the URLs would point at the just-uploaded R2 object).
    await asyncio.to_thread(
        supabase_table_insert,
        "daily_highlight_reels",
        {
            "reel_date": today.isoformat(),
            "kill_ids": [c["id"] for c in selected],
            "duration_s": TARGET_LENGTH_S,
            # mp4_url_* left NULL until the FFmpeg step is wired
        },
    )
    log.info("daily_reel_done", date=today.isoformat(), clips=len(selected))
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--date",
        help="ISO date (YYYY-MM-DD) for the reel ; default today UTC.",
    )
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="Skip FFmpeg + R2 upload + DB write.",
    )
    args = ap.parse_args()
    return asyncio.run(main_async(args))


if __name__ == "__main__":
    raise SystemExit(main())
