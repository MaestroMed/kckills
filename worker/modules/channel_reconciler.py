"""
CHANNEL_RECONCILER v2 — Match channel_videos rows to (match, game, content_type).

V1 covered LEC 2024+ via @LEC's standardised "TEAMA vs TEAMB | HIGHLIGHTS"
title format. V2 extends coverage to :
  - LFL  (KC's roots 2021-2023, FR titles, "OTPLOL", "LFL")
  - EU Masters (KC's 3 EUM titles, "EUM", "EU Masters", "EM")
  - Worlds qualifiers / play-in
  - First Stand 2025
  - Kameto Clips short-clip titles ("KILL DE X", "PENTAKILL DE Y")
  - KC official channel content (voicecomms, debriefs, post-match,
    interviews, funny moments) — these have no in-game footage but
    SHOULD be attached to a match as "context" so the /match/[slug]
    page can surface them.

Backward-compat : v1 LEC_HIGHLIGHTS_RE / LIVE_GAME_RE preserved
unchanged — existing rows still parse identically.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone, timedelta

import httpx
import structlog

from services.observability import run_logged
from services.supabase_client import get_db, safe_select, safe_update, safe_upsert

log = structlog.get_logger()


# ─── Regex bank (most-specific first) ─────────────────────────────────

# LEC v1 — preserved verbatim for backward compat
LEC_HIGHLIGHTS_RE = re.compile(
    r"^([A-Z0-9]{2,4})\s*vs\.?\s*([A-Z0-9]{2,4})\s*\|\s*HIGHLIGHTS",
    re.IGNORECASE,
)
LIVE_GAME_RE = re.compile(
    r"^([A-Z0-9]{2,4})\s*vs\.?\s*([A-Z0-9]{2,4})\s*Game\s*(\d)",
    re.IGNORECASE,
)

# LFL — both EN and FR variants
LFL_HIGHLIGHTS_RE = re.compile(
    r"(?:^|\b)([A-Z0-9.]{2,8})\s*vs\.?\s*([A-Z0-9.]{2,8})\s*"
    r"[\|\-–]?\s*"
    r"(?:.*?)?\b(LFL|Ligue\s+Fran[cç]aise)\b",
    re.IGNORECASE,
)
LFL_BRACKET_RE = re.compile(
    r"^\[?\s*LFL\s*\]?\s*[:\-–\|]?\s*"
    r"([A-Z0-9.]{2,8})\s*vs\.?\s*([A-Z0-9.]{2,8})",
    re.IGNORECASE,
)

# EU Masters — Riot uses "EU Masters", "EM", "EUM", "EMEA Masters"
EUM_HIGHLIGHTS_RE = re.compile(
    r"(?:^|\b)([A-Z0-9.]{2,8})\s*vs\.?\s*([A-Z0-9.]{2,8})\s*"
    r"[\|\-–]?\s*"
    r"(?:.*?)?\b(EU\s*Masters?|EUM|EMEA\s*Masters?|European\s*Masters?)\b",
    re.IGNORECASE,
)

# Worlds (Play-In / Knockouts) — sometimes just "Worlds 2021"
WORLDS_RE = re.compile(
    r"(?:^|\b)([A-Z0-9.]{2,8})\s*vs\.?\s*([A-Z0-9.]{2,8})\s*"
    r"[\|\-–]?\s*"
    r"(?:.*?)?\b(Worlds?|World\s*Championship|Play[-\s]*In|Knockouts?)\s*"
    r"(\d{4})?",
    re.IGNORECASE,
)

# First Stand (2025+)
FIRSTSTAND_RE = re.compile(
    r"(?:^|\b)([A-Z0-9.]{2,8})\s*vs\.?\s*([A-Z0-9.]{2,8})\s*"
    r"[\|\-–]?\s*"
    r"(?:.*?)?\b(First\s*Stand)\b",
    re.IGNORECASE,
)

# Kameto Clips — heavily varied, FR-only
KAMETO_CLIP_RE = re.compile(
    r"^\s*"
    r"(?P<action>PENTA(?:KILL)?|QUADRA(?:KILL)?|TRIPLE(?:KILL)?|KILL|GROS\s+PLAY|"
    r"INSANE\s+PLAY|OUTPLAY|MOMENT\s+DR[OÔ]LE|ENGAGE|CLUTCH|FLASH(?:\s+PREDICT)?|"
    r"SOLO\s+KILL|1V[2345]|R[EÉ]ACTION|HIGHLIGHT)"
    r"\s+(?:DE\s+|D[E']\s*)"
    r"(?P<player>[A-Za-z0-9_]+)",
    re.IGNORECASE,
)

# Karmine Corp official channel — voicecomms / debrief / post-match / interview / funny
KC_VOICECOMMS_RE = re.compile(r"\b(voice\s*comm?s?|voc\b|com\s*vocale)\b", re.IGNORECASE)
KC_DEBRIEF_RE = re.compile(r"\b(debrief|d[eé]brief|review|analyse\s+post)\b", re.IGNORECASE)
KC_POSTMATCH_RE = re.compile(r"\b(post[-\s]*match|apr[eè]s\s+match|after\s+game)\b", re.IGNORECASE)
KC_INTERVIEW_RE = re.compile(r"\b(interview|itw|press[-\s]*conference|conf[eé]rence)\b", re.IGNORECASE)
KC_FUNNY_RE = re.compile(r"\b(funny\s+moment|moment\s+dr[oô]le|best\s+of|fail|bloopers?)\b", re.IGNORECASE)

# Common metadata extractors
WEEK_DAY_RE = re.compile(r"Week\s*(\d+)\s*Day\s*(\d+)", re.IGNORECASE)
WEEK_FR_RE = re.compile(r"Semaine\s*(\d+)(?:\s*Jour\s*(\d+))?", re.IGNORECASE)
SPLIT_RE = re.compile(
    r"\b(Spring|Summer|Winter|Versus|Printemps|[EÉ]t[eé]|Hiver)\s*(\d{4})\b",
    re.IGNORECASE,
)
GAME_N_RE = re.compile(r"\bGame\s*(\d)\b", re.IGNORECASE)


# ─── Team-code aliases ────────────────────────────────────────────────
TEAM_ALIAS: dict[str, str] = {
    "KARMINE": "KC", "KCORP": "KC", "KARMINECORP": "KC",
    "KCB": "KCB", "KARMINE.B": "KCB", "KARMINEB": "KCB",
    "VIT.B": "VITB", "VITALITY.BEE": "VITB", "VITALITYBEE": "VITB", "BEE": "VITB",
    "FNC.R": "FNCR", "FNATIC.RISING": "FNCR", "FNATICRISING": "FNCR",
    "BDS.A": "BDSA", "BDS.ACADEMY": "BDSA", "BDSACADEMY": "BDSA",
    "MISFITS.P": "MSFP", "MISFITSPREMIER": "MSFP",
    "OTPLOL": "OPL",
    "GW": "GMW", "GAMEWARD": "GMW",
    "LDLC.OL": "LDL", "LDLCOL": "LDL",
    "MCES": "MCE",
    "BKR": "BKROG", "BK": "BKROG", "BK.ROG": "BKROG",
    "SOLARY": "SLY",
    "G2ESPORTS": "G2",
    "FNATIC": "FNC",
    "MADLIONS": "MAD",
    "TEAM.HERETICS": "TH", "HERETICS": "TH",
    "TEAMBDS": "BDS",
    "VITALITY": "VIT", "TEAMVITALITY": "VIT",
    "MOVISTAR.KOI": "MKOI", "MOVISTARKOI": "MKOI",
    "GIANTX": "GX",
    "ROGUE": "RGE",
    "SKGAMING": "SK",
    "ASTRALIS": "AST",
    "EXCEL": "XL",
    "HANWHALIFE": "HLE",
    "TOPESPORTS": "TES",
    "CTBC": "CFO", "FLYING.OYSTER": "CFO",
}


def normalise_team(code: str) -> str:
    """Strip dots/spaces/case, map to canonical via TEAM_ALIAS."""
    cleaned = re.sub(r"[\s.\-]", "", code).upper()
    return TEAM_ALIAS.get(cleaned, cleaned)


# ─── Title parser ─────────────────────────────────────────────────────

def parse_title_for_match(title: str, role: str | None = None) -> dict | None:
    """Extract structured match info from a channel video title."""
    if not title:
        return None

    # 1. KC official channel content (cheapest checks first)
    if role == "team_official":
        low = title.lower()
        if KC_VOICECOMMS_RE.search(low):
            return {"video_type": "voicecomms", "content_type": "voicecomms"}
        if KC_DEBRIEF_RE.search(low):
            return {"video_type": "debrief", "content_type": "debrief"}
        if KC_POSTMATCH_RE.search(low):
            return {"video_type": "post_match", "content_type": "post_match"}
        if KC_INTERVIEW_RE.search(low):
            return {"video_type": "interview", "content_type": "interview"}
        if KC_FUNNY_RE.search(low):
            return {"video_type": "funny_moment", "content_type": "funny_moment"}

    # 2. Streamer clips (Kameto Clips role)
    if role == "streamer_clips":
        m = KAMETO_CLIP_RE.search(title)
        if m:
            return {
                "video_type": "clip",
                "content_type": "kameto_clip",
                "action": m.group("action").lower().replace(" ", "_"),
                "player": m.group("player").lower(),
            }

    # 3. Match-coverage videos (LEC / LFL / EUM / Worlds / First Stand)
    out: dict = {}

    # LEC (v1 backward-compat first)
    m = LEC_HIGHLIGHTS_RE.search(title)
    if m:
        out["team_a"] = normalise_team(m.group(1))
        out["team_b"] = normalise_team(m.group(2))
        out["league"] = "lec"
        out["video_type"] = "game_highlights"
        out["content_type"] = "highlights"

    if not out:
        m = LIVE_GAME_RE.search(title)
        if m:
            out["team_a"] = normalise_team(m.group(1))
            out["team_b"] = normalise_team(m.group(2))
            out["game_n"] = int(m.group(3))
            out["league"] = "lec"
            out["video_type"] = "single_game"
            out["content_type"] = "single_game"

    if not out:
        m = LFL_BRACKET_RE.search(title) or LFL_HIGHLIGHTS_RE.search(title)
        if m:
            out["team_a"] = normalise_team(m.group(1))
            out["team_b"] = normalise_team(m.group(2))
            out["league"] = "lfl"
            out["video_type"] = "game_highlights"
            out["content_type"] = "highlights"

    if not out:
        m = EUM_HIGHLIGHTS_RE.search(title)
        if m:
            out["team_a"] = normalise_team(m.group(1))
            out["team_b"] = normalise_team(m.group(2))
            out["league"] = "eum"
            out["video_type"] = "game_highlights"
            out["content_type"] = "highlights"

    if not out:
        m = WORLDS_RE.search(title)
        if m:
            out["team_a"] = normalise_team(m.group(1))
            out["team_b"] = normalise_team(m.group(2))
            out["league"] = "worlds"
            out["video_type"] = "game_highlights"
            out["content_type"] = "highlights"
            if m.group(4):
                out["year"] = int(m.group(4))

    if not out:
        m = FIRSTSTAND_RE.search(title)
        if m:
            out["team_a"] = normalise_team(m.group(1))
            out["team_b"] = normalise_team(m.group(2))
            out["league"] = "first_stand"
            out["video_type"] = "game_highlights"
            out["content_type"] = "highlights"

    if not out:
        return None

    # 4. Enrich with shared metadata
    m = GAME_N_RE.search(title)
    if m and "game_n" not in out:
        out["game_n"] = int(m.group(1))

    m = WEEK_DAY_RE.search(title) or WEEK_FR_RE.search(title)
    if m:
        out["week"] = int(m.group(1))
        if m.lastindex and m.lastindex >= 2 and m.group(2):
            out["day"] = int(m.group(2))

    m = SPLIT_RE.search(title)
    if m:
        split_raw = m.group(1).lower()
        SPLIT_MAP = {
            "spring": "spring", "printemps": "spring",
            "summer": "summer", "été": "summer", "ete": "summer",
            "winter": "winter", "hiver": "winter",
            "versus": "versus",
        }
        out["split"] = SPLIT_MAP.get(split_raw, split_raw)
        out["year"] = int(m.group(2))

    return out


# ─── Match candidate lookup ───────────────────────────────────────────

async def find_match_candidates(
    db,
    parsed: dict,
    published_at: datetime | None,
) -> list[dict]:
    """Look up matches table for KC matches matching parsed teams + date window."""
    teams = {parsed.get("team_a"), parsed.get("team_b")}
    teams.discard(None)
    kc_in = teams & {"KC", "KCB"}
    if not kc_in:
        return []
    opp_set = teams - kc_in
    if not opp_set:
        return []
    opp = next(iter(opp_set))

    if published_at is None:
        if parsed.get("league") in ("lfl", "eum") and parsed.get("year"):
            year = parsed["year"]
            window_start = datetime(year, 1, 1, tzinfo=timezone.utc).isoformat()
            window_end = datetime(year, 12, 31, 23, 59, tzinfo=timezone.utc).isoformat()
        else:
            window_start = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
            window_end = datetime.now(timezone.utc).isoformat()
    else:
        is_live = parsed.get("video_type") == "single_game"
        is_historical = parsed.get("league") in ("lfl", "eum") and parsed.get("year", 9999) < 2024
        if is_live:
            window_start = (published_at - timedelta(days=2)).isoformat()
            window_end = (published_at + timedelta(hours=12)).isoformat()
        elif is_historical:
            year = parsed.get("year") or published_at.year
            window_start = datetime(year, 1, 1, tzinfo=timezone.utc).isoformat()
            window_end = datetime(year, 12, 31, 23, 59, tzinfo=timezone.utc).isoformat()
        else:
            window_start = (published_at - timedelta(days=7)).isoformat()
            window_end = (published_at + timedelta(days=1)).isoformat()

    r = httpx.get(
        f"{db.base}/matches",
        headers=db.headers,
        params={
            "select": (
                "id,external_id,scheduled_at,stage,"
                "team_blue:teams!matches_team_blue_id_fkey(code),"
                "team_red:teams!matches_team_red_id_fkey(code)"
            ),
            "scheduled_at": [
                f"gte.{window_start}",
                f"lte.{window_end}",
            ],
            "limit": 100,
        },
        timeout=15.0,
    )
    if r.status_code != 200:
        log.warn("reconciler_match_query_failed", status=r.status_code)
        return []
    candidates = r.json() or []

    matched = []
    for m in candidates:
        codes = {
            (m.get("team_blue") or {}).get("code"),
            (m.get("team_red") or {}).get("code"),
        }
        codes.discard(None)
        if not (codes & {"KC", "KCB"}):
            continue
        if opp not in codes:
            continue
        matched.append(m)
    return matched


# ─── Reconciliation per row ───────────────────────────────────────────

async def reconcile_one(db, video: dict) -> str:
    """Reconcile a single channel_video row. Returns the new status."""
    title = video.get("title") or ""
    role = video.get("channel_role")
    parsed = parse_title_for_match(title, role=role)

    if not parsed:
        safe_update(
            "channel_videos",
            {"status": "manual_review", "notes": f"Unparseable: {title[:80]}"},
            "id", video["id"],
        )
        return "manual_review"

    content_type = parsed.get("content_type")

    # Standalone content (no match link) — Kameto generic clips, KC funny moments
    if content_type in ("kameto_clip", "funny_moment") and "team_a" not in parsed:
        safe_update(
            "channel_videos",
            {
                "status": "matched",
                "video_type": parsed.get("video_type"),
                "content_type": content_type,
                "matched_at": datetime.now(timezone.utc).isoformat(),
                "notes": f"Standalone {content_type}",
            },
            "id", video["id"],
        )
        return "matched"

    # KC official content WITHOUT a parsed match
    if content_type in ("voicecomms", "debrief", "post_match", "interview") \
            and "team_a" not in parsed:
        safe_update(
            "channel_videos",
            {
                "status": "matched",
                "video_type": parsed.get("video_type"),
                "content_type": content_type,
                "matched_at": datetime.now(timezone.utc).isoformat(),
                "notes": f"Standalone {content_type}",
            },
            "id", video["id"],
        )
        return "matched"

    published_at = None
    if video.get("published_at"):
        try:
            published_at = datetime.fromisoformat(
                video["published_at"].replace("Z", "+00:00"),
            )
        except (ValueError, AttributeError):
            published_at = None

    candidates = await find_match_candidates(db, parsed, published_at)

    if len(candidates) == 0:
        log.info(
            "reconcile_no_match",
            video_id=video["id"],
            league=parsed.get("league"),
            teams=f"{parsed.get('team_a')}/{parsed.get('team_b')}",
            title=title[:60],
        )
        safe_update(
            "channel_videos",
            {
                "status": "manual_review",
                "video_type": parsed.get("video_type"),
                "content_type": content_type,
                "notes": f"No match {parsed.get('team_a')}/{parsed.get('team_b')} ({parsed.get('league')})",
            },
            "id", video["id"],
        )
        return "manual_review"

    if len(candidates) > 1:
        log.info(
            "reconcile_ambiguous",
            video_id=video["id"],
            count=len(candidates),
            title=title[:60],
        )
        safe_update(
            "channel_videos",
            {
                "status": "manual_review",
                "video_type": parsed.get("video_type"),
                "content_type": content_type,
                "notes": f"Ambiguous: {len(candidates)} candidates",
            },
            "id", video["id"],
        )
        return "manual_review"

    # Exactly 1 candidate → matched
    cand = candidates[0]
    safe_update(
        "channel_videos",
        {
            "status": "matched",
            "video_type": parsed.get("video_type"),
            "content_type": content_type,
            "matched_match_external_id": cand["external_id"],
            "matched_game_number": parsed.get("game_n"),
            "matched_at": datetime.now(timezone.utc).isoformat(),
        },
        "id", video["id"],
    )

    # If "context" video, ALSO insert into match_context_videos for the
    # /match/[slug] page. Best-effort — only works after migration 019
    # is applied.
    CONTEXT_TYPES = {
        "voicecomms", "debrief", "post_match",
        "interview", "funny_moment", "kameto_clip",
    }
    if content_type in CONTEXT_TYPES:
        try:
            safe_upsert(
                "match_context_videos",
                {
                    "match_external_id": cand["external_id"],
                    "video_id": video["id"],
                    "channel_id": video.get("channel_id"),
                    "content_type": content_type,
                    "title": title[:500],
                    "url": f"https://www.youtube.com/watch?v={video['id']}",
                    "published_at": video.get("published_at"),
                },
                on_conflict="match_external_id,video_id",
            )
        except Exception as e:
            log.warn("context_video_insert_failed", error=str(e)[:100])

    log.info(
        "reconcile_matched",
        video_id=video["id"],
        match_ext_id=cand["external_id"],
        game_n=parsed.get("game_n"),
        content_type=content_type,
    )
    return "matched"


# ─── Daemon loop ──────────────────────────────────────────────────────

@run_logged()
async def run() -> int:
    """Reconcile all channel_videos rows in status='classified'."""
    log.info("channel_reconciler_v2_start")

    db = get_db()
    if not db:
        return 0

    r = httpx.get(
        f"{db.base}/channel_videos",
        headers=db.headers,
        params={
            "select": "id,channel_id,title,published_at,channels!inner(role)",
            "status": "eq.classified",
            "limit": 50,
        },
        timeout=15.0,
    )
    if r.status_code != 200:
        log.warn("reconciler_fetch_failed", status=r.status_code)
        return 0

    rows = r.json() or []
    if not rows:
        log.info("channel_reconciler_no_pending")
        return 0

    for row in rows:
        ch = row.pop("channels", None) or {}
        row["channel_role"] = ch.get("role")

    matched_count = 0
    for row in rows:
        try:
            new_status = await reconcile_one(db, row)
            if new_status == "matched":
                matched_count += 1
        except Exception as e:
            log.error(
                "reconcile_error",
                video_id=row.get("id"),
                error=str(e)[:200],
            )

    log.info(
        "channel_reconciler_v2_done",
        processed=len(rows),
        matched=matched_count,
    )
    return matched_count
