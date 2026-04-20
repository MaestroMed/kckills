"""
Re-analyze published kills that have no AI description.

Runs Gemini text-only analysis on each kill to fill in:
- ai_description (French hyped caster style)
- ai_tags (up to 5 tags)
- highlight_score (blended: 40% structured + 60% Gemini)

Uses text-only mode (no video upload) to stay within free tier.
Respects the scheduler rate limit (4s between Gemini calls).
"""

import asyncio
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

from scheduler import scheduler
from modules import analyzer
from models.kill_event import compute_hype_score
from services.supabase_client import safe_select, safe_update

import structlog
structlog.configure(
    processors=[
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.add_log_level,
        structlog.dev.ConsoleRenderer(),
    ]
)
log = structlog.get_logger()


async def main():
    kills = safe_select(
        "kills",
        "id, killer_champion, victim_champion, is_first_blood, multi_kill, "
        "tracked_team_involvement, highlight_score, confidence, assistants, "
        "ai_description, shutdown_bounty, game_time_seconds",
        status="published",
    )

    no_desc = [k for k in kills if not k.get("ai_description")]
    print(f"Published kills: {len(kills)}")
    print(f"Missing AI description: {len(no_desc)}")
    print(f"Gemini quota remaining: {scheduler.get_remaining('gemini')}")
    print()

    if not no_desc:
        print("All kills already have descriptions!")
        return

    analyzed = 0
    errors = 0

    for i, kill in enumerate(no_desc):
        remaining = scheduler.get_remaining("gemini")
        if remaining is not None and remaining <= 10:
            print(f"\nGemini quota low ({remaining}), stopping.")
            break

        result = await analyzer.analyze_kill_row(kill, clip_path=None)  # text-only

        if result:
            base = kill.get("highlight_score") or compute_hype_score(
                multi_kill=kill.get("multi_kill"),
                is_first_blood=kill.get("is_first_blood", False),
                shutdown_bounty=kill.get("shutdown_bounty", 0),
                game_time_seconds=kill.get("game_time_seconds"),
                tracked_team_involvement=kill.get("tracked_team_involvement"),
                confidence=kill.get("confidence", "high"),
            )
            gemini_score = result.get("highlight_score") or base
            blended = round(float(base) * 0.4 + float(gemini_score) * 0.6, 1)

            safe_update(
                "kills",
                {
                    "highlight_score": blended,
                    "ai_tags": result.get("tags") or [],
                    "ai_description": result.get("description_fr") or "",
                    "caster_hype_level": result.get("caster_hype_level"),
                },
                "id",
                kill["id"],
            )
            analyzed += 1
            desc = (result.get("description_fr") or "")[:60]
            print(f"  [{i+1}/{len(no_desc)}] {kill['killer_champion']:>10} -> {kill['victim_champion']:<10} | {desc}")
        else:
            errors += 1
            print(f"  [{i+1}/{len(no_desc)}] {kill['killer_champion']:>10} -> {kill['victim_champion']:<10} | GEMINI FAILED")

    print(f"\nDone: {analyzed} analyzed, {errors} errors")
    print(f"Gemini quota remaining: {scheduler.get_remaining('gemini')}")


if __name__ == "__main__":
    asyncio.run(main())
