"""
ANALYZER — Gemini 2.5 Flash-Lite analyses clip content.

For each clipped kill:
- highlight_score (1.0–10.0)
- tags (max 5 from predefined list)
- description_fr (max 120 chars, commentateur style)
- kill_visible (bool)
- caster_hype_level (1–5)

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


ANALYSIS_PROMPT = """<role>Analyste esport LoL specialise highlights.</role>
<task>Analyse ce kill de match pro LoL. Le killer {killer_champion} ({killer_name}) a elimine {victim_champion} ({victim_name}).
Context: {context}
Reponds UNIQUEMENT en JSON valide.</task>
<output_format>
{{
    "highlight_score": <float 1.0-10.0>,
    "tags": [<max 5 parmi: "outplay","teamfight","solo_kill","tower_dive",
              "baron_fight","dragon_fight","flash_predict","1v2","1v3",
              "clutch","clean","mechanical","shutdown","comeback",
              "engage","peel","snipe","steal">],
    "description_fr": "<max 120 chars, style commentateur hype>",
    "kill_visible_on_screen": true,
    "caster_hype_level": <int 1-5>
}}
</output_format>
<rules>
- 1-3=routine, 4-6=interessant, 7-8=tres bon, 9-10=exceptionnel
- description_fr: percutante, titre de clip viral
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


async def analyze_kill_row(kill: dict) -> dict | None:
    """Build context from a DB kill row and call analyze_kill."""
    parts: list[str] = []
    if kill.get("is_first_blood"):
        parts.append("First Blood")
    if kill.get("multi_kill"):
        parts.append(f"{str(kill['multi_kill']).capitalize()} Kill")
    involvement = kill.get("tracked_team_involvement") or ""
    if involvement == "team_killer":
        parts.append("KC scores the kill")
    elif involvement == "team_victim":
        parts.append("KC player eliminated")

    return await analyze_kill(
        killer_name=kill.get("killer_name") or "KC player",
        killer_champion=kill.get("killer_champion") or "?",
        victim_name=kill.get("victim_name") or "opponent",
        victim_champion=kill.get("victim_champion") or "?",
        context=", ".join(parts),
    )


# ─── Daemon loop ────────────────────────────────────────────────────────────

async def run() -> int:
    """Find kills in status='clipped' and run Gemini analysis."""
    log.info("analyzer_scan_start")

    kills = safe_select(
        "kills",
        "id, killer_champion, victim_champion, is_first_blood, multi_kill, tracked_team_involvement",
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

        patch = {
            "highlight_score": _safe_float(result.get("highlight_score")),
            "ai_tags": result.get("tags") or [],
            "ai_description": result.get("description_fr"),
            "kill_visible": bool(result.get("kill_visible_on_screen", True)),
            "caster_hype_level": _safe_int(result.get("caster_hype_level")),
            "status": "analyzed",
        }
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
