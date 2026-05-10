"""
CHANNEL_RECONCILER v4 — Match channel_videos rows to (match, game, content_type).

V1 covered LEC 2024+ via @LEC's standardised "TEAMA vs TEAMB | HIGHLIGHTS"
title format. V2 extended coverage to LFL / EUM / Worlds / First Stand /
Kameto Clips / KC official channel content_types.

V3 (PR25, Wave 2 commit 0d15cb0) widened the input set, swapped to ±7d
windows, and switched to set-equal team matching.

V4 (PR-arch P3, Wave 8) adds a CLASSIFY-AND-SKIP fast path BEFORE the
expensive parser runs, so we stop spamming `unparseable` warnings on
the 50+ "Karmine Life #N" videos per cycle. The classifier returns one
of eight kinds :

  - "match"      : full game VOD or live broadcast
  - "highlight"  : recap / "best of" of a single game
  - "vlog"       : "Karmine Life #N", behind-the-scenes
  - "reveal"     : ANNONCE / REVEAL / ROSTER / MAILLOT / BUNDLE
  - "reaction"   : REACT / "Kameto réagit"
  - "interview"  : interview / 1ère interview
  - "drama"      : drame / explique / raconte / déclaration
  - "irrelevant" : no signal — fall through to the existing parser

Pre-filter behaviour :
  - {vlog, reveal, reaction, interview, drama}  -> log INFO + status
    'skipped_<kind>' (no parser, no warn, no log spam, idempotent).
  - {match, highlight}  -> proceed to parse_title_for_match.
  - irrelevant  -> behave like v3 (parser will likely return None and
    the row lands in 'manual_review').

V4 also adds :
  - Per-channel kinds breakdown logged at end of each cycle.
  - `_fuzzy_match_recent_kc()` fallback — for vague titles like
    "Karmine Corp Highlights" with no opponent, tries to pin down a
    unique recent (last 7d) KC match.
  - Better Game-N parsing (no week/day required).
  - Hard reject of non-LoL KC content (Valorant, Rocket League, etc.).

Backward-compat : v1 LEC_HIGHLIGHTS_RE / LIVE_GAME_RE preserved unchanged.
The v3 RECONCILE_STATUSES tuple is preserved. All v3 helpers
(`parse_title_for_match`, `find_match_candidates`, `_pick_closest`,
`reconcile_one`) keep their public signatures.
"""

from __future__ import annotations

import asyncio
import re
from collections import Counter
from datetime import datetime, timezone, timedelta
from typing import Literal, Optional

import httpx
import structlog

from services import team_config
from services.observability import note, run_logged
from services.supabase_client import get_db, safe_select, safe_update, safe_upsert

log = structlog.get_logger()


# ─── Video-kind classifier (v4) ───────────────────────────────────────

VideoKind = Literal[
    "match", "highlight", "vlog", "reveal", "reaction",
    "interview", "drama", "irrelevant",
]

# Order matters : MOST-SPECIFIC first. We want "Karmine Life #45 | INTERVIEW"
# to classify as "vlog", not "interview", because the leading tag wins.

# Vlogs — Karmine Life series, behind the scenes
_VLOG_RE = re.compile(
    r"\b("
    r"karmine\s*life|karminelife|"
    r"behind[\s\-]+the[\s\-]+scenes|"
    r"vlog|"
    r"daily\s*kc|"
    r"jour(?:n[ée]e?)?\s+(?:type|avec|chez)\s+kc|"
    r"on\s+a\s+suivi|"
    r"24h?\s*avec|"
    r"dans\s+les\s+coulisses"
    r")\b",
    re.IGNORECASE,
)

# Reveals — roster announcements, jersey drops, bundle launches
_REVEAL_RE = re.compile(
    r"\b("
    r"annonce|"
    r"reveal|"
    r"roster\s*(?:reveal|announce|annonce)?|"
    r"new\s*(?:roster|joueur|signing)|"
    r"signing|"
    r"maillot|jersey|"
    r"bundle|merch(?:andise)?|"
    r"collection|drop|"
    r"presentation|pr[ée]sentation\s+(?:du|de\s+la|des)\s+(?:roster|maillot|joueur)"
    r")\b",
    re.IGNORECASE,
)

# Reactions — REACT / Kameto réagit / "réaction de"
_REACTION_RE = re.compile(
    r"\b("
    r"react(?:ion)?|"
    r"r[ée]ag(?:it|issons|issent)|"
    r"watch[\s\-]*party|"
    r"kameto\s+r[ée]agit|"
    r"on\s+r[ée]agit\s+[àa]"
    r")\b",
    re.IGNORECASE,
)

# Interviews — pure interview content (NOT post-match, which is its own thing)
_INTERVIEW_RE = re.compile(
    r"\b("
    r"interview|itw|"
    r"1[èe]re\s+interview|"
    r"(?:premi[èe]re|first)\s+interview|"
    r"(?:exclusif|exclusive)\s+interview|"
    r"press[\s\-]*conference|"
    r"conf[ée]rence\s+de\s+presse|"
    r"face[\s\-]+[àa][\s\-]+face|"
    r"questions[\s/]+r[ée]ponses|q\s*&\s*a"
    r")\b",
    re.IGNORECASE,
)

# Drama / news — "drame", "explique", "raconte", "déclaration"
_DRAMA_RE = re.compile(
    r"\b("
    r"drame|"
    r"explique\s+(?:tout|pourquoi|sa|son|le|la)|"
    r"raconte\s+(?:tout|pourquoi|sa|son|le|la|comment)|"
    r"d[ée]claration|"
    r"clash|polemique|pol[ée]mique|"
    r"r[ée]ponse\s+[àa]|"
    r"on\s+vous\s+dit\s+tout"
    r")\b",
    re.IGNORECASE,
)

# Highlights — short recap / best-of / "TOP X plays"
_HIGHLIGHT_RE = re.compile(
    r"\b("
    r"highlights?|"
    r"recap|"
    r"best\s+of|"
    r"top\s+\d+\s+(?:plays?|moments?|kills?)|"
    r"r[ée]sum[ée]"
    r")\b",
    re.IGNORECASE,
)

# Match VODs — explicit "Game N" / "BO[1-9]" / "vs/vs." between team codes.
# We require BOTH a `vs` clause AND either Game/BO marker OR a tournament
# tag, otherwise it's almost always a marketing video.
_MATCH_VS_RE = re.compile(
    r"\b[A-Z0-9.]{2,8}\s*v(?:s\.?|\.)?\s*[A-Z0-9.]{2,8}\b",
    re.IGNORECASE,
)
_MATCH_GAME_BO_RE = re.compile(
    r"\b("
    r"game\s*[1-9]|"
    r"bo[1-9]|"
    r"best[\s\-]*of[\s\-]*[1-9]|"
    r"week\s*\d+|semaine\s*\d+|"
    r"playoff|finale?|grand[\s\-]*final|demi[\s\-]*finale?|quart"
    r")\b",
    re.IGNORECASE,
)
_LEAGUE_TAG_RE = re.compile(
    r"\b("
    r"#?lec|#?lfl|#?eum|#?lcs|#?lck|#?lpl|#?msi|"
    r"worlds?|world\s*championship|"
    r"first\s*stand|emea\s*masters?|eu\s*masters?"
    r")\b",
    re.IGNORECASE,
)

# Hard reject : KC operates teams in Valorant, Rocket League, Apex, TFT,
# Fortnite, Trackmania, etc. None of them belong on a LoL-only platform.
_NON_LOL_RE = re.compile(
    r"\b("
    r"valorant|val\s*game\s*changers|vct|"
    r"rocket[\s\-]*league|rlcs|"
    r"apex(?:\s*legends?)?|als|"
    r"tft|teamfight[\s\-]*tactics|"
    r"fortnite|fncs|"
    r"trackmania|tm|"
    r"counter[\s\-]*strike|cs2|csgo|"
    r"street[\s\-]*fighter|sf6|"
    r"smash(?:\s*bros?)?"
    r")\b",
    re.IGNORECASE,
)


def _classify_video_kind(title: str) -> VideoKind:
    """Classify a YouTube video title into one of 8 buckets.

    Used as a fast pre-filter so we don't waste cycles on Karmine Life
    vlogs / reveals / reactions / interviews / drama videos that will
    NEVER be linkable to a LEC match.

    Order of checks is most-specific first :

      1. Non-LoL games (Valorant, RL, Apex…)  -> "irrelevant"
         (so the existing parser can mark them manual_review and the
         operator sees them, but they don't waste a fuzzy lookup).
      2. Vlog (Karmine Life / behind the scenes)  -> "vlog"
      3. Reveal (annonce / roster / maillot / bundle)  -> "reveal"
      4. Reaction (react / kameto réagit)  -> "reaction"
      5. Interview (interview / itw / press conference)  -> "interview"
      6. Drama (drame / explique / raconte / déclaration)  -> "drama"
      7. Match (vs/vs. + Game N / BO / tournament tag)  -> "match"
      8. Highlight (HIGHLIGHTS / recap / best of / TOP X)  -> "highlight"
      9. Else  -> "irrelevant"
    """
    if not title:
        return "irrelevant"

    lower = title.lower()

    # 1. Non-LoL — always wins, even if title contains "vs" or "highlights".
    if _NON_LOL_RE.search(lower):
        return "irrelevant"

    # 2-6. Lifestyle / marketing / news content (ordered by typical KC channel
    # frequency : vlogs are by far the most spammy bucket on Kameto Karmine).
    if _VLOG_RE.search(lower):
        return "vlog"
    if _REVEAL_RE.search(lower):
        return "reveal"
    if _REACTION_RE.search(lower):
        return "reaction"
    if _INTERVIEW_RE.search(lower):
        return "interview"
    if _DRAMA_RE.search(lower):
        return "drama"

    # 7. Match VOD : requires a vs/vs. clause AND (Game N / BO / week / tournament).
    has_vs = bool(_MATCH_VS_RE.search(title))
    has_game_marker = bool(_MATCH_GAME_BO_RE.search(lower))
    has_league_tag = bool(_LEAGUE_TAG_RE.search(lower))
    if has_vs and (has_game_marker or has_league_tag):
        # If title ALSO mentions HIGHLIGHTS / RECAP it's a highlight, not
        # a full game VOD — but for prefilter purposes both lead to the
        # parser, so the distinction is informational only.
        if _HIGHLIGHT_RE.search(lower):
            return "highlight"
        return "match"

    # 8. Highlight without a clear vs clause (KC retrospectives etc.)
    if _HIGHLIGHT_RE.search(lower):
        return "highlight"

    # 9. Default fallback : let v3 parser have a go.
    return "irrelevant"


# Kinds that are pre-filtered out (skipped before the parser runs).
SKIP_KINDS: frozenset[VideoKind] = frozenset({
    "vlog", "reveal", "reaction", "interview", "drama",
})

# Kinds that are forwarded to the title parser.
PARSE_KINDS: frozenset[VideoKind] = frozenset({"match", "highlight"})


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

# LEC with explicit "| LEC | Game N" tail (v4) — captures titles like
# "KC vs. KOI | LEC | Game 2" that the v1 LIVE_GAME_RE misses because
# of the pipe separators.
LEC_PIPED_GAME_RE = re.compile(
    r"^([A-Z0-9.]{2,8})\s*vs\.?\s*([A-Z0-9.]{2,8})\s*"
    r"\|\s*(?:#?LEC|#?LFL|#?EUM|#?LCS|#?LCK|#?MSI|#?Worlds?)\s*"
    r"\|\s*Game\s*(\d)",
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

# Wave 27.23 — Karmine Corp Replay channel format
# Examples :
#   "LEC Spring - Karmine Corp vs KOI - Group Stage"
#   "LEC Versus - Karmine Corp vs G2 - Playoffs Finale"
#   "LFL Spring 2022 - Karmine Corp vs Vitality.Bee - Week 5"
#   "Worlds 2025 - Karmine Corp vs T1 - Group A"
#   "Esports World Cup 2026 - Karmine Corp vs SK - Qualifier"
#   "First Stand 2025 - Karmine Corp vs FlyQuest"
#   "KARMINE CORP vs LDLC OL - LFL ... [Game 7]"
#   "Karmine Corp vs Lille Esport (LFL Div2 Summer Split 2025)"
# The format puts "<TIER> - <TEAM_A> vs <TEAM_B>" most of the time, but
# the LFL legacy uploads sometimes lead with "KARMINE CORP vs <TEAM>".
# We match BOTH directions using lookarounds. Team names allowed up to
# 30 chars + spaces (Vitality.Bee, BDS Academy, Lille Esport, etc.).
KC_REPLAY_RE = re.compile(
    # Match "Karmine Corp vs <opponent>" or "<opponent> vs Karmine Corp"
    # (case-insensitive). Captures team_a + team_b regardless of order.
    r"(?:"
    r"(?P<a1>Karmine\s*Corp)\s*v(?:s\.?)?\s+(?P<b1>[A-Za-z0-9.\- ]{2,40}?)"
    r"|"
    r"(?P<a2>[A-Za-z0-9.\- ]{2,40}?)\s+v(?:s\.?)?\s+(?P<b2>Karmine\s*Corp)"
    r")(?=\s*(?:[\-–|(]|$|Game\s|Day\s|Week\s|Round\s|Quart|Half|Semi|Final|Group|Playoff|Stage|Bracket))",
    re.IGNORECASE,
)
KC_REPLAY_GAME_N_RE = re.compile(
    # Require word boundary + 'Game' or 'G ' (with explicit space) to
    # avoid 'g' in 'Spring' or 'G2' team name matching as Game N.
    r"\bGame\s*(\d+)\b|\[Game\s*(\d+)\]",
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
BO_RE = re.compile(r"\bbo([1-9])\b", re.IGNORECASE)
YEAR_RE = re.compile(r"\b(20[2-3]\d)\b")


# ─── Team-code aliases ────────────────────────────────────────────────
# Keys are normalised (no dot/space/dash, uppercase). Values are the
# canonical 2-4 letter codes stored in the `teams.code` column.
#
# PR-loltok BA : this dict is now SEEDED with manual entries (legacy LFL
# clutter that pre-dates the catalog) and EXTENDED at startup with
# whatever services/team_config.all_aliases() returns. Tracking a new
# team via teams.json automatically gets its aliases registered here too.
#
# The legacy entries are kept as a backstop because (a) they cover
# defunct teams (Astralis, Excel) we don't want to redocument in
# teams.json, and (b) they preserve byte-identical normalisation
# behaviour for the EtoStark demo.
_LEGACY_TEAM_ALIAS: dict[str, str] = {
    # ─── Karmine Corp variants ────────────────────────────────────
    "KARMINE": "KC", "KCORP": "KC", "KARMINECORP": "KC",
    "KCB": "KCB", "KARMINEB": "KCB",
    # ─── LEC current/recent teams ─────────────────────────────────
    "G2ESPORTS": "G2",
    "FNATIC": "FNC",
    "FNCR": "FNCR", "FNATICRISING": "FNCR",
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
    # ─── LFL teams (Wave 27.25) ────────────────────────────────────
    # KC Replay videos use full team names ; we normalise to whatever
    # the gol_gg backfill stored in `teams.code`. Verified against
    # actual DB rows on 2026-05-10.
    "VITB": "VIT", "VITALITYBEE": "VIT", "BEE": "VIT",
    "BDSA": "TBA", "BDSACADEMY": "TBA",
    "MISFITSP": "MSFP", "MISFITSPREMIER": "MSFP",
    "GW": "GAM", "GAMEWARD": "GAM", "GMW": "GAM",
    "LDLCOL": "LO", "LDL": "LO", "LDLC": "LO",
    "MCES": "MCE",
    "BKR": "BKROG", "BK": "BKROG", "BKROG": "BKROG", "BKROGESPORTS": "BKROG",
    "SOLARY": "SOL", "SLY": "SOL",
    "AEGIS": "AEG",
    "IZIDREAM": "ID", "IZIDR": "ID", "IZI": "ID",
    "TEAMGO": "TG", "GO": "TG",
    "GAMERSORIGIN": "GO",
    "MACKO": "ME", "MACKOESPORTS": "ME",
    "TEAMOPLON": "TO", "OPLON": "TO",
    "TEAMMCES": "MCE",
    "OTPLOL": "OPL",
    # ─── LEC Versus 2026 + recent additions (Wave 27.25) ──────────
    "LOSRATONES": "LR", "RATONES": "LR",
    "SHIFTERS": "SHFT", "SHFT": "SHFT", "SHI": "SHFT",
    "LILLEESPORT": "LE", "LILLE": "LE",
    "GALIONS": "GAL",
    "M8": "M8", "MAINEIGHT": "M8", "MAIN8": "M8",
    "FUT": "FUT",
    "BBL": "BBL", "BBLESPORTS": "BBL",
    "TEAMLIQUID": "TL",
    "ICIJAPON": "IJ",
}


def _build_team_alias() -> dict[str, str]:
    """Merge legacy hardcoded aliases with the team_config catalog.

    Catalog entries WIN on collision so that an explicit alias in
    teams.json (added by the operator at runtime) overrides a stale
    hardcoded one. The keys are already normalised in both sources
    (uppercase, no separators).
    """
    merged = dict(_LEGACY_TEAM_ALIAS)
    try:
        catalog_aliases = team_config.all_aliases()
        # Normalise the catalog keys with the same regex used at lookup
        # time so the comparison is consistent (catalog stores
        # "KARMINE CORP" but reconciler sees "KARMINECORP").
        for raw_alias, code in catalog_aliases.items():
            cleaned = re.sub(r"[\s.\-]", "", raw_alias).upper()
            if cleaned and code:
                merged[cleaned] = code
    except Exception:
        # Defensive — never let a teams.json typo break reconciliation.
        # Falls back to the legacy hardcoded dict.
        pass
    return merged


# Built once at import. Restart the worker after editing teams.json.
TEAM_ALIAS: dict[str, str] = _build_team_alias()


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

    # Wave 27.23 — Karmine Corp Replay channel format. Highest-priority
    # parser since this is the unique source post-pivot. Format always
    # contains "Karmine Corp" — regex captures the opponent + handles
    # both orderings (KC vs X / X vs KC).
    m = KC_REPLAY_RE.search(title)
    if m:
        # Determine which capture group has the actual opponent
        if m.group("a1") and m.group("b1"):
            kc_token, opp_token = m.group("a1"), m.group("b1")
        else:
            kc_token, opp_token = m.group("b2"), m.group("a2")
        # Normalise — "KC" canonical for the KC side
        team_kc = "KC"
        team_opp = normalise_team(opp_token.strip()) if opp_token else None
        if team_opp and team_opp not in NON_TEAM_TOKENS and len(team_opp) >= 2:
            out["team_a"] = team_kc
            out["team_b"] = team_opp
            # League detection from the rest of the title
            tlow = title.lower()
            if "lec versus" in tlow:
                out["league"] = "lec"
            elif "lec" in tlow:
                out["league"] = "lec"
            elif "lfl" in tlow:
                out["league"] = "lfl"
            elif "eu masters" in tlow or "eum" in tlow or "european masters" in tlow:
                out["league"] = "eum"
            elif "worlds" in tlow or "world championship" in tlow:
                out["league"] = "worlds"
            elif "esports world cup" in tlow or "ewc" in tlow:
                out["league"] = "ewc"
            elif "msi" in tlow:
                out["league"] = "msi"
            elif "first stand" in tlow:
                out["league"] = "first_stand"
            else:
                out["league"] = "unknown"
            # Game number if present
            mg = KC_REPLAY_GAME_N_RE.search(title)
            if mg:
                try:
                    out["game_n"] = int(mg.group(1) or mg.group(2))
                except (ValueError, TypeError):
                    pass
            out["video_type"] = "single_game"
            out["content_type"] = "single_game"

    # LEC piped Game-N (v4 — "KC vs. KOI | LEC | Game 2")
    if not out:
        m = LEC_PIPED_GAME_RE.search(title)
        if m:
            a, b = normalise_team(m.group(1)), normalise_team(m.group(2))
            if a not in NON_TEAM_TOKENS and b not in NON_TEAM_TOKENS:
                out["team_a"] = a
                out["team_b"] = b
                out["game_n"] = int(m.group(3))
                out["league"] = "lec"
                out["video_type"] = "single_game"
                out["content_type"] = "single_game"

    # LEC (v1 backward-compat first)
    if not out:
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

    m = BO_RE.search(title)
    if m and "bo" not in out:
        out["bo"] = int(m.group(1))

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

async def _matches_in_window(
    db,
    *,
    window_start: str | None,
    window_end: str | None,
) -> list[dict]:
    """Fetch matches in an optional time window, embedded with team codes.

    Wave 27.5 — converted to async + asyncio.to_thread. The sync
    ``httpx.get`` call used to block the event loop for 100-500ms per
    invocation while the reconciler waited on a PostgREST round-trip ;
    that froze sentinel polling, livestats ingest, and clip processing
    every time the reconciler hit a video. Offloading to a thread lets
    the event loop keep firing while the network call is in flight.
    """
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
    # Wave 27.25 — gol_gg-imported matches have scheduled_at=NULL (the
    # legacy backfill never populated it). PostgREST filters drop NULL
    # values from comparison queries, so without this guard our LFL
    # 2021-2023 + First Stand 2025 + EWC 2025 matches were invisible
    # to the reconciler. Use `or=(scheduled_at.gte.X,scheduled_at.is.null)`
    # so NULL-dated matches are still considered candidates ; the
    # downstream tournament-level year filter (via the `year` hint)
    # handles cross-year disambiguation.
    if window_start and window_end:
        params.append((
            "or",
            f"(and(scheduled_at.gte.{window_start},scheduled_at.lte.{window_end}),"
            f"scheduled_at.is.null)",
        ))
    elif window_start:
        params.append((
            "or",
            f"(scheduled_at.gte.{window_start},scheduled_at.is.null)",
        ))
    elif window_end:
        params.append((
            "or",
            f"(scheduled_at.lte.{window_end},scheduled_at.is.null)",
        ))

    r = await asyncio.to_thread(
        httpx.get,
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

    candidates = await _matches_in_window(
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


# ─── Fuzzy fallback for vague titles (v4) ─────────────────────────────

async def _fuzzy_match_recent_kc(
    db,
    title: str,
    *,
    published_at: datetime | None = None,
    window_days: int = 7,
) -> Optional[str]:
    """Try to rescue vague titles like "Karmine Corp Highlights".

    Strategy : the title says "KC" but no opponent. If there is exactly
    ONE KC match within ±`window_days` of `published_at` (or "now" when
    that's missing), return its external_id. Anything ambiguous returns
    None — the caller will fall through to the existing manual_review
    behaviour.

    We DO NOT re-implement title parsing here — this is purely a
    recency-based disambiguator. The caller is responsible for first
    establishing that the title mentions KC at all.
    """
    if not title:
        return None
    low = title.lower()
    # The title MUST explicitly mention Karmine Corp (otherwise we'd be
    # guessing wildly). We accept the most common spellings.
    if not re.search(r"\b(kc|karmine|karminecorp|karmine\s*corp)\b", low):
        return None

    pivot = published_at or datetime.now(timezone.utc)
    window_start = (pivot - timedelta(days=window_days)).isoformat()
    window_end = (pivot + timedelta(days=window_days)).isoformat()

    candidates = await _matches_in_window(
        db,
        window_start=window_start,
        window_end=window_end,
    )
    kc_only = [
        c for c in candidates
        if {
            (c.get("team_blue") or {}).get("code"),
            (c.get("team_red") or {}).get("code"),
        } & {"KC", "KCB"}
    ]
    if len(kc_only) == 1:
        return kc_only[0].get("external_id")
    # 0 or >1 → ambiguous, give up
    return None


# ─── Reconciliation per row ───────────────────────────────────────────

async def reconcile_one(db, video: dict) -> str:
    """Reconcile a single channel_video row. Returns the new status.

    V4 pre-filter : if the video is classified as vlog/reveal/reaction/
    interview/drama, we mark it `skipped_<kind>` and return early with
    that status. The caller's per-cycle counters use the returned status
    to build the per-channel breakdown.
    """
    video_id = video["id"]
    title = video.get("title") or ""
    role = video.get("channel_role")

    # ─── V4 pre-filter — classify-and-skip ──────────────────────────
    kind = _classify_video_kind(title)
    video["_kind"] = kind  # exposed for the run() aggregator

    if kind in SKIP_KINDS:
        # Don't waste a parser call. Don't pollute logs at warn level.
        # video_id is enough to dedupe ; full title omitted to minimise
        # log noise (the operator can SQL-lookup the title if needed).
        log.info(
            "video_skipped",
            video_id=video_id,
            kind=kind,
        )
        new_status = f"skipped_{kind}"
        safe_update(
            "channel_videos",
            {
                "status": new_status,
                "video_type": kind,
                "content_type": kind,
                "matched_at": datetime.now(timezone.utc).isoformat(),
                "notes": f"V4 pre-filter: {kind}",
            },
            "id", video_id,
        )
        return new_status

    parsed = parse_title_for_match(title, role=role)

    if not parsed:
        # V4 fuzzy fallback — vague KC mentions get one more shot.
        if kind == "highlight":
            ext_id = await _fuzzy_match_recent_kc(
                db, title,
                published_at=_parse_published_at(video.get("published_at")),
            )
            if ext_id:
                log.info(
                    "reconciler_match_found",
                    video_id=video_id,
                    match_ext_id=ext_id,
                    via="fuzzy_recent_kc",
                )
                safe_update(
                    "channel_videos",
                    {
                        "status": "matched",
                        "video_type": "game_highlights",
                        "content_type": "highlights",
                        "matched_match_external_id": ext_id,
                        "matched_at": datetime.now(timezone.utc).isoformat(),
                        "kc_relevance_score": max(
                            video.get("kc_relevance_score") or 0.0, 0.7,
                        ),
                        "notes": "V4 fuzzy fallback (recent KC match)",
                    },
                    "id", video_id,
                )
                return "matched"

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

    published_at = _parse_published_at(video.get("published_at"))

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


def _parse_published_at(raw: str | None) -> datetime | None:
    """Tolerant ISO-8601 parser. Returns None on any failure."""
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None


# ─── Daemon loop ──────────────────────────────────────────────────────

# Statuses we consider as candidates for re-reconciliation. The original
# v2 only looked at 'classified' rows, but most discoverer rows actually
# end up in 'discovered' (when classification missed) or 'manual_review'
# (when kc_relevance < 0.7) — see PR25.
RECONCILE_STATUSES = ("discovered", "classified", "manual_review")


@run_logged()
async def run() -> int:
    """Reconcile pending channel_videos rows. Returns matched count.

    V4 changes :
      - Per-row pre-filter via `_classify_video_kind` → skip vlogs/reveals
        without parsing. Logged at INFO level (not warn) so cycle output
        stays calm.
      - Per-channel kinds breakdown logged at end of cycle and pushed
        into pipeline_runs.metadata via observability.note().
    """
    log.info("channel_reconciler_v4_start")

    db = get_db()
    if not db:
        log.warn("channel_reconciler_no_db")
        return 0

    # `in.(...)` lets us pull all 3 statuses in one round-trip. Skip rows
    # that already have a match link (idempotent re-run safe).
    # V4 also pulls channel display_name so we can group stats per channel.
    params: list[tuple[str, str]] = [
        (
            "select",
            "id,channel_id,title,published_at,kc_relevance_score,"
            "channels!inner(role,display_name)",
        ),
        ("status", f"in.({','.join(RECONCILE_STATUSES)})"),
        ("matched_match_external_id", "is.null"),
        ("order", "created_at.desc"),
        ("limit", "200"),
    ]
    # Wave 27.5 — sync httpx.get offloaded to a thread so the
    # reconciler's main loop doesn't freeze the event loop on the
    # initial 200-row PostgREST fetch.
    r = await asyncio.to_thread(
        httpx.get,
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
        row["channel_name"] = ch.get("display_name") or "(unknown)"

    matched_count = 0
    not_found_count = 0
    skipped_count = 0
    # Per-channel kinds aggregator → {channel_name: {kind: N}}
    per_channel_kinds: dict[str, Counter[str]] = {}
    for row in rows:
        ch_name = row.get("channel_name") or "(unknown)"
        bucket = per_channel_kinds.setdefault(ch_name, Counter())
        try:
            new_status = await reconcile_one(db, row)
            kind = row.get("_kind") or "irrelevant"
            bucket[kind] += 1
            if new_status == "matched":
                matched_count += 1
            elif new_status.startswith("skipped_"):
                skipped_count += 1
            else:
                not_found_count += 1
        except Exception as e:
            log.error(
                "reconcile_error",
                video_id=row.get("id"),
                error=str(e)[:200],
            )
            bucket["error"] += 1

    # Per-channel summary. One log line per channel — operator can spot
    # channels that are 100% vlog and consider deprioritising them.
    for ch_name, kinds in per_channel_kinds.items():
        log.info(
            "channel_reconciler_v4_done",
            channel=ch_name,
            kinds=dict(kinds),
            matched=sum(
                1 for r_ in rows
                if r_.get("channel_name") == ch_name
                and r_.get("_kind") in PARSE_KINDS
            ),
        )

    # Aggregate kinds across all channels for pipeline_runs.metadata.
    total_kinds: Counter[str] = Counter()
    for kinds in per_channel_kinds.values():
        total_kinds.update(kinds)

    note(
        items_scanned=len(rows),
        items_processed=matched_count,
        items_failed=not_found_count,
        items_skipped=skipped_count,
        kinds=dict(total_kinds),
        per_channel={
            ch_name: dict(kinds) for ch_name, kinds in per_channel_kinds.items()
        },
    )

    log.info(
        "channel_reconciler_v4_summary",
        processed=len(rows),
        matched=matched_count,
        not_matched=not_found_count,
        skipped=skipped_count,
        kinds=dict(total_kinds),
    )
    return matched_count
