"""
Live probe: find a fresh LEC game_id whose livestats feed still has data,
then run the harvester against it end-to-end without touching any database.

Usage:
    python probe_harvester.py                  # auto-discover a fresh KC game
    python probe_harvester.py <game_id>        # probe a specific game_id
    python probe_harvester.py <game_id> blue   # force kc_side override

Prints: anchor timestamp, kc_side detection, kill count, first 5 kills.
Nothing is written — safe to run without any credentials.

The scheduler delay for livestats is monkey-patched down to 0.3s here so a
full 65-min walk runs in ~2 min instead of ~13. Production code is unchanged.
"""

from __future__ import annotations

import asyncio
import sys
from datetime import datetime, timezone, timedelta

# Make sure unicode output works on Windows cp1252 consoles
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

from scheduler import scheduler
scheduler.DELAYS["livestats"] = 0.3
scheduler.DELAYS["lolesports_idle"] = 0.3

from modules import harvester  # noqa: E402  — must come after monkey-patch
from services import livestats_api, lolesports_api  # noqa: E402


async def _window_is_fresh(game_id: str) -> bool:
    data = await livestats_api.get_window(game_id, starting_time=None)
    return bool((data or {}).get("frames"))


async def discover_fresh_game(prefer_kc: bool = True) -> tuple[str, str] | None:
    """Walk the LEC schedule newest-first and return the first completed game
    whose livestats window still returns data. Prefer KC matches when found."""
    events, _older = await lolesports_api.get_schedule()
    if not events:
        print("[probe] getSchedule returned no events")
        return None

    completed = [
        e for e in events
        if e.get("type") == "match" and e.get("state") == "completed"
    ]
    print(f"[probe] {len(completed)} completed matches in the first schedule page")

    cutoff = datetime.now(timezone.utc) - timedelta(days=21)

    def _is_kc_match(event: dict) -> bool:
        teams = (event.get("match") or {}).get("teams") or []
        return any(lolesports_api.is_kc(t) for t in teams)

    candidates: list[dict] = []
    for event in reversed(completed):  # newest first
        start = event.get("startTime", "")
        try:
            start_dt = datetime.fromisoformat(start.replace("Z", "+00:00"))
        except Exception:
            continue
        if start_dt < cutoff:
            continue
        candidates.append(event)

    if prefer_kc:
        kc_first = [e for e in candidates if _is_kc_match(e)]
        rest = [e for e in candidates if not _is_kc_match(e)]
        candidates = kc_first + rest
        print(f"[probe] {len(kc_first)} KC matches in window, plus {len(rest)} fallback matches")

    for event in candidates:
        match = event.get("match") or {}
        teams = match.get("teams") or []
        if len(teams) < 2:
            continue
        code_a = teams[0].get("code", "?")
        code_b = teams[1].get("code", "?")
        match_ext_id = match.get("id", "")
        if not match_ext_id:
            continue

        details = await lolesports_api.get_event_details(match_ext_id)
        if not details:
            continue
        detail_games = (details.get("match", {}) or {}).get("games", []) or []
        for g in detail_games:
            if g.get("state") != "completed":
                continue
            game_id = g.get("id", "")
            if not game_id:
                continue
            label = f"{code_a} vs {code_b} game {g.get('number', '?')} ({event.get('startTime', '')})"
            print(f"[probe] testing {game_id} — {label}")
            if await _window_is_fresh(game_id):
                print(f"[probe] FRESH feed found: {game_id}")
                return game_id, label

    return None


async def run_probe(game_id: str, label: str = "", forced_side: str | None = None):
    print()
    print("=" * 60)
    print(f"  Harvester live probe — {game_id}")
    if label:
        print(f"  {label}")
    if forced_side:
        print(f"  forced kc_side = {forced_side}")
    print("=" * 60)

    kills = await harvester.extract_kills_from_game(
        external_game_id=game_id,
        db_game_id="probe-fake-db-id",
        kc_side=forced_side,
    )

    print()
    print(f"  kills returned: {len(kills)}")
    for i, k in enumerate(kills[:10]):
        gt = k.game_time_seconds or 0
        mm = gt // 60
        ss = gt % 60
        tags = [k.tracked_team_involvement or "no-kc"]
        if k.multi_kill:
            tags.append(k.multi_kill)
        if k.is_first_blood:
            tags.append("first_blood")
        print(
            f"    {i+1:2d}. T+{mm:02d}:{ss:02d}  "
            f"{(k.killer_name or '?'):<20s} ({k.killer_champion}) -> "
            f"{(k.victim_name or '?'):<20s} ({k.victim_champion})  "
            f"[{', '.join(tags)}]"
        )
    if len(kills) > 10:
        print(f"    ...and {len(kills) - 10} more")
    print("=" * 60)
    print()
    return kills


async def main():
    if len(sys.argv) > 1:
        game_id = sys.argv[1]
        forced = sys.argv[2] if len(sys.argv) > 2 else None
        await run_probe(game_id, forced_side=forced)
        return

    found = await discover_fresh_game(prefer_kc=True)
    if not found:
        print("[probe] no fresh game found in recent schedule — try again later")
        sys.exit(1)
    game_id, label = found
    await run_probe(game_id, label)


if __name__ == "__main__":
    asyncio.run(main())
