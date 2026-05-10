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
from services.observability import run_logged
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


# ─── Wave 27.22 — Karmine Corp Replay multi-roster / multi-game classifier
#
# The @KarmineCorpReplay channel is the unique source per operator
# directive 2026-05-10. It hosts replays for ALL of KC's tournaments
# across ALL games, so we MUST filter aggressively :
#
#   * LoL only (skip VCT / Valorant / GC / Rocket League / R6).
#   * KC main roster first (LEC 2024+, LFL pre-2024).
#   * KCB / KCBS / GC academy rosters parked in priority 3 — keep the
#     channel_videos row but mark as "skipped_secondary_roster" so a
#     future flag flip can promote them without re-polling.

# Non-LoL tier markers — if any of these appear we skip outright.
NON_LOL_TIER_PATTERNS = re.compile(
    r"\b(VCT\s*GC|VCT\s*EMEA|VCT\s*\d{4}|VALORANT|RLCS|ROCKET\s*LEAGUE|"
    r"RAINBOW\s*SIX|R6\s*PRO|FORTNITE|TFT)\b",
    re.IGNORECASE,
)

# Non-LoL roster markers (KC GC = Game Changers Valorant, etc.)
NON_LOL_ROSTER_PATTERNS = re.compile(
    r"\bKarmine\s*Corp\s*GC\b|\bKC\s*GC\b",
    re.IGNORECASE,
)

# KC main roster matchers — order matters : check secondaries FIRST so
# "Karmine Corp Blue" doesn't get mistaken for "Karmine Corp" main.
KC_BLUE_RE = re.compile(
    r"\bKarmine\s*Corp\s*Blue\b|\bKCB(?!S)\b",
    re.IGNORECASE,
)
KCBS_RE = re.compile(
    r"\bKarmine\s*Corp\s*Blue\s*Stars\b|\bKCBS\b",
    re.IGNORECASE,
)
KC_MAIN_RE = re.compile(
    r"\bKarmine\s*Corp\b(?!\s*(Blue|GC))|\bKC(?:orp)?\b",
    re.IGNORECASE,
)

# LoL tier patterns — used to surface league context for the reconciler.
LOL_TIER_PATTERNS = [
    (re.compile(r"\bLEC\s*Versus\b", re.IGNORECASE), "lec_versus"),
    (re.compile(r"\bLEC\s*(Winter|Spring|Summer|Season)\b", re.IGNORECASE), "lec"),
    (re.compile(r"\bLEC\s*Playoffs?\b", re.IGNORECASE), "lec_playoffs"),
    (re.compile(r"\bEsports?\s*World\s*Cup\b|\bEWC\b", re.IGNORECASE), "ewc"),
    # Worlds AFTER Esports World Cup so 'Esports World Cup' doesn't
    # accidentally match as 'Worlds'.
    (re.compile(r"\b(Worlds|World\s*Championship)\b", re.IGNORECASE), "worlds"),
    (re.compile(r"\bMSI\b", re.IGNORECASE), "msi"),
    (re.compile(r"\bFirst\s*Stand\b", re.IGNORECASE), "first_stand"),
    (re.compile(r"\bLFL\b", re.IGNORECASE), "lfl"),
    (re.compile(r"\bNexus\s*League\b", re.IGNORECASE), "nexus_league"),
    (re.compile(r"\bOpen\s*Tour\b", re.IGNORECASE), "open_tour"),
    (re.compile(r"\bEU\s*Masters?\b", re.IGNORECASE), "eu_masters"),
]


def classify_kc_replay_title(title: str) -> dict:
    """Karmine Corp Replay channel-specific classifier.

    Returns a dict with keys :
      * game        — 'lol' | 'other'
      * roster      — 'kc_main' | 'kcb' | 'kcbs' | 'kc_gc' | 'unknown'
      * tier        — 'lec' | 'lec_versus' | 'lec_playoffs' | 'lfl' |
                      'nexus_league' | 'open_tour' | 'worlds' | 'msi' |
                      'first_stand' | 'eu_masters' | 'unknown'
      * priority    — 1 (LEC 2024+ KC main), 2 (LFL pre-2024 KC main),
                      3 (KCB/KCBS/GC), 0 (skip — non-LoL or non-KC)
      * skip_reason — when priority=0, why
    """
    out: dict = {
        "video_type": "match_replay",
        "game": "lol",
        "roster": "unknown",
        "tier": "unknown",
        "priority": 0,
        "skip_reason": None,
    }

    # ─── 1. Game gate — non-LoL is an instant skip
    if NON_LOL_TIER_PATTERNS.search(title) or NON_LOL_ROSTER_PATTERNS.search(title):
        out["game"] = "other"
        out["skip_reason"] = "non_lol"
        return out

    # ─── 2. Roster detection — order matters (specific before generic)
    if KCBS_RE.search(title):
        out["roster"] = "kcbs"
    elif KC_BLUE_RE.search(title):
        out["roster"] = "kcb"
    elif KC_MAIN_RE.search(title):
        out["roster"] = "kc_main"

    # ─── 3. Tier detection
    for pat, tier in LOL_TIER_PATTERNS:
        if pat.search(title):
            out["tier"] = tier
            break

    # ─── 4. Priority assignment per operator directive 2026-05-10 :
    #         priority 1 = LEC 2024+ main roster
    #         priority 2 = LFL pre-2024 main roster
    #         priority 3 = KCB / KCBS / KC GC
    #         priority 0 = no KC mention at all (drop)
    if out["roster"] == "kc_main":
        if out["tier"] in (
            "lec", "lec_versus", "lec_playoffs",
            "worlds", "msi", "first_stand", "ewc",
        ):
            out["priority"] = 1
        elif out["tier"] in ("lfl", "eu_masters"):
            # LFL pre-2024 was main team era ; LFL 2024+ is KCB territory
            # but we filter that via roster first. If we land here with
            # KC_MAIN_RE matching (no Blue/GC mention) on an LFL tier,
            # it MUST be the pre-2024 LFL main team.
            out["priority"] = 2
        else:
            # KC main mention without a recognised LoL tier = ambiguous
            # ("video without KC", "KC won", random titles where the KC
            # substring appears in prose). Drop to avoid noise.
            out["priority"] = 0
            out["skip_reason"] = "no_lol_tier"
    elif out["roster"] in ("kcb", "kcbs"):
        if out["tier"] != "unknown":
            out["priority"] = 3
            out["skip_reason"] = "secondary_roster_deferred"
        else:
            out["priority"] = 0
            out["skip_reason"] = "no_lol_tier"
    elif out["roster"] == "kc_gc":
        out["priority"] = 0
        out["skip_reason"] = "non_lol_roster"
    else:
        # No KC mention at all — drop
        out["priority"] = 0
        out["skip_reason"] = "no_kc"

    return out


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

async def _fetch_rss_dates(channel_uc_id: str) -> dict[str, str]:
    """Fetch the last ~15 video published timestamps via YouTube RSS.

    Wave 27.20 — yt-dlp's extract_flat mode (used by _fetch_recent_uploads
    for speed) returns upload_date=None, leaving channel_videos.
    published_at NULL and breaking the channel_reconciler's time-window
    join with matches.scheduled_at. RSS is 200ms per channel and ships
    full ISO timestamps in <published>tags, so we merge it in alongside
    the yt-dlp flat fetch.

    Returns {video_id: ISO timestamp} ; empty dict on any failure.
    """
    try:
        import re as _re
        from services import http_pool
        url = f"https://www.youtube.com/feeds/videos.xml?channel_id={channel_uc_id}"
        client = http_pool.get("youtube_rss", timeout=10)
        r = await client.get(url)
        if r.status_code != 200:
            return {}
        body = r.text
        # Two patterns alternating in RSS feed entries — pair them by order.
        # <yt:videoId>...</yt:videoId> precedes the corresponding
        # <published>... </published> within each <entry>.
        ids = _re.findall(r"<yt:videoId>([^<]+)</yt:videoId>", body)
        dates = _re.findall(r"<published>([^<]+)</published>", body)
        # The RSS feed has one outer <published> for the channel itself
        # at the top, then per-entry <published>. The number of <published>
        # is len(ids) + 1, so skip the first.
        if len(dates) == len(ids) + 1:
            dates = dates[1:]
        return dict(zip(ids, dates))
    except Exception as e:
        log.warn("rss_fetch_failed", channel=channel_uc_id, error=str(e)[:160])
        return {}


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
    # PR24 — inject the cookies file path when configured. yt-dlp's
    # Python API uses `cookiefile` (not the CLI's --cookies). Skip
    # silently if no cookies are wired up.
    try:
        from services import youtube_cookies
        cli = youtube_cookies.cli_args()
        # cli is either [] or ["--cookies", "/abs/path"]
        if len(cli) == 2 and cli[0] == "--cookies":
            opts["cookiefile"] = cli[1]
    except Exception:
        pass

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
    # Wave 27.20 — fetch yt-dlp + RSS in parallel ; RSS gives us the
    # published_at dates that yt-dlp's extract_flat strips.
    entries, rss_dates = await asyncio.gather(
        _fetch_recent_uploads(cid),
        _fetch_rss_dates(cid),
    )
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
    is_kc_replay = (cid == "UCApmTE4So9oX7sPkDGgSpFQ")  # @KarmineCorpReplay
    for entry in new_entries:
        title = entry.get("title") or ""
        rel = kc_relevance(title)

        # Wave 27.22 — Karmine Corp Replay channel uses its own
        # classifier that filters by game (LoL only) and roster
        # (KC main first, KCB/KCBS deferred). Per operator directive
        # 2026-05-10, this is the unique source for match VOD clipping.
        if is_kc_replay:
            kcr = classify_kc_replay_title(title)
            classification = {
                "video_type": kcr["video_type"],
                "kc_replay_roster": kcr["roster"],
                "kc_replay_tier": kcr["tier"],
                "kc_replay_priority": kcr["priority"],
            }
            # Status from priority :
            #   1, 2 -> classified (ready for reconciliation)
            #   3    -> not_kc      (deferred secondary roster, won't reconcile)
            #   0    -> not_kc      (non-LoL or no KC mention)
            if kcr["priority"] in (1, 2):
                status = "classified"
            elif kcr["priority"] == 3:
                status = "not_kc"  # parked, won't burn reconciler cycles
            else:
                status = "not_kc"  # non-LoL VCT/RL/R6 or non-KC content
            # Bypass the rel-score gate because the classifier is more
            # specific than the generic kc_relevance regex.
        else:
            classification = classify_title(title, role)
            # Decide initial status (legacy path for any remaining
            # non-KC-Replay channels that get re-activated)
            status = "discovered"
            if rel < 0.3:
                status = "not_kc"
            elif rel >= 0.7 and classification.get("video_type"):
                status = "classified"
            elif rel >= 0.3:
                status = "manual_review"

        # Wave 27.20 — get published_at from RSS first (real ISO
        # timestamp, blazing fast), then fall back to yt-dlp's
        # upload_date if RSS missed this video. extract_flat=True
        # strips upload_date so this fallback is rare in practice
        # but kept for defensive coverage.
        # Without this every row landed with published_at=NULL, which
        # broke channel_reconciler's time-window match (it filters
        # matches by scheduled_at within ±14 days of the video's
        # published_at). 72 KC-related LEC highlights were stuck in
        # 'discovered' status forever as a result.
        published_at_iso: str | None = rss_dates.get(entry["id"])
        if published_at_iso is None:
            upload_date = entry.get("upload_date")  # 'YYYYMMDD'
            if upload_date and len(upload_date) == 8 and upload_date.isdigit():
                try:
                    published_at_iso = (
                        f"{upload_date[:4]}-{upload_date[4:6]}-{upload_date[6:8]}"
                        "T00:00:00+00:00"
                    )
                except Exception:
                    published_at_iso = None

        # Wave 27.21 — duration comes back from yt-dlp as a float
        # ("2083.0"). PostgREST rejects float values for the INT column
        # `duration_seconds` with `22P02 invalid input syntax for type
        # integer`. Cast defensively.
        dur_raw = entry.get("duration")
        try:
            duration_int: int | None = (
                int(round(float(dur_raw))) if dur_raw is not None else None
            )
        except (TypeError, ValueError):
            duration_int = None

        row = {
            "id": entry["id"],
            "channel_id": cid,
            "title": title[:500],
            "duration_seconds": duration_int,
            "status": status,
            "video_type": classification.get("video_type"),
            "kc_relevance_score": rel,
        }
        if published_at_iso is not None:
            row["published_at"] = published_at_iso
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

@run_logged()
async def run() -> int:
    """Poll every active channel, return total new videos inserted."""
    log.info("channel_discoverer_scan_start")

    db = get_db()
    if not db:
        return 0

    # Wave 27.5 — sync httpx.get offloaded so the discoverer doesn't
    # freeze the event loop while waiting on the channels list.
    r = await asyncio.to_thread(
        httpx.get,
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
