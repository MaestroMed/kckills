"""
ANALYZER — Gemini 2.5 Flash-Lite analyzes clip content.

For each clipped kill:
- highlight_score (1-10)
- tags (max 5 from predefined list)
- description_fr (max 120 chars, commentateur style)
- kill_visible (bool)
- caster_hype_level (1-5)
"""

import json
import structlog
from scheduler import scheduler
from config import config

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
    """Analyze a kill with Gemini. Returns parsed JSON or None."""
    if not config.GEMINI_API_KEY:
        log.warn("gemini_no_api_key")
        return None

    can_call = await scheduler.wait_for("gemini")
    if not can_call:
        log.warn("gemini_quota_exceeded")
        return None

    prompt = ANALYSIS_PROMPT.format(
        killer_champion=killer_champion,
        killer_name=killer_name,
        victim_champion=victim_champion,
        victim_name=victim_name,
        context=context,
    )

    try:
        import google.generativeai as genai
        genai.configure(api_key=config.GEMINI_API_KEY)
        model = genai.GenerativeModel("gemini-2.5-flash-lite")

        if clip_path:
            # Video input
            video_file = genai.upload_file(clip_path)
            response = model.generate_content([prompt, video_file])
        else:
            # Text-only analysis (no clip available)
            response = model.generate_content(prompt)

        text = response.text.strip()
        # Extract JSON from response
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        result = json.loads(text)
        log.info("gemini_analysis_done", score=result.get("highlight_score"))
        return result

    except ImportError:
        log.warn("gemini_sdk_not_installed")
        return None
    except json.JSONDecodeError:
        log.warn("gemini_invalid_json")
        return None
    except Exception as e:
        log.error("gemini_error", error=str(e))
        return None


async def analyze_kill_text_only(
    killer_name: str,
    killer_champion: str,
    victim_name: str,
    victim_champion: str,
    is_first_blood: bool,
    multi_kill: str | None,
    kc_involvement: str,
    match_stage: str,
) -> dict | None:
    """Simplified text-only analysis (no video needed)."""
    parts = []
    if is_first_blood:
        parts.append("First Blood")
    if multi_kill:
        parts.append(f"{multi_kill.capitalize()} Kill")
    if kc_involvement == "team_killer":
        parts.append("KC gets the kill")
    elif kc_involvement == "team_victim":
        parts.append("KC player eliminated")
    parts.append(f"Stage: {match_stage}")

    return await analyze_kill(
        killer_name=killer_name,
        killer_champion=killer_champion,
        victim_name=victim_name,
        victim_champion=victim_champion,
        context=", ".join(parts),
    )
