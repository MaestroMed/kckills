"""analyze_qc_results — Wave 27.28

Read the latest qc_global_results_*.json and print a structured analysis :
  * Verdict distribution (GOOD / ACCEPTABLE / BAD / ERROR)
  * Top-10 most common 'issues' strings
  * Verdict by clip_quality bucket (1-10)
  * 'kill_visible' flips (legacy DB vs Gemini)
  * BAD kills broken down by parent-game eligibility for KC Replay re-clip
  * Top 20 BAD games (by kill count) with KC Replay availability

Usage :
    python analyze_qc_results.py                # latest results file
    python analyze_qc_results.py path/to/x.json # specific file
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, os.path.dirname(__file__))
from dotenv import load_dotenv
load_dotenv()

import httpx

QC_DIR = Path(__file__).parent / "deep_qc"


def latest_results_file() -> Path:
    files = sorted(QC_DIR.glob("qc_global_results_*.json"))
    if not files:
        raise SystemExit("No qc_global_results_*.json found in deep_qc/")
    # Largest file = full pass (smoke test files have 5-8 entries)
    files.sort(key=lambda p: p.stat().st_size, reverse=True)
    return files[0]


def fetch_game_alt_vod_map(game_ids: list[str]) -> dict[str, dict]:
    """For each unique game_id of a kill, fetch the parent game's VOD info."""
    SB = os.environ["SUPABASE_URL"]
    HEAD = {"apikey": os.environ["SUPABASE_SERVICE_KEY"],
            "Authorization": f"Bearer {os.environ['SUPABASE_SERVICE_KEY']}"}
    out: dict[str, dict] = {}
    for gid in set(game_ids):
        r = httpx.get(SB + "/rest/v1/games", params={
            "select": "id,external_id,vod_youtube_id,alt_vod_youtube_id,vod_offset_seconds",
            "id": f"eq.{gid}",
        }, headers=HEAD, timeout=15)
        rows = r.json() if r.status_code == 200 else []
        out[gid] = rows[0] if rows else {}
    return out


def fetch_kill_to_game(kill_ids: list[str]) -> dict[str, str]:
    """kill_id -> game_id."""
    SB = os.environ["SUPABASE_URL"]
    HEAD = {"apikey": os.environ["SUPABASE_SERVICE_KEY"],
            "Authorization": f"Bearer {os.environ['SUPABASE_SERVICE_KEY']}"}
    out: dict[str, str] = {}
    # Batch in chunks of 100 via in.()
    chunks = [kill_ids[i:i+100] for i in range(0, len(kill_ids), 100)]
    for chunk in chunks:
        in_filter = "(" + ",".join(chunk) + ")"
        r = httpx.get(SB + "/rest/v1/kills", params={
            "select": "id,game_id",
            "id": f"in.{in_filter}",
        }, headers=HEAD, timeout=30)
        for row in r.json() or []:
            out[row["id"]] = row["game_id"]
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("file", nargs="?", default=None,
                        help="Specific results JSON. Default: latest.")
    args = parser.parse_args()

    path = Path(args.file) if args.file else latest_results_file()
    print(f"Reading {path.name}")
    data = json.loads(path.read_text(encoding="utf-8"))
    total = len(data)
    print(f"  Entries: {total}\n")

    # ─── 1. Verdict distribution ──────────────────────────────
    counts: Counter[str] = Counter()
    for r in data:
        if "error" in r:
            counts["ERROR"] += 1
        else:
            counts[r.get("verdict", "?")] += 1
    print("=" * 60)
    print("VERDICT DISTRIBUTION")
    print("=" * 60)
    for v, n in counts.most_common():
        print(f"  {v:<11} {n:>5}  ({100*n/max(1,total):5.1f}%)")

    # ─── 2. Top issues ────────────────────────────────────────
    issues: Counter[str] = Counter()
    for r in data:
        for issue in r.get("issues") or []:
            # Normalise — first 50 chars to bucket near-duplicates
            issues[issue[:60]] += 1
    print()
    print("=" * 60)
    print("TOP 15 ISSUE STRINGS")
    print("=" * 60)
    for issue, n in issues.most_common(15):
        print(f"  {n:>4}  {issue}")

    # ─── 3. Verdict by quality bucket ─────────────────────────
    print()
    print("=" * 60)
    print("VERDICT BY CLIP_QUALITY BUCKET")
    print("=" * 60)
    by_quality: dict[int, Counter[str]] = {}
    for r in data:
        if "error" in r:
            continue
        q = int(r.get("clip_quality") or 0)
        by_quality.setdefault(q, Counter())[r.get("verdict", "?")] += 1
    for q in sorted(by_quality):
        c = by_quality[q]
        n = sum(c.values())
        good = c.get("GOOD", 0)
        meh = c.get("ACCEPTABLE", 0)
        bad = c.get("BAD", 0)
        print(f"  q={q:<2} n={n:>4}  GOOD={good:<3} MEH={meh:<3} BAD={bad:<3}  ({100*bad/n:5.1f}% BAD)")

    # ─── 4. kill_visible flips ────────────────────────────────
    flips_legacy_true_now_false = sum(
        1 for r in data
        if "error" not in r
        and r.get("legacy_kill_visible") is True
        and r.get("kill_visible") is False
    )
    flips_legacy_false_now_true = sum(
        1 for r in data
        if "error" not in r
        and r.get("legacy_kill_visible") is False
        and r.get("kill_visible") is True
    )
    agree = sum(
        1 for r in data
        if "error" not in r
        and r.get("legacy_kill_visible") == r.get("kill_visible")
    )
    print()
    print("=" * 60)
    print("kill_visible AGREEMENT (legacy DB vs Gemini)")
    print("=" * 60)
    print(f"  Agree              : {agree}")
    print(f"  Legacy=T -> now=F  : {flips_legacy_true_now_false}  (false-positives caught by QC)")
    print(f"  Legacy=F -> now=T  : {flips_legacy_false_now_true}  (false-negatives — clip is fine)")

    # ─── 5. BAD kills × KC Replay eligibility ─────────────────
    bad_ids = [r["id"] for r in data if r.get("verdict") == "BAD"]
    print()
    print("=" * 60)
    print(f"BAD KILLS RE-CLIP ELIGIBILITY ({len(bad_ids)} BAD)")
    print("=" * 60)
    if not bad_ids:
        print("  (no BAD kills)")
        return
    kill_to_game = fetch_kill_to_game(bad_ids)
    games = fetch_game_alt_vod_map(list(kill_to_game.values()))

    eligible_aligned = 0
    eligible_misaligned = 0
    no_alt_vod = 0
    no_offset = 0
    by_game: dict[str, int] = Counter()
    for kid in bad_ids:
        gid = kill_to_game.get(kid)
        if not gid:
            continue
        g = games.get(gid, {})
        by_game[g.get("external_id") or gid] += 1
        if not g.get("alt_vod_youtube_id"):
            no_alt_vod += 1
        elif g.get("vod_offset_seconds") is None:
            no_offset += 1
        elif g.get("vod_youtube_id") == g.get("alt_vod_youtube_id"):
            eligible_aligned += 1
        else:
            eligible_misaligned += 1

    print(f"  Eligible (aligned, ready)       : {eligible_aligned}  <-- run reclip_from_kc_replay.py")
    print(f"  Eligible after re-calibration   : {eligible_misaligned}  <-- need vod_youtube_id<-alt_vod_youtube_id flip + vof2 re-run")
    print(f"  Has alt_vod but no offset       : {no_offset}  <-- vof2 hasn't run yet")
    print(f"  No alt_vod (no KC Replay match) : {no_alt_vod}  <-- LFL/older/uncovered")

    print()
    print("Top 15 games by BAD-kill count:")
    for ext, n in by_game.most_common(15):
        # Find game info
        g = next((g for g in games.values() if g.get("external_id") == ext), {})
        alt = g.get("alt_vod_youtube_id")
        vod = g.get("vod_youtube_id")
        aligned = "ALIGNED" if (alt and vod == alt) else ("MISALIGN" if alt else "NO_ALT")
        print(f"  {n:>3} BAD  ext={ext[:25]:<25} {aligned}")


if __name__ == "__main__":
    main()
