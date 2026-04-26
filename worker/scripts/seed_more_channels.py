"""
seed_more_channels.py — Add Kameto's main stream-archive channel and
the two Riot esports archive channels (@LCSEsports + @lolesports) to
the `channels` table.

@kameto      — UC ID looked up at runtime via yt-dlp. Stream archives
               (long format VODs of ranked / fun games / KC watch
               parties). role = 'streamer_vod' so the reconciler treats
               them as fallback VOD source for KC matches.

@LCSEsports  — official LCS channel (when LEC content is sparse, LCS
               game VODs are still useful sync references for LEC
               casters' international streams).

@lolesports  — Riot's flagship channel (mirror of @LEC + worlds + msi
               compilation reels).

After insert, immediately calls channel_discoverer.run() to fetch the
latest videos from these channels.

Usage :
    python scripts/seed_more_channels.py
"""

from __future__ import annotations

import asyncio
import json
import subprocess
import sys
from pathlib import Path

from dotenv import load_dotenv

_WORKER_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_WORKER_ROOT))
load_dotenv(_WORKER_ROOT / ".env")


# Static UC IDs are intentionally NOT hardcoded — yt-dlp resolves them
# at runtime so the script doesn't get stale if Riot ever migrates a
# channel. The (handle, display_name, role, notes) triple is what we
# control here.
SEEDS: list[dict] = [
    {
        "handle": "@kameto",
        "display_name": "Kameto",
        "role": "streamer_vod",
        "notes": (
            "Main Twitch / YouTube stream of Kameto (KC co-founder). "
            "Long-format VODs — ranked sessions, KC watch parties, "
            "occasional showmatches. Fallback VOD source for KC matches."
        ),
    },
    {
        "handle": "@LCSEsports",
        "display_name": "LCS Esports",
        "role": "lec_highlights",
        "notes": (
            "Official LCS channel (Riot Americas). Game-by-game "
            "highlights mirror @LEC's title format — useful for KC "
            "international cross-matches (MSI / Worlds bracket)."
        ),
    },
    {
        "handle": "@lolesports",
        "display_name": "lolesports",
        "role": "lec_highlights",
        "notes": (
            "Riot's flagship esports channel. MSI / Worlds / LEC "
            "compilation reels. Same '| HIGHLIGHTS' title format as "
            "@LEC for the LEC mirror uploads."
        ),
    },
]


def _resolve_channel_id(handle: str) -> str | None:
    """Use yt-dlp to look up the underlying UC id for a @handle.

    Returns the 24-char UC id, or None on lookup failure.
    """
    url = f"https://www.youtube.com/{handle}"
    cmd = [
        "yt-dlp",
        "--dump-json",
        "--skip-download",
        "--playlist-items", "0",  # only fetch channel metadata, no videos
        "--no-warnings",
        url,
    ]
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=60,
            check=False,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        print(f"[warn] yt-dlp failed for {handle}: {e}")
        return None
    if proc.returncode != 0:
        # Fall back to the older "list 1 video" style if --playlist-items 0
        # rejects the channel URL on this yt-dlp version.
        cmd_alt = [
            "yt-dlp",
            "--dump-json",
            "--skip-download",
            "--flat-playlist",
            "--playlist-end", "1",
            "--no-warnings",
            url,
        ]
        try:
            proc = subprocess.run(
                cmd_alt,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=60,
                check=False,
            )
        except (subprocess.TimeoutExpired, FileNotFoundError) as e:
            print(f"[warn] yt-dlp fallback failed for {handle}: {e}")
            return None
        if proc.returncode != 0:
            print(f"[warn] yt-dlp returned {proc.returncode} for {handle}: "
                  f"{proc.stderr[:200]}")
            return None

    # yt-dlp emits one JSON blob per line. The first parseable one
    # carries channel metadata.
    for raw_line in proc.stdout.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        try:
            data = json.loads(line)
        except json.JSONDecodeError:
            continue
        # When called on a channel URL, the JSON blob has channel_id (UC...)
        # at top level (or inside the first entry).
        cid = data.get("channel_id") or data.get("uploader_id")
        if cid and cid.startswith("UC"):
            return cid
        # If yt-dlp returned a video, dig inside it.
        if "channel_id" in data and isinstance(data["channel_id"], str):
            if data["channel_id"].startswith("UC"):
                return data["channel_id"]
        # Sometimes yt-dlp wraps the channel as the FIRST entries[0].
        entries = data.get("entries")
        if entries and isinstance(entries, list):
            for entry in entries:
                cid = (entry or {}).get("channel_id") or (entry or {}).get("uploader_id")
                if cid and cid.startswith("UC"):
                    return cid
    return None


def _seed_channels() -> list[str]:
    """Resolve UC ids and upsert each row into channels. Returns the
    list of UC ids that were successfully resolved + persisted."""
    from services.supabase_client import safe_upsert

    persisted: list[str] = []
    for seed in SEEDS:
        handle = seed["handle"]
        print(f"[lookup] {handle} ...", end=" ", flush=True)
        uc_id = _resolve_channel_id(handle)
        if not uc_id:
            print("SKIP (no UC id)")
            continue
        print(f"-> {uc_id}")
        row = {
            "id": uc_id,
            "handle": handle,
            "display_name": seed["display_name"],
            "role": seed["role"],
            "is_active": True,
            "notes": seed["notes"],
        }
        try:
            safe_upsert("channels", row, on_conflict="id")
            persisted.append(uc_id)
            print(f"           upsert OK ({seed['role']})")
        except Exception as e:
            print(f"           upsert FAILED: {e}")
    return persisted


async def _discover_now(uc_ids: list[str]) -> int:
    """Run channel_discoverer once on the freshly-seeded channels."""
    if not uc_ids:
        return 0
    from modules import channel_discoverer

    # We don't filter by uc_id here — the discoverer's run() polls every
    # active channel. That's fine because the seeded channels were just
    # set is_active=true; their last_video_id is null so the FULL recent
    # window (50 videos) gets pulled.
    return await channel_discoverer.run()


def main() -> None:
    print("=" * 60)
    print("  seed_more_channels — adding Kameto + Riot archives")
    print("=" * 60)

    persisted = _seed_channels()
    print()
    print(f"[seed] {len(persisted)} / {len(SEEDS)} channels persisted.")

    if not persisted:
        print("[seed] nothing to discover, exiting.")
        sys.exit(1)

    print("[discover] kicking channel_discoverer.run() ...")
    new_videos = asyncio.run(_discover_now(persisted))
    print(f"[discover] inserted {new_videos} new channel_videos rows.")

    sys.exit(0)


if __name__ == "__main__":
    main()
