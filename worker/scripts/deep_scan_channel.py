"""
deep_scan_channel.py — One-shot full-history scan of a YouTube channel
into channel_videos table.

Why this exists
═══════════════
The production poller uses YouTube RSS feeds (`/feeds/videos.xml?
channel_id=...`), capped at ~15 videos per request. Over time it
accumulates 50-70 most recent per channel — enough to track NEW
content but useless for backfilling YEARS of history.

For the 2020+ historical KC backfill we need to know about EVERY
video on each KC channel (Kameto Clips ~thousands, KarmineCorp/VOD
~829, OTPLOL_ ~thousands more). yt-dlp's `--flat-playlist` mode
enumerates the FULL channel video list for free (no YouTube Data
API quota burned) by scraping the channel page itself.

This script :
  1. Calls `yt-dlp --flat-playlist` on a channel URL.
  2. Deduplicates against existing channel_videos rows (resume-safe).
  3. Bulk-inserts the new rows with status='discovered' so the
     existing reconciler picks them up on its next pass and
     classifies them (match / vlog / drama / etc.).

Usage
═════
    # Dry-run : see how many would be inserted
    python scripts/deep_scan_channel.py @KarmineCorpVOD --dry-run

    # Live : insert into channel_videos
    python scripts/deep_scan_channel.py @KarmineCorpVOD

    # By exact UC ID
    python scripts/deep_scan_channel.py UCW5Ma_xnAweFIXCGOAZECAA

    # Cap to first N (oldest first)
    python scripts/deep_scan_channel.py @KametoCorpClips --limit 500

The channel must already exist in the `channels` table OR be passed
as a UC id directly. If the @handle resolves to a UC id that's not
in the channels table, the script aborts and instructs the operator
to add the row first (channels has a CHECK constraint on `role`
so we can't auto-create it without a value).

Multi-game channels
═══════════════════
@KarmineCorpVOD has Valorant + Rocket League + League content. The
reconciler's title parser already filters non-LoL titles (no team
match -> status=`skipped_irrelevant`). The deep scan inserts
EVERYTHING ; the reconciler does the per-video classification
afterwards. That's intended : the operator can later decide to
re-classify a "skipped_irrelevant" if the parser missed something.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

# Make the worker package importable
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

import structlog
import httpx

log = structlog.get_logger()


def _supabase() -> tuple[str, str]:
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        print("ABORT : SUPABASE_URL / SUPABASE_SERVICE_KEY missing in env")
        sys.exit(2)
    return url, key


def _resolve_channel_id(handle_or_id: str) -> tuple[str, str | None]:
    """Resolve @handle or UC<id> to (uc_id, label). Looks up the channels
    table FIRST so we don't add unknown channels accidentally.
    """
    url, key = _supabase()
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}

    # Direct UC id check
    if handle_or_id.startswith("UC") and len(handle_or_id) >= 22:
        r = httpx.get(
            f"{url}/rest/v1/channels?select=id,handle,display_name&id=eq.{handle_or_id}",
            headers=headers, timeout=15,
        )
        rows = r.json() if r.status_code == 200 else []
        if rows:
            row = rows[0]
            return row["id"], row.get("display_name") or row.get("handle")
        print(
            f"ABORT : UC {handle_or_id} not found in `channels` table.\n"
            f"        Add a row first via Supabase Studio with a `role`\n"
            f"        value (streamer_clips / lfl_highlights / lec_highlights\n"
            f"        / team_official) so the reconciler knows how to weight it."
        )
        sys.exit(3)

    # @handle resolution via channels table
    handle = handle_or_id if handle_or_id.startswith("@") else f"@{handle_or_id}"
    r = httpx.get(
        f"{url}/rest/v1/channels?select=id,handle,display_name&handle=eq.{handle}",
        headers=headers, timeout=15,
    )
    rows = r.json() if r.status_code == 200 else []
    if rows:
        row = rows[0]
        return row["id"], row.get("display_name") or row.get("handle")

    # Not in DB — try yt-dlp lookup as a hint
    print(
        f"ABORT : @{handle.lstrip('@')} not found in `channels` table.\n"
        f"        Look up the UC id manually (open the channel page in\n"
        f"        Firefox, View Source, search 'channelId') then INSERT\n"
        f"        a row into channels with a role value."
    )
    sys.exit(3)


def _fetch_channel_videos(uc_id: str, limit: int | None) -> list[dict]:
    """Run yt-dlp --flat-playlist on the channel and return
    [{id, title, published_at?}] entries.

    Uses Firefox cookies if KCKILLS_YT_COOKIES_FIREFOX_PROFILE is set
    so age-gated / region-gated videos surface in the playlist.
    """
    url = f"https://www.youtube.com/channel/{uc_id}/videos"
    cmd = [
        "python", "-m", "yt_dlp",
        "--flat-playlist",
        "--print-json",
        "--no-warnings",
    ]
    profile = os.environ.get("KCKILLS_YT_COOKIES_FIREFOX_PROFILE", "").strip()
    if profile:
        cmd.extend(["--cookies-from-browser", f"firefox:{profile}"])
    if limit:
        cmd.extend(["--playlist-items", f"1-{limit}"])
    cmd.append(url)

    print(f"  Running yt-dlp on {url} ...")
    proc = subprocess.run(
        cmd, capture_output=True, text=True, encoding="utf-8", errors="replace",
        timeout=600,
    )
    if proc.returncode != 0:
        print(f"  yt-dlp failed (exit {proc.returncode}) :")
        print(proc.stderr[:500])
        return []

    out: list[dict] = []
    for line in proc.stdout.splitlines():
        line = line.strip()
        if not line or not line.startswith("{"):
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        vid_id = entry.get("id")
        title = entry.get("title")
        if not vid_id or not title:
            continue
        # `--flat-playlist` doesn't always include duration / published_at ;
        # the reconciler will fill them in on its full-detail pass.
        out.append({
            "id": vid_id,
            "title": title,
            "duration_seconds": entry.get("duration"),
            "view_count": entry.get("view_count"),
        })
    return out


def _existing_video_ids(uc_id: str) -> set[str]:
    """Return the set of video IDs already in channel_videos for this
    channel. Used to skip already-inserted rows."""
    url, key = _supabase()
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    # paginate by 1000 (PostgREST default cap)
    seen: set[str] = set()
    offset = 0
    while True:
        r = httpx.get(
            f"{url}/rest/v1/channel_videos?select=id&channel_id=eq.{uc_id}",
            headers={**headers, "Range": f"{offset}-{offset+999}", "Range-Unit": "items"},
            timeout=20,
        )
        rows = r.json() if r.status_code in (200, 206) else []
        if not rows:
            break
        for row in rows:
            seen.add(row["id"])
        if len(rows) < 1000:
            break
        offset += 1000
    return seen


def _bulk_insert(uc_id: str, videos: list[dict], dry_run: bool) -> int:
    """Insert new channel_videos rows. Returns number actually written."""
    if not videos:
        return 0
    url, key = _supabase()
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=ignore-duplicates",
    }
    now = datetime.now(timezone.utc).isoformat()
    # Schema-correct field set (channel_videos has no discovered_at,
    # but it does have created_at + updated_at which auto-populate
    # via DEFAULT now()). Just provide the writable fields.
    def _to_int(x):
        if x is None:
            return None
        try:
            return int(round(float(x)))
        except (ValueError, TypeError):
            return None

    rows = [
        {
            "id": v["id"],
            "channel_id": uc_id,
            "title": v["title"],
            # yt-dlp returns duration as a float seconds value ; the column
            # is INTEGER so we round before insert.
            "duration_seconds": _to_int(v.get("duration_seconds")),
            "status": "discovered",
        }
        for v in videos
    ]
    _ = now  # keep for forward-compat if the schema gains a discovered_at later
    if dry_run:
        return len(rows)
    # batch in 500s to stay under PostgREST limits
    written = 0
    for i in range(0, len(rows), 500):
        batch = rows[i:i+500]
        try:
            r = httpx.post(
                f"{url}/rest/v1/channel_videos",
                headers=headers, json=batch, timeout=60,
            )
            if r.status_code in (200, 201):
                written += len(batch)
            else:
                print(f"  insert failed batch {i}-{i+len(batch)} : {r.status_code} {r.text[:200]}")
        except Exception as e:
            print(f"  insert exception batch {i}-{i+len(batch)} : {e}")
    return written


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("channel", help="@handle or UC id of the channel to deep-scan")
    p.add_argument("--limit", type=int, default=None,
                   help="Cap to first N videos (oldest-first when None)")
    p.add_argument("--dry-run", action="store_true",
                   help="Resolve + count without writing")
    args = p.parse_args()

    uc_id, label = _resolve_channel_id(args.channel)
    print(f"Channel  : {args.channel} -> UC = {uc_id}  ({label or 'unnamed'})")
    print(f"Mode     : {'DRY-RUN' if args.dry_run else 'LIVE'}")
    print(f"Limit    : {args.limit or 'no cap (full history)'}")
    print()

    # 1. Enumerate via yt-dlp
    videos = _fetch_channel_videos(uc_id, args.limit)
    print(f"  yt-dlp returned : {len(videos)} videos")

    # 2. Skip already-inserted
    existing = _existing_video_ids(uc_id)
    print(f"  already in DB   : {len(existing)} (will skip)")
    new_videos = [v for v in videos if v["id"] not in existing]
    print(f"  new to insert   : {len(new_videos)}")
    print()

    # 3. Insert
    if not new_videos:
        print("Nothing to insert.")
        return 0
    if args.dry_run:
        print("(dry-run — no writes)")
        return 0
    written = _bulk_insert(uc_id, new_videos, dry_run=False)
    print(f"  inserted        : {written} / {len(new_videos)}")
    print()
    print("Next : the channel_reconciler will pick these up on its next")
    print("       cycle (~1 h). Or run it manually :")
    print(f"       python -c 'import asyncio, sys; sys.path.insert(0, \".\"); ")
    print(f"                 from modules.channel_reconciler import run; ")
    print(f"                 print(asyncio.run(run()))'")
    return 0


if __name__ == "__main__":
    sys.exit(main())
