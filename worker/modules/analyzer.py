"""
ANALYZER — Gemini 2.5 Flash-Lite analyses clip content.

For each clipped kill:
- highlight_score (1.0–10.0)
- tags (max 5 from predefined list)
- description_fr (max 120 chars, commentateur style)
- kill_visible (bool)
- caster_hype_level (1–5)
- Scroll Vivant structured dimensions (for the grid pivot axes):
  lane_phase, fight_type, objective_context, matchup_lane, champion_class,
  game_minute_bucket

Exposes:
- analyze_kill(...) low-level helper (text-only or with a local clip file)
- run() daemon loop that scans kills in status='clipped' and analyses them
"""

from __future__ import annotations

import json
import os
import structlog

from config import config
from scheduler import scheduler
from services.supabase_client import safe_select, safe_update

log = structlog.get_logger()


# ─── Structured dimensions (Scroll Vivant V1 grid axes) ─────────────────────

LANE_PHASES = {"early", "mid", "late"}
FIGHT_TYPES = {
    "solo_kill", "gank", "skirmish_2v2", "skirmish_3v3",
    "teamfight_4v4", "teamfight_5v5", "pick",
}
OBJECTIVE_CONTEXTS = {
    "none", "dragon", "baron", "herald", "atakhan",
    "tower", "inhibitor", "nexus",
}
MATCHUP_LANES = {"top", "jungle", "mid", "bot", "support", "cross_map"}
CHAMPION_CLASSES = {
    "assassin", "bruiser", "mage", "marksman",
    "tank", "enchanter", "skirmisher",
}
MINUTE_BUCKETS = [
    "0-5", "5-10", "10-15", "15-20",
    "20-25", "25-30", "30-35", "35+",
]


def minute_bucket_from_seconds(seconds: int | None) -> str | None:
    """Map a kill's game_time_seconds to its 5-minute bucket label.

    Returns None if seconds is missing — the grid drops cells with null axes.
    """
    if seconds is None or seconds < 0:
        return None
    minute = seconds // 60
    if minute < 5:
        return "0-5"
    if minute < 10:
        return "5-10"
    if minute < 15:
        return "10-15"
    if minute < 20:
        return "15-20"
    if minute < 25:
        return "20-25"
    if minute < 30:
        return "25-30"
    if minute < 35:
        return "30-35"
    return "35+"


def _lane_phase_from_seconds(seconds: int | None) -> str | None:
    """Deterministic early/mid/late phase from game time (<14min / 14-25 / >25)."""
    if seconds is None or seconds < 0:
        return None
    minute = seconds // 60
    if minute < 14:
        return "early"
    if minute <= 25:
        return "mid"
    return "late"


ANALYSIS_PROMPT = """<role>Analyste esport LoL specialise highlights. Tu commentes avec precision factuelle.</role>
<task>Decris ce kill de match pro LoL en 1 phrase percutante ET classe-le sur 6 dimensions structurees.
Killer: {killer_champion} ({killer_name})
Victime: {victim_champion} ({victim_name})
Donnees factuelles: {context}

IMPORTANT: base ta description UNIQUEMENT sur les donnees factuelles ci-dessus.
- Si des assistants sont mentionnes, c'est un fight a plusieurs, PAS un solo kill.
- Ne dis pas "esquive" ou "outplay" si tu n'as pas de preuve factuelle.
- Ne dis pas "solo kill" s'il y a des assistants.
- Garde le style hype commentateur mais reste FACTUEL.
Reponds UNIQUEMENT en JSON valide.</task>
<output_format>
{{
    "highlight_score": <float 1.0-10.0>,
    "tags": [<max 5 parmi: "outplay","teamfight","solo_kill","tower_dive",
              "baron_fight","dragon_fight","flash_predict","1v2","1v3",
              "clutch","clean","mechanical","shutdown","comeback",
              "engage","peel","snipe","steal">],
    "description_fr": "<max 120 chars, style commentateur hype mais FACTUEL>",
    "kill_visible_on_screen": true,
    "caster_hype_level": <int 1-5>,
    "lane_phase": "early"|"mid"|"late",
    "fight_type": "solo_kill"|"gank"|"skirmish_2v2"|"skirmish_3v3"|"teamfight_4v4"|"teamfight_5v5"|"pick",
    "objective_context": "none"|"dragon"|"baron"|"herald"|"atakhan"|"tower"|"inhibitor"|"nexus",
    "matchup_lane": "top"|"jungle"|"mid"|"bot"|"support"|"cross_map",
    "champion_class": "assassin"|"bruiser"|"mage"|"marksman"|"tank"|"enchanter"|"skirmisher",
    "game_minute_bucket": "0-5"|"5-10"|"10-15"|"15-20"|"20-25"|"25-30"|"30-35"|"35+"
}}
</output_format>
<rules>
- 1-3=routine, 4-6=interessant, 7-8=tres bon, 9-10=exceptionnel
- description_fr: percutante mais FACTUELLE — pas d'invention
- Si assistants present: mentionne-les dans la description (ex: "avec l'assist de Xin Zhao")
- fight_type: regarde le nombre de champions visibles dans les 3s avant le kill. 1v1 isole = solo_kill. 2 allies + 1 ennemi isole = gank. Plus de 3 par camp = teamfight.
- objective_context: "none" SAUF si un objectif neutre (drake/nashor/herald/atakhan) ou une tour/inhib/nexus est contestee/prise dans les 5s autour du kill
- matchup_lane: la lane d'appartenance de la victime (top/jungle/mid/bot/support) OU "cross_map" si les 2 joueurs sont de lanes differentes
- champion_class: classe du KILLER (pas de la victime)
- TOUS les 6 champs structures sont OBLIGATOIRES — ne mets jamais null
- JSON VALIDE uniquement, pas de texte avant/apres
</rules>"""


async def analyze_kill(
    killer_name: str,
    killer_champion: str,
    victim_name: str,
    victim_champion: str,
    context: str = "",
    clip_path: str | None = None,
) -> dict | None:
    """Analyze a kill with Gemini. Returns parsed JSON dict or None."""
    if not config.GEMINI_API_KEY:
        log.warn("gemini_no_api_key")
        return None

    can_call = await scheduler.wait_for("gemini")
    if not can_call:
        log.warn("gemini_quota_exceeded")
        return None

    prompt = ANALYSIS_PROMPT.format(
        killer_champion=killer_champion or "?",
        killer_name=killer_name or "?",
        victim_champion=victim_champion or "?",
        victim_name=victim_name or "?",
        context=context or "",
    )

    try:
        import google.generativeai as genai  # type: ignore
    except ImportError:
        log.warn("gemini_sdk_not_installed")
        return None

    try:
        genai.configure(api_key=config.GEMINI_API_KEY)
        model = genai.GenerativeModel("gemini-2.5-flash-lite")

        if clip_path and os.path.exists(clip_path):
            video_file = genai.upload_file(clip_path)
            # Wait for file to become ACTIVE before querying
            from services.gemini_client import _wait_for_file_active
            if not _wait_for_file_active(genai, video_file):
                log.warn("gemini_file_not_active", clip=clip_path)
                # Fall back to text-only analysis
                response = model.generate_content(prompt)
            else:
                response = model.generate_content([prompt, video_file])
        else:
            response = model.generate_content(prompt)

        text = (response.text or "").strip()
        text = _strip_code_fence(text)
        result = json.loads(text)
        log.info("gemini_analysis_done", score=result.get("highlight_score"))
        return result
    except json.JSONDecodeError:
        log.warn("gemini_invalid_json", text=text[:200] if text else "")
        return None
    except Exception as e:
        log.error("gemini_error", error=str(e))
        return None


def _strip_code_fence(text: str) -> str:
    """Gemini sometimes wraps JSON in ```json ... ``` fences — unwrap them."""
    if text.startswith("```"):
        # Take everything after the first fence
        parts = text.split("```")
        if len(parts) >= 2:
            inner = parts[1]
            if inner.startswith("json"):
                inner = inner[4:]
            return inner.strip()
    return text


async def analyze_kill_row(kill: dict, clip_path: str | None = None) -> dict | None:
    """Build rich factual context from a DB kill row and call analyze_kill."""
    parts: list[str] = []

    # Kill type
    if kill.get("is_first_blood"):
        parts.append("FIRST BLOOD")
    if kill.get("multi_kill"):
        parts.append(f"{str(kill['multi_kill']).upper()} KILL")

    # KC involvement
    involvement = kill.get("tracked_team_involvement") or ""
    if involvement == "team_killer":
        parts.append("KC scores the kill")
    elif involvement == "team_victim":
        parts.append("KC player eliminated")

    # Assistants — critical for factual accuracy
    assistants = kill.get("assistants") or []
    if isinstance(assistants, list) and len(assistants) > 0:
        assist_names = [
            a.get("champion") or a.get("name") or "?"
            for a in assistants
            if isinstance(a, dict)
        ]
        if assist_names:
            parts.append(f"Assistants: {', '.join(assist_names)} ({len(assist_names)} assist(s) = PAS un solo kill)")
        else:
            parts.append(f"{len(assistants)} assistant(s) = PAS un solo kill")
    else:
        parts.append("ZERO assist = vrai solo kill")

    # Shutdown bounty
    bounty = kill.get("shutdown_bounty") or 0
    if bounty >= 400:
        parts.append(f"Shutdown bounty: {bounty}g")

    # Confidence as proxy for fight type
    confidence = kill.get("confidence") or "high"
    if confidence == "medium":
        parts.append("Confidence medium = probablement un teamfight ou skirmish, PAS un solo")
    elif confidence == "high" and not (isinstance(assistants, list) and len(assistants) > 0):
        parts.append("Confidence high + zero assists = 1v1 propre")

    return await analyze_kill(
        killer_name=kill.get("_killer_name_hint") or kill.get("killer_name") or "KC player",
        killer_champion=kill.get("killer_champion") or "?",
        victim_name=kill.get("_victim_name_hint") or kill.get("victim_name") or "opponent",
        victim_champion=kill.get("victim_champion") or "?",
        context=". ".join(parts),
        clip_path=clip_path,
    )


# ─── Daemon loop ────────────────────────────────────────────────────────────

async def run() -> int:
    """Find kills in status='clipped' and run Gemini analysis."""
    log.info("analyzer_scan_start")

    kills = safe_select(
        "kills",
        "id, killer_champion, victim_champion, is_first_blood, multi_kill, "
        "tracked_team_involvement, game_time_seconds, assistants, confidence",
        status="clipped",
    )
    if not kills:
        return 0

    analysed = 0
    for kill in kills:
        remaining = scheduler.get_remaining("gemini")
        if remaining is not None and remaining <= 0:
            log.warn("analyzer_daily_quota_reached")
            break

        result = await analyze_kill_row(kill)
        if not result:
            continue

        patch = _build_analysis_patch(result, kill)
        safe_update("kills", patch, "id", kill["id"])
        analysed += 1

    log.info("analyzer_scan_done", analysed=analysed)
    return analysed


def _safe_float(v) -> float | None:
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def _safe_int(v) -> int | None:
    try:
        return int(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def _enum_or_none(value, allowed: set[str]) -> str | None:
    """Accept the Gemini value only if it belongs to the allowed enum set.

    Rejecting unknown values keeps the grid axes well-formed and makes hallucination
    visible in the logs instead of corrupting the DB.
    """
    if not isinstance(value, str):
        return None
    v = value.strip().lower()
    return v if v in allowed else None


def _build_analysis_patch(result: dict, kill: dict) -> dict:
    """Combine Gemini output with deterministic fallbacks before persisting.

    game_minute_bucket and lane_phase are derived server-side from
    game_time_seconds when Gemini disagrees or omits — the livestats frame
    timestamp is ground truth.
    """
    seconds = kill.get("game_time_seconds")
    deterministic_bucket = minute_bucket_from_seconds(seconds)
    deterministic_phase = _lane_phase_from_seconds(seconds)

    gemini_bucket = _enum_or_none(result.get("game_minute_bucket"), set(MINUTE_BUCKETS))
    gemini_phase = _enum_or_none(result.get("lane_phase"), LANE_PHASES)

    return {
        "highlight_score": _safe_float(result.get("highlight_score")),
        "ai_tags": result.get("tags") or [],
        "ai_description": result.get("description_fr"),
        "kill_visible": bool(result.get("kill_visible_on_screen", True)),
        "caster_hype_level": _safe_int(result.get("caster_hype_level")),
        "lane_phase": deterministic_phase or gemini_phase,
        "fight_type": _enum_or_none(result.get("fight_type"), FIGHT_TYPES),
        "objective_context": _enum_or_none(
            result.get("objective_context"), OBJECTIVE_CONTEXTS
        ) or "none",
        "matchup_lane": _enum_or_none(result.get("matchup_lane"), MATCHUP_LANES),
        "champion_class": _enum_or_none(result.get("champion_class"), CHAMPION_CLASSES),
        "game_minute_bucket": deterministic_bucket or gemini_bucket,
        "status": "analyzed",
    }
