"""
PIPELINE — End-to-end orchestrator for a single match.

This is the test harness that proves zeta end-to-end:
    sentinel → harvester → clipper → analyzer → og_generator

Usage:
    python main.py pipeline <match_external_id>
    python main.py pipeline 115548424308414188

Flow:
1. Ensure the match + all its games exist in Supabase (calls sentinel logic)
2. For each game of that match:
   a. Harvester: extract kills via livestats frame diff
   b. Clipper: yt-dlp + ffmpeg × 3 + R2 upload for each kill
   c. Analyzer: Gemini 2.5 Flash-Lite on each clipped kill
   d. OG generator: Pillow → R2
3. Print a summary table

Safe to re-run — each stage upserts or checks existing data first.
"""

from __future__ import annotations

import asyncio
import structlog

from services import lolesports_api
from services.supabase_client import safe_select, safe_upsert, safe_update, safe_insert
from modules import harvester, clipper, analyzer, og_generator
from modules import sentinel  # noqa: F401 — keeps symbol for tests

log = structlog.get_logger()


async def run_for_match(match_external_id: str) -> dict:
    """Run the full pipeline on one match. Returns a report dict."""
    report: dict = {
        "match_id": match_external_id,
        "games": 0,
        "kills_detected": 0,
        "kills_clipped": 0,
        "kills_analysed": 0,
        "kills_published": 0,
        "errors": [],
    }

    # ─── 1. Resolve match via lolesports getEventDetails ───────────────
    log.info("pipeline_start", match=match_external_id)
    details = await lolesports_api.get_event_details(match_external_id)
    if not details:
        report["errors"].append("getEventDetails returned nothing")
        return report

    match = details.get("match", {}) or {}
    teams = match.get("teams", []) or []
    if len(teams) < 2:
        report["errors"].append("match has < 2 teams")
        return report

    # ─── 2. Upsert match row in DB ─────────────────────────────────────
    # We need a scheduled_at — try to pull it from the existing matches table
    # (populated by sentinel). If missing, harvester will fail gracefully.
    existing = safe_select("matches", "id, scheduled_at, stage", external_id=match_external_id)
    scheduled_at = existing[0].get("scheduled_at") if existing else None
    stage = existing[0].get("stage") if existing else ""

    match_row = safe_upsert(
        "matches",
        {
            "external_id": match_external_id,
            "format": f"bo{(match.get('strategy') or {}).get('count', 1)}",
            "stage": stage or "",
            "scheduled_at": scheduled_at,
            "state": "completed",
        },
        on_conflict="external_id",
    )
    match_db_id = (match_row or {}).get("id") if match_row else (existing[0]["id"] if existing else None)
    if not match_db_id:
        report["errors"].append("could not upsert match row")
        return report

    # ─── 3. Upsert games + VODs ────────────────────────────────────────
    games_payload = match.get("games", []) or []
    game_db_rows: list[dict] = []
    for g in games_payload:
        if g.get("state") != "completed":
            continue
        game_ext_id = g.get("id")
        if not game_ext_id:
            continue

        vod_yt_id = None
        vod_offset = None
        for vod in g.get("vods", []) or []:
            if vod.get("provider") == "youtube":
                vod_yt_id = vod.get("parameter")
                vod_offset = int(vod.get("offset") or 0)
                if str(vod.get("locale", "")).startswith("en"):
                    break  # prefer English

        payload = {
            "external_id": game_ext_id,
            "match_id": match_db_id,
            "game_number": g.get("number", 1),
            "state": "vod_found" if vod_yt_id else "pending",
        }
        if vod_yt_id:
            payload["vod_youtube_id"] = vod_yt_id
            payload["vod_offset_seconds"] = vod_offset or 0

        game_row = safe_upsert("games", payload, on_conflict="external_id")
        if game_row:
            game_db_rows.append(game_row)
        elif existing_game := safe_select("games", "id, external_id, vod_youtube_id, vod_offset_seconds, match_id", external_id=game_ext_id):
            game_db_rows.append(existing_game[0])

    report["games"] = len(game_db_rows)
    log.info("pipeline_games_resolved", n=len(game_db_rows))

    if not game_db_rows:
        report["errors"].append("no completed games with VODs")
        return report

    # ─── 4. For each game: harvest → clip → analyse → OG ──────────────
    for game_row in game_db_rows:
        game_ext_id = game_row.get("external_id")
        game_db_id = game_row.get("id")
        yt_id = game_row.get("vod_youtube_id")
        vod_offset = int(game_row.get("vod_offset_seconds") or 0)

        if not (game_ext_id and game_db_id):
            continue

        # Harvester — self-anchors via livestats default call, no scheduled_at needed
        kills = await harvester.extract_kills_from_game(
            external_game_id=game_ext_id,
            db_game_id=game_db_id,
        )
        log.info("pipeline_kills_detected", game=game_ext_id, n=len(kills))
        report["kills_detected"] += len(kills)

        # Insert kills (skip duplicates on event_epoch + game_id)
        inserted_kill_rows: list[dict] = []
        for k in kills:
            payload = k.to_db_dict()
            payload["killer_name_hint"] = None  # not in schema — keep for future
            payload.pop("killer_name_hint", None)
            row = safe_insert("kills", {
                "game_id": payload["game_id"],
                "event_epoch": payload["event_epoch"],
                "game_time_seconds": payload.get("game_time_seconds"),
                "killer_champion": payload.get("killer_champion"),
                "victim_champion": payload.get("victim_champion"),
                "assistants": payload.get("assistants") or [],
                "confidence": payload.get("confidence") or "high",
                "tracked_team_involvement": payload.get("tracked_team_involvement"),
                "is_first_blood": bool(payload.get("is_first_blood")),
                "multi_kill": payload.get("multi_kill"),
                "shutdown_bounty": payload.get("shutdown_bounty") or 0,
                "data_source": payload.get("data_source") or "livestats",
                "status": "vod_found" if yt_id else "raw",
            })
            if row:
                # Keep the non-persisted hints in memory so clipper/analyzer can use them
                row["_killer_name_hint"] = k.killer_name
                row["_victim_name_hint"] = k.victim_name
                inserted_kill_rows.append(row)

        safe_update("games", {"kills_extracted": True}, "id", game_db_id)

        if not yt_id:
            log.warn("pipeline_no_vod", game=game_ext_id)
            continue

        # Clipper — serialised to respect yt-dlp rate limits
        for kill_row in inserted_kill_rows:
            urls = await clipper.clip_kill(
                kill_id=kill_row["id"],
                youtube_id=yt_id,
                vod_offset_seconds=vod_offset,
                game_time_seconds=int(kill_row.get("game_time_seconds") or 0),
            )
            if urls and urls.get("clip_url_horizontal"):
                safe_update("kills", {**urls, "status": "clipped"}, "id", kill_row["id"])
                report["kills_clipped"] += 1
            else:
                safe_update("kills", {"status": "clip_error"}, "id", kill_row["id"])
                report["errors"].append(f"clip_error kill={kill_row['id']}")

        # Analyzer — only on successfully clipped kills
        clipped = safe_select(
            "kills",
            "id, killer_champion, victim_champion, is_first_blood, multi_kill, tracked_team_involvement",
            status="clipped",
            game_id=game_db_id,
        )
        for kill in clipped:
            result = await analyzer.analyze_kill_row(kill)
            if not result:
                continue
            safe_update(
                "kills",
                {
                    "highlight_score": _safe_float(result.get("highlight_score")),
                    "ai_tags": result.get("tags") or [],
                    "ai_description": result.get("description_fr"),
                    "kill_visible": bool(result.get("kill_visible_on_screen", True)),
                    "caster_hype_level": _safe_int(result.get("caster_hype_level")),
                    "status": "analyzed",
                },
                "id",
                kill["id"],
            )
            report["kills_analysed"] += 1

        # OG — on analysed kills
        analysed = safe_select(
            "kills",
            "id, killer_champion, victim_champion, ai_description, avg_rating, rating_count, multi_kill, og_image_url",
            status="analyzed",
            game_id=game_db_id,
        )
        for kill in analysed:
            if kill.get("og_image_url"):
                safe_update("kills", {"status": "published"}, "id", kill["id"])
                report["kills_published"] += 1
                continue
            local = og_generator.generate_og_image(
                kill_id=kill["id"],
                killer_name=kill.get("killer_name") or "KC",
                killer_champion=kill.get("killer_champion") or "?",
                victim_name=kill.get("victim_name") or "Opponent",
                victim_champion=kill.get("victim_champion") or "?",
                description=kill.get("ai_description") or "",
                rating=float(kill.get("avg_rating") or 0),
                rating_count=int(kill.get("rating_count") or 0),
                multi_kill=kill.get("multi_kill"),
            )
            from services import r2_client
            og_url = await r2_client.upload_og(kill["id"], local) if local else None
            patch = {"status": "published"}
            if og_url:
                patch["og_image_url"] = og_url
            safe_update("kills", patch, "id", kill["id"])
            report["kills_published"] += 1

    log.info("pipeline_done", **{k: v for k, v in report.items() if k != "errors"})
    return report


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


def print_report(report: dict):
    """Pretty-print a pipeline report to stdout."""
    print()
    print("=" * 60)
    print(f"  Pipeline report — match {report['match_id']}")
    print("=" * 60)
    print(f"  Games processed   : {report['games']}")
    print(f"  Kills detected    : {report['kills_detected']}")
    print(f"  Kills clipped     : {report['kills_clipped']}")
    print(f"  Kills analysed    : {report['kills_analysed']}")
    print(f"  Kills published   : {report['kills_published']}")
    if report["errors"]:
        print(f"  Errors            : {len(report['errors'])}")
        for e in report["errors"][:5]:
            print(f"    - {e}")
    print("=" * 60)
    print()
