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
from modules import harvester, clipper, analyzer, og_generator, qc
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

    # ─── 3b. Compute per-game VOD offsets from livestats anchors ──────
    # The lolesports API routinely returns offset=0 for every game of a BO3/5
    # even though they all share a single multi-hour VOD. We derive the real
    # offsets by fetching each game's livestats anchor and measuring elapsed
    # time from game 1. Requires `games.game_number` to be sorted correctly.
    sorted_games = sorted(
        game_db_rows,
        key=lambda g: int(g.get("game_number") or 1),
    )
    anchors: dict[str, tuple] = {}
    for g in sorted_games:
        ext = g.get("external_id")
        if not ext:
            continue
        a = await harvester.get_game_anchor(ext)
        if a:
            anchors[ext] = a

    if sorted_games and anchors.get(sorted_games[0].get("external_id", "")):
        first_ext = sorted_games[0]["external_id"]
        first_anchor_dt, _first_data = anchors[first_ext]
        first_api_offset = int(sorted_games[0].get("vod_offset_seconds") or 0)
        for g in sorted_games:
            ext = g.get("external_id")
            if not ext or ext not in anchors:
                continue
            anchor_dt, _ = anchors[ext]
            derived_offset = first_api_offset + int(
                (anchor_dt - first_anchor_dt).total_seconds()
            )
            # Only patch when the derived value differs — avoids noisy upserts
            if derived_offset != int(g.get("vod_offset_seconds") or 0):
                safe_update(
                    "games",
                    {"vod_offset_seconds": derived_offset},
                    "id",
                    g["id"],
                )
                g["vod_offset_seconds"] = derived_offset
                log.info(
                    "pipeline_vod_offset_derived",
                    game=ext,
                    game_number=g.get("game_number"),
                    offset_seconds=derived_offset,
                )

    # ─── 4. For each game: harvest → clip → analyse → OG ──────────────
    for game_row in sorted_games:
        game_ext_id = game_row.get("external_id")
        game_db_id = game_row.get("id")
        yt_id = game_row.get("vod_youtube_id")
        vod_offset = int(game_row.get("vod_offset_seconds") or 0)

        if not (game_ext_id and game_db_id):
            continue

        # Harvester — reuse the anchor we already fetched above to skip a hit
        kills = await harvester.extract_kills_from_game(
            external_game_id=game_ext_id,
            db_game_id=game_db_id,
            precomputed_anchor=anchors.get(game_ext_id),
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

        # ─── QC: calibrate offset before clipping ────────────────────
        # Use the first kill as a probe to verify the VOD offset is correct.
        # If the in-game timer doesn't match, auto-correct the offset for
        # ALL kills in this game before proceeding.
        if inserted_kill_rows:
            # Multi-probe: pick 3 kills spread across the game for robust calibration
            sorted_by_time = sorted(
                inserted_kill_rows,
                key=lambda k: int(k.get("game_time_seconds") or 0),
            )
            valid_kills = [k for k in sorted_by_time if int(k.get("game_time_seconds") or 0) > 60]
            if valid_kills:
                # Pick early, mid, late kills for 3-point calibration
                n = len(valid_kills)
                probe_indices = [0, n // 2, n - 1] if n >= 3 else list(range(n))
                probe_game_times = [
                    int(valid_kills[i].get("game_time_seconds") or 0)
                    for i in probe_indices
                ]
                calibrated_offset = await qc.calibrate_game_offset(
                    youtube_id=yt_id,
                    current_offset=vod_offset,
                    probe_game_times=probe_game_times,
                )
                if calibrated_offset != vod_offset:
                    log.info(
                        "pipeline_offset_calibrated",
                        game=game_ext_id,
                        old=vod_offset,
                        new=calibrated_offset,
                        correction=calibrated_offset - vod_offset,
                    )
                    vod_offset = calibrated_offset
                    safe_update(
                        "games",
                        {"vod_offset_seconds": calibrated_offset},
                        "id",
                        game_db_id,
                    )

        # Clipper — serialised to respect yt-dlp rate limits
        for kill_row in inserted_kill_rows:
            # Build match context string for text overlay
            gt = int(kill_row.get("game_time_seconds") or 0)
            gt_str = f"T+{gt // 60:02d}:{gt % 60:02d}"
            game_num = game_row.get("game_number", "?")
            overlay_ctx = f"Game {game_num}  {gt_str}"

            urls = await clipper.clip_kill(
                kill_id=kill_row["id"],
                youtube_id=yt_id,
                vod_offset_seconds=vod_offset,
                game_time_seconds=gt,
                multi_kill=kill_row.get("multi_kill"),
                killer_champion=kill_row.get("killer_champion"),
                victim_champion=kill_row.get("victim_champion"),
                match_context=overlay_ctx,
            )
            if urls and urls.get("clip_url_horizontal"):
                # Store local path for Gemini video analysis later
                kill_row["_local_h_path"] = urls.pop("_local_h_path", None)
                safe_update("kills", {**urls, "status": "clipped"}, "id", kill_row["id"])
                report["kills_clipped"] += 1
            else:
                safe_update("kills", {"status": "clip_error"}, "id", kill_row["id"])
                report["errors"].append(f"clip_error kill={kill_row['id']}")

        # Build a lookup of local clip paths from the inserted rows
        local_paths: dict[str, str | None] = {
            k["id"]: k.get("_local_h_path")
            for k in inserted_kill_rows
            if k.get("_local_h_path")
        }

        # Analyzer — only on successfully clipped kills
        clipped = safe_select(
            "kills",
            "id, killer_champion, victim_champion, is_first_blood, multi_kill, tracked_team_involvement, highlight_score, confidence, assistants",
            status="clipped",
            game_id=game_db_id,
        )
        for kill in clipped:
            # Pass local clip path to Gemini for VIDEO analysis (not text-only)
            clip_path = local_paths.get(kill["id"])
            result = await analyzer.analyze_kill_row(kill, clip_path=clip_path)
            if not result:
                # No Gemini result — keep the structured base score, still promote
                safe_update(
                    "kills",
                    {"status": "analyzed"},
                    "id",
                    kill["id"],
                )
                report["kills_analysed"] += 1
                continue
            # Blend: 40% structured base + 60% Gemini subjective
            base_score = _safe_float(kill.get("highlight_score")) or 5.0
            gemini_score = _safe_float(result.get("highlight_score")) or base_score
            blended = round(base_score * 0.4 + gemini_score * 0.6, 1)
            safe_update(
                "kills",
                {
                    "highlight_score": blended,
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

        # Clean up local clip files now that analysis is done
        for path in local_paths.values():
            if path:
                clipper.cleanup_local_clip(path)

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

    # ─── Discord: post top 3 kills from this match to #kc-kills ────────
    if report["kills_published"] > 0:
        try:
            top_kills = safe_select(
                "kills",
                "id, killer_champion, victim_champion, ai_description, highlight_score, thumbnail_url",
                status="published",
            )
            top_kills.sort(key=lambda k: float(k.get("highlight_score") or 0), reverse=True)
            for k in top_kills[:3]:
                await discord_webhook.notify_kill_published(
                    killer_champion=k.get("killer_champion") or "?",
                    victim_champion=k.get("victim_champion") or "?",
                    description=k.get("ai_description") or "",
                    highlight_score=float(k["highlight_score"]) if k.get("highlight_score") else None,
                    thumbnail_url=k.get("thumbnail_url"),
                    kill_id=k["id"],
                    match_info=f"Match {match_external_id}",
                )
        except Exception:
            pass  # never let Discord notification crash the pipeline

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
