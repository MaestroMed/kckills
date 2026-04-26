"""
reanalyze_pollution_qc.py — Re-classify published clips with the new
anti-pollution clip_context prompt, IN-PLACE, using the configured
default Gemini model (free-tier compatible).

Why this exists
═══════════════
Wave 12 added `ai_clip_context` to the analyzer's Gemini prompt — the
analyzer now classifies every clip into one of 8 contexts
(live_gameplay / replay / draft / lobby / loading / plateau /
transition / other) and force-hides anything that isn't live_gameplay.

But the 660 clips published BEFORE Wave 12 are still ai_clip_context
NULL and stay visible regardless of whether they're actually live
gameplay. User feedback : "j'ai pas mal de clips qui sont des bouts
d'entre game, de plateau post game ou avant, draft, parfois mal
découpé."

This script back-runs the new prompt on every existing published clip
and updates kills.ai_clip_context + kills.kill_visible so the scroll
feed retroactively gains the anti-pollution filter.

Differences vs `reanalyze_with_premium.py`
══════════════════════════════════════════
* Uses the env-configured GEMINI_MODEL (default flash-lite — free) ;
  doesn't require KCKILLS_GEMINI_TIER=premium.
* Keeps status='published' — clips stay visible during processing.
  Only ai_clip_context + kill_visible flip post-classification.
* Does NOT update description_fr / tags / highlight_score — those were
  already curated by the original analyzer pass and we don't want to
  retread the existing prose. Pure QC pass.
* Honors --limit, --dry-run, --since-days, --skip-tagged for safe
  incremental rollout.

Cost
════
* Per clip : ~50 input tokens + ~50 output tokens (we skip the long
  description prompt, just the QC fields)
* Free tier 1000 RPD — easily under quota.
* Total for 660 clips at 4 s/call = ~44 min. No € cost on free tier.

Run
═══
    # See how many would be touched without writing :
    python scripts/reanalyze_pollution_qc.py --dry-run

    # Process 50 clips first to validate the prompt :
    python scripts/reanalyze_pollution_qc.py --limit 50

    # Full backfill of all published, never-tagged clips :
    python scripts/reanalyze_pollution_qc.py --skip-tagged
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

# Make the worker package importable when run as a script
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

import structlog
import httpx

from modules.analyzer import (  # noqa: E402
    analyze_kill_row,
)

log = structlog.get_logger()


def _supabase() -> tuple[str, str]:
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        print("ABORT : SUPABASE_URL / SUPABASE_SERVICE_KEY missing in env")
        sys.exit(2)
    return url, key


def _select_candidates(
    *,
    limit: int | None,
    skip_tagged: bool,
    since_days: int | None,
) -> list[dict]:
    """Pull candidate kills from Supabase."""
    url, key = _supabase()
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    select = (
        "id,killer_champion,victim_champion,game_id,game_time_seconds,"
        "is_first_blood,multi_kill,kill_visible,assistants,shutdown_bounty,"
        "retry_count,clip_url_horizontal,clip_url_vertical,ai_clip_context,"
        "ai_description,created_at,updated_at"
    )
    qs = [f"select={select}", "status=eq.published"]
    if skip_tagged:
        qs.append("ai_clip_context=is.null")
    if since_days is not None:
        from datetime import datetime, timedelta, timezone
        cutoff = (datetime.now(timezone.utc) - timedelta(days=since_days)).isoformat()
        qs.append(f"created_at=gte.{cutoff}")
    qs.append("order=created_at.desc")
    if limit is not None:
        qs.append(f"limit={limit}")
    full = f"{url}/rest/v1/kills?" + "&".join(qs)
    r = httpx.get(full, headers=headers, timeout=30.0)
    r.raise_for_status()
    return r.json() or []


async def _process_one(kill: dict) -> tuple[bool, str]:
    """Re-classify a single kill. Writes ai_clip_context + kill_visible.

    Returns (success, reason). Reason is one of :
      "tagged_live_gameplay" — clip survives the QC, kill_visible kept
      "tagged_filtered_out"  — clip moved to kill_visible=false (pollution)
      "no_clip_url"          — no horizontal/vertical clip path on row
      "download_failed"      — couldn't fetch the clip from R2
      "analyze_failed"       — Gemini call returned no usable result
    """
    import tempfile
    clip_url = kill.get("clip_url_vertical") or kill.get("clip_url_horizontal")
    if not clip_url:
        return False, "no_clip_url"

    # Download the clip to a temp file (mirrors reanalyze_with_premium.py).
    # Gemini needs the local file path — it can't read R2 URLs directly
    # because the call goes through the google-generativeai SDK which
    # uploads bytes to its own staging bucket.
    tmp_dir = os.environ.get("KCKILLS_TMP_DIR") or tempfile.gettempdir()
    os.makedirs(tmp_dir, exist_ok=True)
    clip_path = os.path.join(tmp_dir, f"polqc_{str(kill['id'])[:8]}.mp4")
    try:
        with httpx.stream("GET", clip_url, follow_redirects=True, timeout=60) as resp:
            resp.raise_for_status()
            with open(clip_path, "wb") as f:
                for chunk in resp.iter_bytes():
                    f.write(chunk)
    except Exception as e:
        log.warn("reanalyze_pollution_qc_download_failed",
                 kill_id=str(kill.get("id"))[:8], error=str(e)[:120])
        return False, "download_failed"

    try:
        result = await analyze_kill_row(kill, clip_path=clip_path)
    except Exception as e:
        log.error("reanalyze_pollution_qc_threw",
                  kill_id=str(kill.get("id"))[:8], error=str(e)[:200])
        return False, "analyze_failed"
    finally:
        if os.path.exists(clip_path):
            try:
                os.remove(clip_path)
            except OSError:
                pass

    if not result or not isinstance(result, dict):
        return False, "analyze_failed"

    # `analyze_kill_row` returns the RAW Gemini JSON (keys = `clip_context`
    # + `kill_visible_on_screen`), not the post-processed patch (which
    # lives in the analyzer's main pipeline path with renamed keys
    # `ai_clip_context` + `kill_visible`). Map them here :
    raw_ctx = (result.get("clip_context") or "").strip().lower()
    VALID_CONTEXTS = {
        "live_gameplay", "replay", "draft", "lobby",
        "loading", "plateau", "transition", "other",
    }
    new_ctx = raw_ctx if raw_ctx in VALID_CONTEXTS else "other"
    raw_visible = result.get("kill_visible_on_screen")
    new_visible = bool(raw_visible) if raw_visible is not None else None
    # Mirror the analyzer's anti-pollution gate : non-live_gameplay forces
    # kill_visible=false so the existing scroll-feed filter hides the row.
    if new_ctx != "live_gameplay":
        new_visible = False

    # Persist ONLY the QC fields. Skip description / tags / score so we
    # don't retread the original analyzer's prose work.
    url, key = _supabase()
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    patch: dict = {}
    if new_ctx is not None:
        patch["ai_clip_context"] = new_ctx
    if new_visible is not None:
        patch["kill_visible"] = bool(new_visible)
    if not patch:
        return False, "analyze_failed"

    r = httpx.patch(
        f"{url}/rest/v1/kills?id=eq.{kill['id']}",
        headers=headers,
        json=patch,
        timeout=15.0,
    )
    if r.status_code not in (200, 204):
        log.warn("reanalyze_pollution_qc_patch_failed",
                 kill_id=str(kill["id"])[:8], status=r.status_code,
                 body=r.text[:200])
        return False, "analyze_failed"

    if new_ctx == "live_gameplay":
        return True, "tagged_live_gameplay"
    return True, "tagged_filtered_out"


async def _main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--limit", type=int, default=None,
                   help="Cap how many to process (default : all)")
    p.add_argument("--dry-run", action="store_true",
                   help="Count candidates only, no API calls")
    p.add_argument("--since-days", type=int, default=None,
                   help="Only consider clips published in last N days")
    p.add_argument("--skip-tagged", action="store_true",
                   help="Skip clips that already have ai_clip_context set")
    p.add_argument("--inter-call-delay", type=float, default=4.5,
                   help="Seconds between Gemini calls (free tier 15 RPM = 4.0s)")
    args = p.parse_args()

    print(f"Model    : {os.environ.get('GEMINI_MODEL', 'gemini-2.5-flash-lite')}")
    print(f"Mode     : {'DRY-RUN' if args.dry_run else 'LIVE'}")
    print(f"Limit    : {args.limit or 'no cap'}")
    print(f"Since    : {args.since_days or 'all-time'} days")
    print(f"Skip-tagged: {args.skip_tagged}")
    print(f"Delay    : {args.inter_call_delay}s between Gemini calls")
    print()

    candidates = _select_candidates(
        limit=args.limit,
        skip_tagged=args.skip_tagged,
        since_days=args.since_days,
    )
    print(f"Candidates: {len(candidates)} clips eligible")
    if args.dry_run or not candidates:
        return 0

    counters = {
        "tagged_live_gameplay": 0,
        "tagged_filtered_out":  0,
        "no_clip_url":          0,
        "download_failed":      0,
        "analyze_failed":       0,
    }

    for i, kill in enumerate(candidates, 1):
        ok, reason = await _process_one(kill)
        counters[reason] = counters.get(reason, 0) + 1
        if i % 25 == 0 or i == len(candidates):
            print(
                f"  [{i:>4}/{len(candidates)}] "
                f"live={counters['tagged_live_gameplay']} "
                f"hidden={counters['tagged_filtered_out']} "
                f"nourl={counters['no_clip_url']} "
                f"failed={counters['analyze_failed']}"
            )
        # Inter-call delay (Gemini free tier = 15 RPM = 4.0 s minimum)
        if i < len(candidates):
            await asyncio.sleep(args.inter_call_delay)

    print()
    print("=" * 60)
    print(f"  total processed       : {len(candidates)}")
    print(f"  tagged live_gameplay  : {counters['tagged_live_gameplay']}")
    print(f"  hidden as pollution   : {counters['tagged_filtered_out']}")
    print(f"  skipped (no clip url) : {counters['no_clip_url']}")
    print(f"  download failed       : {counters['download_failed']}")
    print(f"  analyze failed        : {counters['analyze_failed']}")
    print("=" * 60)
    pollution_pct = (
        100 * counters["tagged_filtered_out"] /
        max(1, counters["tagged_live_gameplay"] + counters["tagged_filtered_out"])
    )
    print(f"  POLLUTION % (filtered): {pollution_pct:.1f}%")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(_main()))
