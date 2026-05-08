"""
generate_weekly_digest — V36 (Wave 26.2).

Weekly Discord post (Monday 09:00 local) summarising the past 7
days for each follower's preferred players, plus the global Top 5.

Format :

    🔥 KCKILLS Weekly — Sem 19 (12-18 mai 2026)

    🏆 Top 5 de la semaine
       1. Caliste → Faker (Lillia, score 9.2)
       ...

    👥 Tes joueurs (per-user customisation in V36b)

    ⚡ KOTW : <kill of the week deeplink>
    📈 +N nouveaux clips cette semaine

Designed to run as a Windows Scheduled Task (KCKills-WeeklyDigest)
on Monday 09:00 local. Posts to the same Discord webhook as the
daily report.

Currently a SCAFFOLD — production-ready ship requires :
    * Per-user digest delivery (DM via Discord bot, or email).
      For V36 v1 we just post a single global digest to the
      shared webhook.
    * Pretty embed shaping (KCKILLS gold + thumbnails grid).

Usage :
    .venv\\Scripts\\python.exe worker\\scripts\\generate_weekly_digest.py
    .venv\\Scripts\\python.exe worker\\scripts\\generate_weekly_digest.py --since 2026-05-01 --until 2026-05-08
    .venv\\Scripts\\python.exe worker\\scripts\\generate_weekly_digest.py --dry-run
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from datetime import datetime, timezone, timedelta

import structlog
from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
load_dotenv()

log = structlog.get_logger()

WEEK_DAYS = 7
TOP_N = 5


async def main_async(args: argparse.Namespace) -> int:
    from services.supabase_client import safe_select
    from services import discord_webhook

    until = (
        datetime.fromisoformat(args.until)
        if args.until
        else datetime.now(timezone.utc)
    )
    since = (
        datetime.fromisoformat(args.since)
        if args.since
        else until - timedelta(days=WEEK_DAYS)
    )

    log.info(
        "weekly_digest_start",
        since=since.isoformat(),
        until=until.isoformat(),
        dry_run=args.dry_run,
    )

    # Top 5 of the window by highlight_score.
    top5 = safe_select(
        "kills",
        (
            "id,killer_champion,victim_champion,highlight_score,"
            "ai_description,multi_kill,is_first_blood"
        ),
        status="eq.published",
        updated_at=f"gte.{since.isoformat()}",
        order="highlight_score.desc.nullslast",
        limit=str(TOP_N),
    ) or []

    # Total clips this week.
    all_count = safe_select(
        "kills",
        "id",
        status="eq.published",
        updated_at=f"gte.{since.isoformat()}",
        limit="1",
    )
    total = len(all_count or [])

    if not top5:
        log.warn("weekly_digest_empty", since=since.isoformat())
        return 1

    # Build a Discord-friendly embed body.
    week_label = since.strftime("%d %b") + " → " + until.strftime("%d %b %Y")
    lines = [f"**🏆 Top {TOP_N} de la semaine ({week_label})**", ""]
    for i, k in enumerate(top5, 1):
        score = k.get("highlight_score") or 0
        suffix = ""
        if k.get("is_first_blood"):
            suffix += " 🩸"
        if k.get("multi_kill"):
            suffix += f" ⚡{k['multi_kill']}"
        desc = (k.get("ai_description") or "")[:80]
        lines.append(
            f"{i}. **{k.get('killer_champion','?')} → {k.get('victim_champion','?')}** · "
            f"{score:.1f}/10{suffix}"
            f"\n   _{desc}_"
        )
    lines.append("")
    lines.append(f"**📈 +{total} clips publiés cette semaine.**")
    lines.append("→ https://kckills.com/scroll?feed=top-semaine")
    body = "\n".join(lines)

    if args.dry_run:
        print("=" * 60)
        print("  DRY-RUN — Discord embed body :")
        print("=" * 60)
        print(body)
        return 0

    await discord_webhook.send(
        content="",
        embed={
            "title": f"KCKILLS Weekly · {week_label}",
            "description": body,
            "color": 0xC8AA6E,
            "footer": {"text": "Réglages : /settings sur kckills.com"},
        },
    )
    log.info("weekly_digest_sent", clips=len(top5), total=total)
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--since", help="ISO datetime ; default = 7 d ago.")
    ap.add_argument("--until", help="ISO datetime ; default = now.")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    return asyncio.run(main_async(args))


if __name__ == "__main__":
    raise SystemExit(main())
