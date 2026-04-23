"""
LAB_GENERATE_EVALUATIONS — Generate one description per (clip, model)
combination for blind A/B testing at /admin/lab.

Picks N representative published kills (variety: solo / multi / first
blood / KC win / KC loss) and runs each through M Gemini models. Writes
results to the `lab_evaluations` table for human voting.

Cost math (5 clips × 4 models, default models below) :
  - 2.5 Flash-Lite   : 5 × $0.0008 = $0.004
  - 2.5 Pro          : 5 × $0.020  = $0.100
  - 3 Flash          : 5 × $0.0075 = $0.037
  - 3.1 Pro Preview  : 5 × $0.030  = $0.150
  - Total            : ~$0.30 = €0.28

Persistent : results land in `lab_evaluations` (Supabase) with cost_usd
and timing per row. Voting verdicts are also persistent.

Run
---
  python scripts/lab_generate_evaluations.py            # default 5 clips, 4 models
  python scripts/lab_generate_evaluations.py --clips 10 # bigger sample
  python scripts/lab_generate_evaluations.py --models "gemini-2.5-pro,gemini-3-flash"
  python scripts/lab_generate_evaluations.py --refresh  # overwrite existing
"""
from __future__ import annotations

import argparse
import asyncio
import os
import random
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

import httpx  # noqa: E402

from config import config  # noqa: E402
from services.supabase_client import get_db, safe_select, safe_upsert  # noqa: E402
from modules.analyzer import analyze_kill_row, validate_description  # noqa: E402


# Models to evaluate. The agent's research (April 2026) says these 4
# bracket the cost/quality space for video understanding.
DEFAULT_MODELS = [
    "gemini-2.5-flash-lite",      # current production, baseline
    "gemini-3-flash",              # frontier-class at fraction of Pro cost
    "gemini-2.5-pro",              # GA premium, no preview risk
    "gemini-3.1-pro-preview",      # SOTA but Preview = shutdown risk
]

# Approx pricing per 1M tokens (April 2026 — source: ai.google.dev pricing)
MODEL_PRICING: dict[str, tuple[float, float]] = {
    "gemini-2.5-flash-lite":   (0.10, 0.40),
    "gemini-2.5-flash":        (0.30, 2.50),
    "gemini-3-flash":          (0.50, 3.00),
    "gemini-3.1-flash-lite":   (0.25, 1.50),
    "gemini-2.5-pro":          (1.25, 10.00),
    "gemini-3.1-pro-preview":  (2.00, 12.00),
}

VIDEO_TOKENS_PER_SEC = 300  # default media resolution


def _estimate_cost(model: str, video_seconds: int, output_tokens: int) -> float:
    """Rough cost estimate using public pricing."""
    in_price, out_price = MODEL_PRICING.get(model, (0.10, 0.40))
    input_tokens = video_seconds * VIDEO_TOKENS_PER_SEC + 500
    return (input_tokens * in_price + output_tokens * out_price) / 1_000_000


def _pick_representative_clips(n: int) -> list[dict]:
    """Pick a varied sample : 1 multi_kill, 1 first_blood, 1 KC victim,
    rest random KC kills with high highlight score.
    """
    db = get_db()
    if not db:
        print("ERROR : Supabase unavailable")
        sys.exit(1)

    picked: dict[str, dict] = {}

    def _q(filters: dict, limit: int = 5) -> list[dict]:
        params = {
            "select": "id,killer_champion,victim_champion,clip_url_vertical,"
                      "clip_url_horizontal,is_first_blood,multi_kill,"
                      "tracked_team_involvement,fight_type,matchup_lane,"
                      "lane_phase,kill_visible,assistants,shutdown_bounty,"
                      "highlight_score,game_time_seconds",
            "status": "eq.published",
            "clip_url_vertical": "not.is.null",
            "limit": str(limit),
            "order": "highlight_score.desc.nullslast",
        }
        params.update(filters)
        r = httpx.get(f"{db.base}/kills", headers=db.headers, params=params, timeout=15)
        r.raise_for_status()
        return r.json() or []

    # Slot 1: a multi_kill (rare + dramatic)
    for k in _q({"multi_kill": "in.(triple,quadra,penta)"}, 3):
        picked[k["id"]] = k
        break
    # Slot 2: a first_blood
    for k in _q({"is_first_blood": "eq.true"}, 3):
        if k["id"] not in picked:
            picked[k["id"]] = k
            break
    # Slot 3: a KC victim (sympathy / vs-KC perspective)
    for k in _q({"tracked_team_involvement": "eq.team_victim"}, 3):
        if k["id"] not in picked:
            picked[k["id"]] = k
            break
    # Remaining slots: random high-score KC killers
    pool = _q({"tracked_team_involvement": "eq.team_killer"}, 50)
    random.shuffle(pool)
    for k in pool:
        if len(picked) >= n:
            break
        if k["id"] not in picked:
            picked[k["id"]] = k

    return list(picked.values())[:n]


async def _generate_one(kill: dict, model: str, refresh: bool) -> dict | None:
    """Run one Gemini call for one (kill, model) and write the eval row."""
    if not refresh:
        existing = safe_select(
            "lab_evaluations", "id",
            kill_id=kill["id"], model=model, media_resolution="default",
        )
        if existing:
            return None

    clip_url = kill.get("clip_url_vertical") or kill.get("clip_url_horizontal")
    if not clip_url:
        return None

    tmp_dir = config.CLIPS_DIR
    os.makedirs(tmp_dir, exist_ok=True)
    clip_path = os.path.join(tmp_dir, f"lab_{kill['id'][:8]}.mp4")
    try:
        with httpx.stream("GET", clip_url, follow_redirects=True, timeout=60) as r:
            r.raise_for_status()
            with open(clip_path, "wb") as f:
                for chunk in r.iter_bytes():
                    f.write(chunk)
    except Exception as e:
        print(f"  ! download failed for {kill['id'][:8]}: {e}")
        return None

    t0 = time.monotonic()
    # Inject the model override into the kill dict so analyze_kill_row
    # picks it up (PR13 hook).
    kill_for_analyze = dict(kill)
    kill_for_analyze["_model_override"] = model

    result = await analyze_kill_row(kill_for_analyze, clip_path=clip_path)
    elapsed = int((time.monotonic() - t0) * 1000)

    if os.path.exists(clip_path):
        try: os.remove(clip_path)
        except OSError: pass

    if not result:
        return None

    desc = result.get("description_fr") or "(empty)"
    usage = result.get("_usage") or {}
    output_tokens = usage.get("candidates_tokens") or len(desc) // 4
    cost = _estimate_cost(model, 40, output_tokens)

    row = {
        "kill_id": kill["id"],
        "model": model,
        "media_resolution": "default",
        "description": desc,
        "tags": result.get("tags") or [],
        "highlight_score": result.get("highlight_score"),
        "kill_visible": result.get("kill_visible_on_screen"),
        "caster_hype_level": result.get("caster_hype_level"),
        "input_tokens": usage.get("prompt_tokens") or 40 * VIDEO_TOKENS_PER_SEC + 500,
        "output_tokens": output_tokens,
        "cost_usd": round(cost, 6),
        "elapsed_ms": elapsed,
    }
    safe_upsert("lab_evaluations", row, on_conflict="kill_id,model,media_resolution")
    return row


async def main_async(n_clips: int, models: list[str], refresh: bool) -> int:
    print("=" * 60)
    print(f"  LAB GENERATOR — {n_clips} clips × {len(models)} models")
    print("=" * 60)
    print()

    est_total = sum(_estimate_cost(m, 40, 500) for m in models) * n_clips
    print(f"Estimated cost : ~${est_total:.4f} = ~€{est_total * 0.93:.4f}")
    print(f"Models : {', '.join(models)}")
    print()

    clips = _pick_representative_clips(n_clips)
    if not clips:
        print("ABORT : no published clips with vertical URL available.")
        return 1
    print(f"Picked {len(clips)} clips :")
    for k in clips:
        flags = []
        if k.get("multi_kill"): flags.append(k["multi_kill"])
        if k.get("is_first_blood"): flags.append("first_blood")
        if k.get("tracked_team_involvement") == "team_victim": flags.append("KC_victim")
        flag_str = "+".join(flags) or "kc_kill"
        print(f"  {k['id'][:8]}  {k.get('killer_champion','?'):<12}->{k.get('victim_champion','?'):<12}"
              f"  score={k.get('highlight_score') or 0:.1f}  [{flag_str}]")
    print()

    total = len(clips) * len(models)
    done = 0
    skipped = 0
    print(f"Running {total} Gemini calls (sequential, respect rate limit)...")
    print()
    for k in clips:
        for m in models:
            done += 1
            print(f"  [{done:>2}/{total}] {k['id'][:8]} × {m}")
            row = await _generate_one(k, m, refresh)
            if row is None:
                skipped += 1
                print(f"           skipped (already exists or error)")
            else:
                preview = (row['description'] or '').replace('\n', ' ')[:80]
                print(f"           ${row['cost_usd']:.5f}  {row['elapsed_ms']}ms  '{preview}...'")
            await asyncio.sleep(4)  # 15 RPM Gemini default safe pacing

    print()
    print("-" * 60)
    print(f"  attempted : {total}")
    print(f"  skipped   : {skipped} (already existed)")
    print(f"  generated : {total - skipped}")
    print()
    print("Visit /admin/lab to vote on the descriptions.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--clips", type=int, default=5, help="How many clips to evaluate")
    ap.add_argument("--models", default=",".join(DEFAULT_MODELS),
                    help="Comma-separated model list")
    ap.add_argument("--refresh", action="store_true",
                    help="Overwrite existing evaluations for the same combo")
    args = ap.parse_args()

    models = [m.strip() for m in args.models.split(",") if m.strip()]
    return asyncio.run(main_async(args.clips, models, args.refresh))


if __name__ == "__main__":
    sys.exit(main())
