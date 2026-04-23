"""
CHANNEL_DISCOVERER — poll YouTube channels for new videos.

Reads the `channels` table (migration 011), iterates each active row,
uses yt-dlp to list recent uploads, inserts new videos into
`channel_videos`. Cheap and idempotent: filters by `last_video_id` so
we only insert deltas.

Initial classification (basic regex) is done here so downstream
RECONCILER doesn't have to re-fetch metadata. Refined classification
(matched_match_external_id, matched_game_number) lands in a separate
RECONCILER module.

Daemon interval: 6h. yt-dlp respect rate limits via the global
scheduler. PLAYLIST_END caps the lookback per poll so we don't replay
the entire channel history every cycle.
"""

from __future__ import annotations

import asyncio
import re
from datetime import datetime, timezone

import httpx
import structlog

from config import config
from scheduler import scheduler
from services.supabase_client import get_db, safe_insert, safe_update

log = structlog.get_logger()


# How many recent uploads to scan per channel per poll. We inject only
# new videos (id not already in channel_videos). 50 is plenty given a
# 6h cadence — even a high-volume channel like @LEC posts ~5 videos/day.
PLAYLIST_END = 50


def _uploads_playlist_id(channel_uc_id: str) -> str:
    """Convert a channel UC ID to its uploads playlist ID (UU prefix)."""
    if not channel_uc_id.startswith("UC"):
        raise ValueError(f"Expected channel id starting with UC, got {channel_uc_id!r}")
    return "UU" + channel_uc_id[2:]


# ─── KC relevance heuristics ──────────────────────────────────────────
# Two patterns matter most:
#   - "KC" with word boundary: catches "KC vs G2", "G2 vs KC", "KCB"
#   - "Karmine" / "Kameto" full word: catches "REKKLES KC PENTAKILL",
#     "Kameto regarde", "Karmine Corp ..."
# We score 0..1 based on which patterns hit. <0.3 = not_kc, >=0.7 =
# matched, between = manual_review.

KC_PATTERNS = [
    (re.compile(r"\bKC\b", re.IGNORECASE),       0.5),
    (re.compile(r"\bKCB\b", re.IGNORECASE),      0.5),  # academy
    (re.compile(r"karmine\s*corp", re.IGNORECASE), 0.6),
    (re.compile(r"\bkameto\b", re.IGNORECASE),   0.4),  # Kameto streamer ≠ KC strictly
    (re.compile(r"\bcanna\b", re.IGNORECASE),    0.4),
    (re.compile(r"\byike\b", re.IGNORECASE),     0.4),
    (re.compile(r"\bkyeahoo\b", re.IGNORECASE),  0.4),
    (re.compile(r"\bcaliste\b", re.IGNORECASE),  0.4),
    (re.compile(r"\bbusio\b", re.IGNORECASE),    0.4),
    (re.compile(r"\brekkles\b", re.IGNORECASE),  0.3),  # ex-KC alumnus
    (re.compile(r"\btargamas\b", re.IGNORECASE), 0.3),
    (re.compile(r"\bcabochard\b", re.IGNORECASE), 0.3),
]


def kc_relevance(title: str, description: str | None = None) -> float:
    """Score 0..1 based on how confident we are the video concerns KC."""
    text = title + " " + (description or "")
    score = 0.0
    matched_patterns = 0
    for pat, weight in KC_PATTERNS:
        if pat.search(text):
            score += weight
            matched_patterns += 1
            if matched_patterns >= 3:
                break  # cap diminishing-returns at 3 matches
    return min(1.0, score)


# ─── Title classification (cheap, regex-based) ────────────────────────
# Pattern 1 — @LEC standardised:
#   "TEAMA vs TEAMB | HIGHLIGHTS | YYYY #LEC Split - Week N Day N"
#   "TEAMA vs TEAMB Game N | LEAGUE 2026 Week N Day N"
# Pattern 2 — Kameto Clips: short reaction-style titles, no match info
# Pattern 3 — KC official: "VOICECOMMS - <descriptive>" / vlog / etc.

LEC_HIGHLIGHTS_RE = re.compile(
    # Tolerates "TH vs. KC", "TH vs KC", "TH  vs  KC" — @LEC mixes the
    # two formats unpredictably ("TH vs. KC | HIGHLIGHTS" was the case
    # we missed in the first iteration).
    r"^([A-Z]{2,4})\s*vs\.?\s*([A-Z]{2,4})\s*\|\s*HIGHLIGHTS",
    re.IGNORECASE,
)
LOLEVENTVODS_GAME_RE = re.compile(
    r"^([A-Z]{2,4})\s*vs\.?\s*([A-Z]{2,4})\s*Game\s*(\d)",
    re.IGNORECASE,
)
WEEK_DAY_RE = re.compile(r"Week\s*(\d+)\s*Day\s*(\d+)", re.IGNORECASE)


def classify_title(title: str, role: str) -> dict:
    """Return a dict {video_type, week, day, team_a, team_b, game_n} when
    parseable. Empty dict if title doesn't match any known pattern.

    `role` is the channels.role of the source — drives which pattern to
    try first. Cheap heuristic, refined by RECONCILER if needed.
    """
    out: dict = {}
    if role in ("lec_highlights", "lfl_highlights"):
        m = LEC_HIGHLIGHTS_RE.search(title)
        if m:
            out["video_type"] = "game_highlights"
            out["team_a"] = m.group(1).upper()
            out["team_b"] = m.group(2).upper()
        m2 = LOLEVENTVODS_GAME_RE.search(title)
        if m2:
            out["video_type"] = "single_game"
            out["team_a"] = m2.group(1).upper()
            out["team_b"] = m2.group(2).upper()
            out["game_n"] = int(m2.group(3))
        m3 = WEEK_DAY_RE.search(title)
        if m3:
            out["week"] = int(m3.group(1))
            out["day"] = int(m3.group(2))
    elif role == "team_official":
        # KC official channel — anything is possible. Just flag genre.
        low = title.lower()
        if "voicecomm" in low or "voice comms" in low:
            out["video_type"] = "voicecomms"
        elif "debrief" in low or "post-match" in low:
            out["video_type"] = "debrief"
        elif "draft" in low or "showmatch" in low:
            out["video_type"] = "showmatch"
        else:
            out["video_type"] = "other"
    elif role == "streamer_clips":
        out["video_type"] = "clip"
    return out


# ─── yt-dlp wrapper ───────────────────────────────────────────────────

async def _fetch_recent_uploads(channel_uc_id: str, limit: int = PLAYLIST_END) -> list[dict]:
    """List recent uploads for a channel via yt-dlp.

    Runs in a thread pool because yt-dlp is sync. Returns minimal
    metadata: id, title, duration, upload_date.
    """
    try:
        import yt_dlp  # type: ignore
    except ImportError:
        log.warn("yt_dlp_not_installed")
        return []

    pl_id = _uploads_playlist_id(channel_uc_id)
    url = f"https://youtube.com/playlist?list={pl_id}"
    opts = {
        "quiet": True,
        "skip_download": True,
        "extract_flat": True,
        "playlistend": limit,
        "no_warnings": True,
    }

    def _sync_fetch():
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
            entries = info.get("entries") if info else []
            return entries or []

    try:
        await scheduler.wait_for("youtube_search")  # rate limit
        entries = await asyncio.to_thread(_sync_fetch)
        return [e for e in entries if e and e.get("id")]
    except Exception as e:
        log.error("channel_fetch_failed", channel=channel_uc_id, error=str(e)[:200])
        return []


# ─── Discoverer pass ──────────────────────────────────────────────────

async def discover_channel(channel: dict) -> int:
    """Fetch recent uploads for one channel, insert deltas into channel_videos.

    Returns the number of NEW videos inserted (0 if nothing new).
    """
    cid = channel["id"]
    role = channel["role"]
    last_video_id = channel.get("last_video_id")

    log.info("channel_poll_start", channel=channel.get("display_name"))
    entries = await _fetch_recent_uploads(cid)
    if not entries:
        log.info("channel_poll_empty", channel=channel.get("display_name"))
        # Still bump last_polled_at so we don't retry instantly
        safe_update("channels", {"last_polled_at": _now_iso()}, "id", cid)
        return 0

    # Stop at the previously-seen most-recent video (incremental)
    new_entries: list[dict] = []
    for e in entries:
        if last_video_id and e["id"] == last_video_id:
            break
        new_entries.append(e)

    if not new_entries:
        log.info("channel_poll_no_new", channel=channel.get("display_name"))
        safe_update("channels", {"last_polled_at": _now_iso()}, "id", cid)
        return 0

    inserted = 0
    for entry in new_entries:
        title = entry.get("title") or ""
        rel = kc_relevance(title)
        classification = classify_title(title, role)

        # Decide initial status
        status = "discovered"
        if rel < 0.3:
            status = "not_kc"
        elif rel >= 0.7 and classification.get("video_type"):
            status = "classified"
        elif rel >= 0.3:
            status = "manual_review"

        row = {
            "id": entry["id"],
            "channel_id": cid,
            "title": title[:500],
            "duration_seconds": entry.get("duration"),
            "status": status,
            "video_type": classification.get("video_type"),
            "kc_relevance_score": rel,
        }
        # Idempotent insert: rely on PRIMARY KEY (id) unique constraint —
        # if the row already exists, the INSERT silently no-ops at the
        # safe_insert layer (which translates 409 → log + skip).
        result = safe_insert("channel_videos", row)
        if result:
            inserted += 1

    # Update channel's high-water mark + last_polled_at
    safe_update(
        "channels",
        {
            "last_polled_at": _now_iso(),
            "last_video_id": entries[0]["id"],  # most recent = first in list
        },
        "id",
        cid,
    )
    log.info(
        "channel_poll_done",
        channel=channel.get("display_name"),
        new_videos=inserted,
        scanned=len(entries),
    )
    return inserted


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ─── Daemon loop ──────────────────────────────────────────────────────

async def run() -> int:
    """Poll every active channel, return total new videos inserted."""
    log.info("channel_discoverer_scan_start")

    db = get_db()
    if not db:
        return 0

    r = httpx.get(
        f"{db.base}/channels",
        headers=db.headers,
        params={"select": "id,handle,display_name,role,last_video_id", "is_active": "eq.true"},
        timeout=15.0,
    )
    if r.status_code != 200:
        log.warn("channels_fetch_failed", status=r.status_code)
        return 0
    channels = r.json()
    if not channels:
        log.info("channel_discoverer_no_active_channels")
        return 0

    total_new = 0
    # Sequential — yt-dlp shares cookies / rate limit, parallelism here
    # would just churn 429s. The scheduler.wait_for already throttles.
    for ch in channels:
        try:
            n = await discover_channel(ch)
            total_new += n
        except Exception as e:
            log.error("channel_discover_error", channel=ch.get("display_name"), error=str(e)[:200])

    log.info("channel_discoverer_done", total_new=total_new, channels_polled=len(channels))
    return total_new
