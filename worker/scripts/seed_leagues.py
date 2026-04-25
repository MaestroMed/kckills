"""
seed_leagues.py — One-shot upsert of every major Riot pro circuit
into the `leagues` catalog table (migration 043).

The worker's multi-league sentinel reads this table at boot to know
which competitions to scan. Without seeding, the table is empty and
the sentinel falls back to its built-in LEC default — which is fine
for the KC pilot but blocks the LoLTok rewrite from going beyond LEC.

Workflow :
    1. Hit lolesports' getLeagues to fetch the canonical numeric ids
       for every league (so we never hardcode a stale id).
    2. For each entry in SEEDS below, look up the matching getLeagues
       row by slug (case-insensitive) and, if found, take its
       lolesports_league_id ; otherwise fall back to the static
       league_id_lookup map (which itself was filled from the same
       getLeagues snapshot).
    3. UPSERT each league row by `slug` (idempotent — safe to rerun).

Run it after applying migration 043 :
    python worker/scripts/seed_leagues.py

The script logs every insert / update / skip so you can audit the
diff post-seed.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

# Add worker root to PYTHONPATH so `services.*` imports resolve when
# the script is invoked directly (python scripts/seed_leagues.py).
_WORKER_ROOT = Path(__file__).resolve().parent.parent
if str(_WORKER_ROOT) not in sys.path:
    sys.path.insert(0, str(_WORKER_ROOT))


# ─── The 13 leagues we ship with PR-loltok BB ─────────────────────
#
# Priority assignment :
#   10  → LEC          (KC home league — always poll first)
#   20  → LCS          (Americas tier-1)
#   30  → LCK          (Korea tier-1)
#   40  → LPL          (China tier-1)
#   50  → First Stand  (international intra-season tournament)
#   60  → MSI          (international mid-season tournament)
#   70  → Worlds       (international end-of-year tournament)
#   80  → EMEA Masters (top ERL playoff)
#   100 → LFL          (French ERL — KC's roots)
#   110 → NLC          (Northern Europe ERL)
#   120 → LCO          (Oceania)
#   130 → LCL          (CIS)
#   140 → EBL          (Belgium / Ultraliga family)
SEEDS: list[dict] = [
    {
        "slug": "lec",
        "name": "LoL EMEA Championship",
        "short_name": "LEC",
        "region": "EMEA",
        "leaguepedia_name": "LEC",
        "golgg_tournament_pattern": "LEC%20{year}%20{split}",
        "priority": 10,
    },
    {
        "slug": "lcs",
        "name": "League Championship Series",
        "short_name": "LCS",
        "region": "Americas",
        "leaguepedia_name": "LCS",
        "golgg_tournament_pattern": "LCS%20{year}%20{split}",
        "priority": 20,
    },
    {
        "slug": "lck",
        "name": "LoL Champions Korea",
        "short_name": "LCK",
        "region": "Korea",
        "leaguepedia_name": "LCK",
        "golgg_tournament_pattern": "LCK%20{year}%20{split}",
        "priority": 30,
    },
    {
        "slug": "lpl",
        "name": "LoL Pro League",
        "short_name": "LPL",
        "region": "China",
        "leaguepedia_name": "LPL",
        "golgg_tournament_pattern": "LPL%20{year}%20{split}",
        "priority": 40,
    },
    {
        "slug": "first_stand",
        "name": "First Stand",
        "short_name": "First Stand",
        "region": "International",
        "leaguepedia_name": "First_Stand",
        "golgg_tournament_pattern": "First%20Stand%20{year}",
        "priority": 50,
    },
    {
        "slug": "msi",
        "name": "Mid-Season Invitational",
        "short_name": "MSI",
        "region": "International",
        "leaguepedia_name": "Mid-Season_Invitational",
        "golgg_tournament_pattern": "MSI%20{year}",
        "priority": 60,
    },
    {
        "slug": "worlds",
        "name": "World Championship",
        "short_name": "Worlds",
        "region": "International",
        "leaguepedia_name": "Season_World_Championship",
        "golgg_tournament_pattern": "Worlds%20{year}",
        "priority": 70,
    },
    {
        "slug": "emea_masters",
        "name": "EMEA Masters",
        "short_name": "EMEA Masters",
        "region": "EMEA",
        "leaguepedia_name": "EMEA_Masters",
        "golgg_tournament_pattern": "EM%20{year}%20{split}",
        "priority": 80,
    },
    {
        "slug": "lfl",
        "name": "La Ligue Française",
        "short_name": "LFL",
        "region": "EMEA",
        "leaguepedia_name": "La_Ligue_Française",
        "golgg_tournament_pattern": "LFL%20{year}%20{split}",
        "priority": 100,
    },
    {
        "slug": "nlc",
        "name": "Northern League of Legends Championship",
        "short_name": "NLC",
        "region": "EMEA",
        "leaguepedia_name": "NLC",
        "golgg_tournament_pattern": "NLC%20{year}%20{split}",
        "priority": 110,
    },
    {
        "slug": "lco",
        "name": "LoL Circuit Oceania",
        "short_name": "LCO",
        "region": "Oceania",
        "leaguepedia_name": "LCO",
        "golgg_tournament_pattern": "LCO%20{year}%20{split}",
        "priority": 120,
    },
    {
        "slug": "lcl",
        "name": "League Champions League",
        "short_name": "LCL",
        "region": "CIS",
        "leaguepedia_name": "LCL",
        "golgg_tournament_pattern": "LCL%20{year}%20{split}",
        "priority": 130,
    },
    {
        "slug": "ebl",
        "name": "Elite Series",
        "short_name": "EBL",
        "region": "EMEA",
        "leaguepedia_name": "Elite_Series",
        "golgg_tournament_pattern": "ES%20{year}%20{split}",
        "priority": 140,
    },
]


def _index_by_slug(api_leagues: list[dict]) -> dict[str, dict]:
    """Index getLeagues output by slug for fast SEED lookup.

    Riot's slugs are lowercase short codes ("lec", "lcs"…) but a few
    leagues use a different shape ("emea_masters", "first_stand"). We
    fall back to fuzzy match on `name` if the slug doesn't hit.
    """
    by_slug: dict[str, dict] = {}
    for entry in api_leagues:
        slug = (entry.get("slug") or "").strip().lower()
        if slug:
            by_slug[slug] = entry
    return by_slug


def _resolve_lolesports_id(
    seed: dict,
    api_by_slug: dict[str, dict],
    api_leagues: list[dict],
) -> str | None:
    """Find the numeric leagueId for one SEED entry.

    Priority order :
      1. Exact slug match in getLeagues output.
      2. Fuzzy match on name (case-insensitive substring).
      3. Static fallback in services.league_id_lookup._FALLBACK_IDS.
    """
    from services import league_id_lookup

    slug = seed["slug"]
    # 1. exact slug
    entry = api_by_slug.get(slug)
    if entry and entry.get("id"):
        return str(entry["id"])

    # 2. fuzzy on name
    needle = (seed["name"] or "").lower()
    for entry in api_leagues:
        name = (entry.get("name") or "").lower()
        if needle and needle in name:
            return str(entry.get("id") or "") or None

    # 3. static fallback
    return league_id_lookup.slug_to_lolesports_id(slug)


async def _fetch_api_catalog() -> list[dict]:
    """Hit lolesports getLeagues. Empty list on failure (we still
    fall back to the static map)."""
    try:
        from services import lolesports_api
        return await lolesports_api.get_leagues_index(force_refresh=True)
    except Exception as e:
        print(f"[warn] getLeagues unreachable: {e}")
        return []


def _upsert_one(seed: dict, lolesports_id: str | None) -> str:
    """UPSERT one leagues row. Returns 'inserted' / 'updated' / 'skipped'."""
    try:
        from services.supabase_client import safe_select, safe_upsert
    except Exception as e:
        print(f"[warn] supabase_client unavailable: {e}")
        return "skipped"

    payload = {
        "slug": seed["slug"],
        "name": seed["name"],
        "short_name": seed["short_name"],
        "region": seed["region"],
        "lolesports_league_id": lolesports_id,
        "leaguepedia_name": seed.get("leaguepedia_name"),
        "golgg_tournament_pattern": seed.get("golgg_tournament_pattern"),
        "priority": seed.get("priority", 100),
        "active": True,
    }
    # Strip None to avoid clobbering existing values when a column is
    # already populated.
    payload = {k: v for k, v in payload.items() if v is not None}

    existed_before = bool(safe_select("leagues", "slug", slug=seed["slug"]))
    row = safe_upsert("leagues", payload, on_conflict="slug")
    if row is None:
        return "skipped"
    return "updated" if existed_before else "inserted"


async def main_async() -> int:
    print("=" * 60)
    print("  seed_leagues — populating the leagues catalog (PR-loltok BB)")
    print("=" * 60)

    api_leagues = await _fetch_api_catalog()
    api_by_slug = _index_by_slug(api_leagues)
    print(f"[catalog] getLeagues returned {len(api_leagues)} entries.")

    inserted = updated = skipped = 0
    missing_id: list[str] = []

    for seed in SEEDS:
        lid = _resolve_lolesports_id(seed, api_by_slug, api_leagues)
        if not lid:
            missing_id.append(seed["slug"])
        result = _upsert_one(seed, lid)
        marker = {
            "inserted": "[+]",
            "updated":  "[~]",
            "skipped":  "[!]",
        }.get(result, "[?]")
        print(
            f"  {marker} {seed['slug']:<14}"
            f" lolesports_id={lid or '(none)':<22}"
            f" priority={seed.get('priority', 100):>3}"
            f" -> {result}"
        )
        if result == "inserted":
            inserted += 1
        elif result == "updated":
            updated += 1
        else:
            skipped += 1

    print()
    print(
        f"[done] inserted={inserted} updated={updated} "
        f"skipped={skipped} total_seed={len(SEEDS)}"
    )
    if missing_id:
        print(
            f"[warn] {len(missing_id)} league(s) missing a "
            f"lolesports_league_id (will be skipped by sentinel): "
            f"{', '.join(missing_id)}"
        )
    return 0 if skipped == 0 else 1


def main() -> None:
    rc = asyncio.run(main_async())
    sys.exit(rc)


if __name__ == "__main__":
    main()
