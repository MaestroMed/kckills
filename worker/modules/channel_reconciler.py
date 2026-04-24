"""
CHANNEL_RECONCILER v3 — Match channel_videos rows to (match, game, content_type).

V1 covered LEC 2024+ via @LEC's standardised "TEAMA vs TEAMB | HIGHLIGHTS"
title format. V2 extended coverage to LFL / EUM / Worlds / First Stand /
Kameto Clips / KC official channel content_types.

V3 (PR25) FIXES THE 154-VIDEO BACKLOG. Three concrete bugs were stopping
matches from ever being linked :

  A) The status filter was too tight. The discoverer scores most match
     titles like "TH vs KC | HIGHLIGHTS" at relevance 0.5 (single \\bKC\\b
     hit), which lands the row in `manual_review` — NOT `classified`.
     V3 widens the input set to {discovered, classified, manual_review}
     and re-attempts parsing.

  B) The discoverer never persists `published_at`, so the v2 reconciler's
     30-day default window was missing every historical video. V3 widens
     to ±7 days when published_at exists, and falls back to the FULL
     team-vs-team history when it doesn't (closest match by date wins).

  C) The match-lookup was strictly ordered (team_a vs team_b expected to
     appear in a specific blue/red slot). V3 matches on the SET of team
     codes — KC/TH and TH/KC both hit the same matches row.

Once a match is found we set :
  status = 'matched'
  matched_match_external_id = <external_id>
  matched_game_number       = <int from "Game N" if any>
  matched_at                = now()
  kc_relevance_score        = max(existing, 0.7)   <- promote to "matched"

Backward-compat : v1 LEC_HIGHLIGHTS_RE / LIVE_GAME_RE preserved unchanged.
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

# Generic "TEAMA vs TEAMB" anywhere in the title — fallback when no
# tournament tag is present (covers KC official replays / Kameto VOD
# rebroadcasts whose titles are just "KC vs G2 - BO5 Finale").
GENERIC_VS_RE = re.compile(
    r"(?:^|\b)([A-Z0-9.]{2,8})\s*vs\.?\s*([A-Z0-9.]{2,8})\b",
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
YEAR_RE = re.compile(r"\b(20[2-3]\d)\b")


# ─── Team-code aliases ────────────────────────────────────────────────
# Keys are normalised (no dot/space/dash, uppercase). Values are the
# canonical 2-4 letter codes stored in the `teams.code` column.
TEAM_ALIAS: dict[str, str] = {
    "KARMINE": "KC", "KCORP": "KC", "KARMINECORP": "KC",
    "KCB": "KCB", "KARMINEB": "KCB",
    "VITB": "VITB", "VITALITYBEE": "VITB", "BEE": "VITB",
    "FNCR": "FNCR", "FNATICRISING": "FNCR",
    "BDSA": "BDSA", "BDSACADEMY": "BDSA",
    "MISFITSP": "MSFP", "MISFITSPREMIER": "MSFP",
    "OTPLOL": "OPL",
    "GW": "GMW", "GAMEWARD": "GMW",
    "LDLCOL": "LDL",
    "MCES": "MCE",
    "BKR": "BKROG", "BK": "BKROG", "BKROG": "BKROG",
    "SOLARY": "SLY",
    "G2ESPORTS": "G2",
    "FNATIC": "FNC",
    "MADLIONS": "MAD",
    "TEAMHERETICS": "TH", "HERETICS": "TH",
    "TEAMBDS": "BDS",
    "VITALITY": "VIT", "TEAMVITALITY": "VIT",
    "MOVISTARKOI": "MKOI",
    # Note : many sources use "GX" but the DB stores "GIANTX". We invert
    # the mapping — anything looking GiantX-ish normalises to GIANTX.
    "GX": "GIANTX", "GIANTX": "GIANTX",
    "ROGUE": "RGE",
    "SKGAMING": "SK",
    "ASTRALIS": "AST",
    "EXCEL": "XL",
    "HANWHALIFE": "HLE",
    "TOPESPORTS": "TES",
    "CTBC": "CFO", "FLYINGOYSTER": "CFO",
}


def normalise_team(code: str) -> str:
    """Strip dots/spaces/dashes/case, map to canonical via TEAM_ALIAS."""
    if not code:
        return ""
    cleaned = re.sub(r"[\s.\-]", "", code).upper()
    return TEAM_ALIAS.get(cleaned, cleaned)


# Codes that can NEVER be a team — these look like teams in the regex
# but are tournament tags or noise. Must drop them before looking up
# matches, otherwise we'd issue ridiculous queries.
NON_TEAM_TOKENS = {
    "VS", "EN", "ET", "OU", "DE", "DU", "LA", "LE", "LES",
    "BO1", "BO3", "BO5",
    "GAME", "DAY", "WEEK", "SEMAINE", "JOUR",
    "LEC", "LFL", "EUM", "EM", "WORLDS", "MSI",
    "FIRSTSTAND", "PLAYOFFS", "FINAL", "FINALE", "REGULAR",
    "SPRING", "SUMMER", "WINTER", "VERSUS",
    "HIGHLIGHTS", "HIGHLIGHT", "VOD", "FULL",
}


# ─── Title parser ─────────────────────────────────────────────────────

def parse_title_for_match(title: str, role: str | None = None) -> dict | None:
    """Extract structured match info from a channel video title.

    Returns None when nothing parses ; otherwise a dict with at least
    `content_type` set, plus optionally `team_a`/`team_b`/`game_n`/etc.
    """
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
        a, b = normalise_team(m.group(1)), normalise_team(m.group(2))
        if a not in NON_TEAM_TOKENS and b not in NON_TEAM_TOKENS:
            out["team_a"] = a
            out["team_b"] = b
            out["league"] = "lec"
            out["video_type"] = "game_highlights"
            out["content_type"] = "highlights"

    if not out:
        m = LIVE_GAME_RE.search(title)
        if m:
            a, b = normalise_team(m.group(1)), normalise_team(m.group(2))
            if a not in NON_TEAM_TOKENS and b not in NON_TEAM_TOKENS:
                out["team_a"] = a
                out["team_b"] = b
                out["game_n"] = int(m.group(3))
                out["league"] = "lec"
                out["video_type"] = "single_game"
                out["content_type"] = "single_game"

    if not out:
        m = LFL_BRACKET_RE.search(title) or LFL_HIGHLIGHTS_RE.search(title)
        if m:
            a, b = normalise_team(m.group(1)), normalise_team(m.group(2))
            if a not in NON_TEAM_TOKENS and b not in NON_TEAM_TOKENS:
                out["team_a"] = a
                out["team_b"] = b
                out["league"] = "lfl"
                out["video_type"] = "game_highlights"
                out["content_type"] = "highlights"

    if not out:
        m = EUM_HIGHLIGHTS_RE.search(title)
        if m:
            a, b = normalise_team(m.group(1)), normalise_team(m.group(2))
            if a not in NON_TEAM_TOKENS and b not in NON_TEAM_TOKENS:
                out["team_a"] = a
                out["team_b"] = b
                out["league"] = "eum"
                out["video_type"] = "game_highlights"
                out["content_type"] = "highlights"

    if not out:
        m = WORLDS_RE.search(title)
        if m:
            a, b = normalise_team(m.group(1)), normalise_team(m.group(2))
            if a not in NON_TEAM_TOKENS and b not in NON_TEAM_TOKENS:
                out["team_a"] = a
                out["team_b"] = b
                out["league"] = "worlds"
                out["video_type"] = "game_highlights"
                out["content_type"] = "highlights"
                if m.group(4):
                    out["year"] = int(m.group(4))

    if not out:
        m = FIRSTSTAND_RE.search(title)
        if m:
            a, b = normalise_team(m.group(1)), normalise_team(m.group(2))
            if a not in NON_TEAM_TOKENS and b not in NON_TEAM_TOKENS:
                out["team_a"] = a
                out["team_b"] = b
                out["league"] = "first_stand"
                out["video_type"] = "game_highlights"
                out["content_type"] = "highlights"

    # Last-resort generic "TEAMA vs TEAMB" — only fires if KC is on at
    # least one side, otherwise we'd pull garbage matches.
    if not out:
        m = GENERIC_VS_RE.search(title)
        if m:
            a, b = normalise_team(m.group(1)), normalise_team(m.group(2))
            if (a not in NON_TEAM_TOKENS and b not in NON_TEAM_TOKENS
                    and (a in ("KC", "KCB") or b in ("KC", "KCB"))):
                out["team_a"] = a
                out["team_b"] = b
                out["league"] = "unknown"
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
    elif "year" not in out:
        m = YEAR_RE.search(title)
        if m:
            out["year"] = int(m.group(1))

    return out


# ─── Match candidate lookup ───────────────────────────────────────────

def _matches_in_window(
    db,
    *,
    window_start: str | None,
    window_end: str | None,
) -> list[dict]:
    """Fetch matches in an optional time window, embedded with team codes."""
    # PostgREST httpx tuple-list trick : a list of (key, value) tuples
    # serialises to multiple `key=value` query string entries — exactly
    # what's needed to AND `scheduled_at=gte.X` AND `scheduled_at=lte.Y`.
    # Passing {"scheduled_at": [...]} only keeps the LAST value (httpx
    # collapses duplicate keys when the value is a list of strings).
    params: list[tuple[str, str]] = [
        (
            "select",
            "id,external_id,scheduled_at,stage,"
            "team_blue:teams!matches_team_blue_id_fkey(code),"
            "team_red:teams!matches_team_red_id_fkey(code)",
        ),
        ("order", "scheduled_at.desc"),
        ("limit", "500"),
    ]
    if window_start:
        params.append(("scheduled_at", f"gte.{window_start}"))
    if window_end:
        params.append(("scheduled_at", f"lte.{window_end}"))

    r = httpx.get(
        f"{db.base}/matches",
        headers=db.headers,
        params=params,
        timeout=20.0,
    )
    if r.status_code != 200:
        log.warn(
            "reconciler_match_query_failed",
            status=r.status_code,
            body=r.text[:200],
        )
        return []
    return r.json() or []


async def find_match_candidates(
    db,
    parsed: dict,
    published_at: datetime | None,
) -> list[dict]:
    """Look up matches involving the parsed teams within a sensible window.

    Match logic :
      - SET-equal team codes (KC/TH == TH/KC, no blue/red ordering).
      - Window :
          * published_at known   -> ±7 days around it (LEC / LFL / EUM
                                    typical upload delay 0-48h, but a
                                    Kameto re-upload can drift days).
          * year hint, no date   -> entire year.
          * neither              -> entire history (closest-by-date wins).
      - One side must always be KC / KCB.
    """
    teams = {parsed.get("team_a"), parsed.get("team_b")}
    teams.discard(None)
    teams.discard("")
    kc_in = teams & {"KC", "KCB"}
    if not kc_in:
        return []
    opp_set = teams - kc_in
    if not opp_set:
        return []
    opp = next(iter(opp_set))

    window_start: str | None = None
    window_end: str | None = None

    if published_at is not None:
        window_start = (published_at - timedelta(days=7)).isoformat()
        window_end = (published_at + timedelta(days=7)).isoformat()
    elif parsed.get("year"):
        year = int(parsed["year"])
        window_start = datetime(year, 1, 1, tzinfo=timezone.utc).isoformat()
        window_end = datetime(year, 12, 31, 23, 59, 59, tzinfo=timezone.utc).isoformat()
    # else: full history, no window

    candidates = _matches_in_window(
        db,
        window_start=window_start,
        window_end=window_end,
    )

    matched: list[dict] = []
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


def _pick_closest(
    candidates: list[dict],
    pivot: datetime | None,
) -> dict | None:
    """Closest scheduled_at to the pivot. Fallback : most recent."""
    if not candidates:
        return None
    if pivot is None:
        # Newest match wins — already DESC-sorted by the query
        return candidates[0]

    def _dist(c: dict) -> float:
        sched = c.get("scheduled_at")
        if not sched:
            return 10**12
        try:
            dt = datetime.fromisoformat(sched.replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            return 10**12
        return abs((dt - pivot).total_seconds())

    return min(candidates, key=_dist)


# ─── Reconciliation per row ───────────────────────────────────────────

async def reconcile_one(db, video: dict) -> str:
    """Reconcile a single channel_video row. Returns the new status."""
    video_id = video["id"]
    title = video.get("title") or ""
    role = video.get("channel_role")
    parsed = parse_title_for_match(title, role=role)

    if not parsed:
        log.info(
            "reconciler_match_not_found",
            video_id=video_id,
            reason="unparseable",
            title=title[:60],
        )
        safe_update(
            "channel_videos",
            {"status": "manual_review", "notes": f"Unparseable: {title[:80]}"},
            "id", video_id,
        )
        return "manual_review"

    content_type = parsed.get("content_type")

    # Standalone content (no match link) — Kameto generic clips, KC funny moments
    if content_type in ("kameto_clip", "funny_moment") and "team_a" not in parsed:
        log.info(
            "reconciler_match_found",
            video_id=video_id,
            kind="standalone",
            content_type=content_type,
        )
        safe_update(
            "channel_videos",
            {
                "status": "matched",
                "video_type": parsed.get("video_type"),
                "content_type": content_type,
                "matched_at": datetime.now(timezone.utc).isoformat(),
                "kc_relevance_score": max(video.get("kc_relevance_score") or 0.0, 0.7),
                "notes": f"Standalone {content_type}",
            },
            "id", video_id,
        )
        return "matched"

    # KC official content WITHOUT a parsed match
    if content_type in ("voicecomms", "debrief", "post_match", "interview") \
            and "team_a" not in parsed:
        log.info(
            "reconciler_match_found",
            video_id=video_id,
            kind="kc_standalone",
            content_type=content_type,
        )
        safe_update(
            "channel_videos",
            {
                "status": "matched",
                "video_type": parsed.get("video_type"),
                "content_type": content_type,
                "matched_at": datetime.now(timezone.utc).isoformat(),
                "kc_relevance_score": max(video.get("kc_relevance_score") or 0.0, 0.7),
                "notes": f"Standalone {content_type}",
            },
            "id", video_id,
        )
        return "matched"

    published_at: datetime | None = None
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
            "reconciler_match_not_found",
            video_id=video_id,
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
            "id", video_id,
        )
        return "manual_review"

    if len(candidates) > 1:
        # Closest-by-date wins. published_at preferred, else "now" pivot.
        pivot = published_at
        if pivot is None and parsed.get("year"):
            pivot = datetime(int(parsed["year"]), 6, 30, tzinfo=timezone.utc)
        cand = _pick_closest(candidates, pivot)
        log.info(
            "reconciler_match_ambiguous",
            video_id=video_id,
            count=len(candidates),
            picked=(cand or {}).get("external_id"),
            title=title[:60],
        )
        if cand is None:
            safe_update(
                "channel_videos",
                {
                    "status": "manual_review",
                    "video_type": parsed.get("video_type"),
                    "content_type": content_type,
                    "notes": f"Ambiguous: {len(candidates)} candidates, none datable",
                },
                "id", video_id,
            )
            return "manual_review"
    else:
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
            "kc_relevance_score": max(video.get("kc_relevance_score") or 0.0, 0.7),
        },
        "id", video_id,
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
                    "video_id": video_id,
                    "channel_id": video.get("channel_id"),
                    "content_type": content_type,
                    "title": title[:500],
                    "url": f"https://www.youtube.com/watch?v={video_id}",
                    "published_at": video.get("published_at"),
                },
                on_conflict="match_external_id,video_id",
            )
        except Exception as e:
            log.warn("context_video_insert_failed", error=str(e)[:100])

    log.info(
        "reconciler_match_found",
        video_id=video_id,
        match_ext_id=cand["external_id"],
        game_n=parsed.get("game_n"),
        content_type=content_type,
    )
    return "matched"


# ─── Daemon loop ──────────────────────────────────────────────────────

# Statuses we consider as candidates for re-reconciliation. The original
# v2 only looked at 'classified' rows, but most discoverer rows actually
# end up in 'discovered' (when classification missed) or 'manual_review'
# (when kc_relevance < 0.7) — see PR25.
RECONCILE_STATUSES = ("discovered", "classified", "manual_review")


@run_logged()
async def run() -> int:
    """Reconcile pending channel_videos rows. Returns matched count."""
    log.info("channel_reconciler_v3_start")

    db = get_db()
    if not db:
        log.warn("channel_reconciler_no_db")
        return 0

    # `in.(...)` lets us pull all 3 statuses in one round-trip. Skip rows
    # that already have a match link (idempotent re-run safe).
    params: list[tuple[str, str]] = [
        ("select", "id,channel_id,title,published_at,kc_relevance_score,channels!inner(role)"),
        ("status", f"in.({','.join(RECONCILE_STATUSES)})"),
        ("matched_match_external_id", "is.null"),
        ("order", "created_at.desc"),
        ("limit", "200"),
    ]
    r = httpx.get(
        f"{db.base}/channel_videos",
        headers=db.headers,
        params=params,
        timeout=20.0,
    )
    if r.status_code != 200:
        log.warn(
            "reconciler_fetch_failed",
            status=r.status_code,
            body=r.text[:200],
        )
        return 0

    rows = r.json() or []
    if not rows:
        log.info("channel_reconciler_no_pending")
        return 0

    for row in rows:
        ch = row.pop("channels", None) or {}
        row["channel_role"] = ch.get("role")

    matched_count = 0
    not_found_count = 0
    for row in rows:
        try:
            new_status = await reconcile_one(db, row)
            if new_status == "matched":
                matched_count += 1
            else:
                not_found_count += 1
        except Exception as e:
            log.error(
                "reconcile_error",
                video_id=row.get("id"),
                error=str(e)[:200],
            )

    log.info(
        "channel_reconciler_v3_done",
        processed=len(rows),
        matched=matched_count,
        not_matched=not_found_count,
    )
    return matched_count
