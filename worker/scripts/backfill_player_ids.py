"""
BACKFILL — populate `kills.killer_player_id` and `kills.victim_player_id`.

Why
---
The Scroll Vivant grid uses `killer_player_id` as one of its pivot axes,
and the new clip-centric platform (<ClipReel filter={{ killerPlayerId }}/>)
needs it on every player page. The worker pipeline never set this column,
so all 340 published kills have it NULL.

How
---
Source of truth = `data/kc_matches.json` — for every game we know which
KC player played which champion. Combined with the kills table's
`killer_champion` / `victim_champion` and `tracked_team_involvement`
columns we can resolve each kill to a real player UUID:

    if tracked_team_involvement == 'team_killer':
        killer_champion was played by a KC player ->look up in JSON
    if tracked_team_involvement == 'team_victim':
        victim_champion was played by a KC player ->look up in JSON

Steps
-----
1. Ensure the KC team row exists, capture its UUID.
2. Walk the JSON, collect the union of distinct KC player names across
   every match in history (Canna, Yike, kyeahoo, Caliste, Busio, Saken,
   Targamas, Cabochard, Hantera, Rekkles, Vladi, …).
3. UPSERT each player into the `players` table — id deterministic from
   the cleaned IGN so re-runs are stable.
4. Build the resolver map: (game_external_id, champion) -> player_id.
5. For each published kill:
       - JOIN to its game's external_id
       - resolve killer / victim where the tracked team is involved
       - skip everything we can't resolve (opponents, name drift)
6. UPDATE the kill row only when at least one ID changes; print a summary.

Idempotent. Safe to re-run after every new match.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import uuid
from collections import defaultdict
from typing import Iterable

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

from services.supabase_client import safe_select, safe_update, safe_upsert  # noqa: E402

# --- Paths & constants ----------------------------------------------------

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir, os.pardir))
KC_MATCHES_JSON = os.path.join(REPO_ROOT, "data", "kc_matches.json")

# Stable namespace so the player UUIDs are deterministic across runs and
# re-creatable from scratch without breaking foreign keys.
PLAYER_UUID_NAMESPACE = uuid.UUID("8c4f6d6f-3f4d-4f8a-9e3b-9a6e6c2b4a10")

ROLE_NORMALIZE = {
    "top": "top",
    "jungle": "jungle",
    "mid": "mid",
    "bottom": "bottom",
    "adc": "bottom",
    "support": "support",
    "supp": "support",
}


def clean_player_name(raw: str) -> str:
    """Strip the 'KC ' prefix every player carries in the JSON."""
    raw = (raw or "").strip()
    for pref in ("KC ", "kc "):
        if raw.startswith(pref):
            return raw[len(pref):].strip()
    return raw


def player_uuid(ign: str) -> str:
    """Deterministic UUID from a player's cleaned IGN (case-insensitive)."""
    return str(uuid.uuid5(PLAYER_UUID_NAMESPACE, ign.lower()))


# --- Step 1 + 2: collect roster from JSON ---------------------------------

def is_kc_name(raw: str) -> bool:
    """The JSON's `kc_players` array sometimes contains the opposing team
    too (legacy / mis-tagged matches). Real KC entries always start with
    'KC ' (with a space). We use that as the strict gate."""
    raw = (raw or "").strip()
    return raw.startswith("KC ") or raw.startswith("kc ")


def collect_kc_roster(matches: Iterable[dict]) -> dict[str, dict]:
    """Returns {clean_ign: {ign, role, seen_count}} aggregated across all games.

    Only entries whose raw name starts with the 'KC ' prefix are kept; the
    rest are opponents that leaked into the kc_players array on a few
    matches and would otherwise pollute the players table with team_id=KC.
    """
    seen: dict[str, dict] = {}
    for m in matches:
        for g in m.get("games", []):
            for p in g.get("kc_players", []):
                raw = p.get("name", "")
                if not is_kc_name(raw):
                    continue
                ign = clean_player_name(raw)
                if not ign:
                    continue
                role = ROLE_NORMALIZE.get((p.get("role") or "").lower())
                e = seen.setdefault(ign, {"ign": ign, "role": role, "seen": 0})
                e["seen"] += 1
                # Prefer the most recent role assignment we encounter (the
                # JSON is roughly chronological so later writes win).
                if role:
                    e["role"] = role
    return seen


# --- Step 3: upsert players into the DB -----------------------------------

def upsert_players(roster: dict[str, dict], kc_team_id: str, dry_run: bool) -> dict[str, str]:
    """Returns {clean_ign: player_uuid} for everyone written / already present."""
    out: dict[str, str] = {}
    for ign, info in roster.items():
        pid = player_uuid(ign)
        out[ign] = pid
        payload = {
            "id": pid,
            "team_id": kc_team_id,
            "ign": ign,
            "role": info.get("role"),
        }
        if dry_run:
            print(f"  [dry] upsert player {ign:14s} role={info.get('role') or '?':<8s} id={pid}")
            continue
        safe_upsert("players", payload, on_conflict="id")
    return out


# --- Step 4: build the resolver map ---------------------------------------

def build_resolver(matches: Iterable[dict], ign_to_uuid: dict[str, str]) -> dict[tuple[str, str], str]:
    """Returns {(game_external_id, champion_lower): player_uuid}.

    Only KC entries (raw name starts with 'KC ') contribute — same gate
    as `collect_kc_roster` so we never resolve a kill to an opponent player
    we don't actually own.
    """
    resolver: dict[tuple[str, str], str] = {}
    for m in matches:
        for g in m.get("games", []):
            game_ext = str(g.get("id") or g.get("external_id") or "")
            if not game_ext:
                continue
            for p in g.get("kc_players", []):
                raw = p.get("name", "")
                if not is_kc_name(raw):
                    continue
                ign = clean_player_name(raw)
                champ = (p.get("champion") or "").strip()
                if not ign or not champ:
                    continue
                pid = ign_to_uuid.get(ign)
                if pid:
                    resolver[(game_ext, champ.lower())] = pid
    return resolver


# --- Step 5+6: walk kills, update those we can resolve --------------------

def backfill_kills(resolver: dict[tuple[str, str], str], dry_run: bool) -> None:
    games = safe_select("games", "id, external_id") or []
    game_id_to_external = {g["id"]: str(g.get("external_id") or "") for g in games}

    kills = safe_select(
        "kills",
        "id, game_id, killer_champion, victim_champion, tracked_team_involvement, "
        "killer_player_id, victim_player_id",
        status="published",
    ) or []

    stats = defaultdict(int)
    stats["total"] = len(kills)

    for k in kills:
        g_ext = game_id_to_external.get(k.get("game_id") or "", "")
        if not g_ext:
            stats["no_game_external"] += 1
            continue

        patch: dict[str, str] = {}

        involvement = (k.get("tracked_team_involvement") or "").lower()
        killer_champ = (k.get("killer_champion") or "").lower()
        victim_champ = (k.get("victim_champion") or "").lower()

        if involvement == "team_killer" and killer_champ and not k.get("killer_player_id"):
            pid = resolver.get((g_ext, killer_champ))
            if pid:
                patch["killer_player_id"] = pid
                stats["killer_resolved"] += 1
            else:
                stats["killer_unresolved"] += 1
        elif involvement == "team_victim" and victim_champ and not k.get("victim_player_id"):
            pid = resolver.get((g_ext, victim_champ))
            if pid:
                patch["victim_player_id"] = pid
                stats["victim_resolved"] += 1
            else:
                stats["victim_unresolved"] += 1
        elif involvement in {"team_assist", ""}:
            stats["skipped_involvement_unclear"] += 1
        else:
            stats["already_set_or_other"] += 1

        if not patch:
            continue

        if dry_run:
            stats["would_update"] += 1
            continue

        safe_update("kills", patch, "id", k["id"])
        stats["updated"] += 1

    print()
    print("-" * 60)
    print("BACKFILL SUMMARY")
    print("-" * 60)
    for k in sorted(stats.keys()):
        print(f"  {k:32s} {stats[k]}")


# --- Main -----------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="print plan without writing")
    args = parser.parse_args()

    print("->loading data/kc_matches.json")
    with open(KC_MATCHES_JSON, encoding="utf-8") as f:
        data = json.load(f)
    matches = data.get("matches") or []
    print(f"  {len(matches)} matches loaded")

    print("->resolving KC team UUID")
    teams = safe_select("teams", "id, code, is_tracked", code="KC") or []
    if not teams:
        print("  ERROR: no team with code='KC' in DB. Aborting.")
        return 1
    kc_team_id = teams[0]["id"]
    print(f"  KC team_id = {kc_team_id}")

    print("->collecting KC roster across all matches")
    roster = collect_kc_roster(matches)
    print(f"  {len(roster)} distinct KC players found")

    print("->upserting players")
    ign_to_uuid = upsert_players(roster, kc_team_id, args.dry_run)

    print("->building (game_external_id, champion) ->player_id resolver")
    resolver = build_resolver(matches, ign_to_uuid)
    print(f"  {len(resolver)} game/champion pairs in resolver")

    print("->backfilling kills")
    backfill_kills(resolver, args.dry_run)

    return 0


if __name__ == "__main__":
    sys.exit(main())
