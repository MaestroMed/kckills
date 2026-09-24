# -*- coding: utf-8 -*-
"""
REPAIR_MATCH_METADATA — complète les matchs créés sans métadonnées.

Un match inséré hors du sentinel (rattrapage Twitch, harvester lancé à la
main) n'a ni date, ni équipes, ni format, ni phase : il manque sur la frise
des ères (filtre par date), sur /matches (équipes) et dans le calcul des
vainqueurs. Cas réel au 24/09/2026 : les trois séries de playoffs du Summer
(GX, G2, MKOI), 283 kills publiés mais séries invisibles.

Sources : le calendrier lolesports (getSchedule, pages anciennes comprises)
pour la date, la phase et le format ; getEventDetails pour les équipes (ids
lolesports, résolus comme le fait le sentinel). Seuls les champs VIDES sont
écrits : rien d'existant n'est écrasé.

Ensuite, `scripts/backfill_game_winners.py --apply` remplit les vainqueurs.

Usage :
  python scripts/repair_match_metadata.py            # rapport
  python scripts/repair_match_metadata.py --apply
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from dotenv import load_dotenv  # noqa: E402

load_dotenv()
from modules.sentinel import _resolve_team_id  # noqa: E402
from services import league_config, lolesports_api  # noqa: E402
from services.supabase_client import get_db  # noqa: E402

MAX_PAGES_PER_LEAGUE = 15


def incomplete_matches(db) -> list[dict]:
    """Matchs lolesports (id numérique) à qui il manque date ou équipes."""
    r = db._get_client().get(f"{db.base}/matches", params={
        "select": "id,external_id,scheduled_at,team_blue_id,team_red_id,format,stage,state",
        "or": "(scheduled_at.is.null,team_blue_id.is.null,team_red_id.is.null)",
        "limit": "1000",
    })
    r.raise_for_status()
    return [m for m in (r.json() or []) if (m.get("external_id") or "").isdigit()]


async def find_events(wanted: set[str]) -> dict[str, dict]:
    """Événements du calendrier dont match.id est dans `wanted`, toutes
    ligues suivies confondues, en remontant les pages anciennes."""
    found: dict[str, dict] = {}
    for league in league_config.load_tracked_leagues():
        token = None
        for _ in range(MAX_PAGES_PER_LEAGUE):
            events, older = await lolesports_api.get_schedule(
                league_id=league.lolesports_league_id, page_token=token)
            for ev in events:
                mid = str(((ev.get("match") or {}).get("id")) or "")
                if mid in wanted and mid not in found:
                    found[mid] = ev
            if wanted <= found.keys() or not older:
                break
            token = older
        if wanted <= found.keys():
            break
    return found


def patch_for(m: dict, ev: dict | None, detail: dict | None) -> dict:
    """Champs vides de `m` remplissables depuis le calendrier et le détail."""
    patch: dict = {}
    if ev:
        if not m.get("scheduled_at") and ev.get("startTime"):
            patch["scheduled_at"] = ev["startTime"]
        if not m.get("stage") and ev.get("blockName"):
            patch["stage"] = ev["blockName"]
        count = ((((ev.get("match") or {}).get("strategy")) or {}).get("count"))
        if not m.get("format") and count:
            patch["format"] = f"bo{count}"
    teams = (((detail or {}).get("match") or {}).get("teams")) or \
            (((ev or {}).get("match") or {}).get("teams")) or []
    if len(teams) >= 2:
        # Même convention que le sentinel : teams[0] -> blue, teams[1] -> red.
        if not m.get("team_blue_id"):
            tid = _resolve_team_id(teams[0])
            if tid:
                patch["team_blue_id"] = tid
        if not m.get("team_red_id"):
            tid = _resolve_team_id(teams[1])
            if tid:
                patch["team_red_id"] = tid
    return patch


async def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    db = get_db()
    todo = incomplete_matches(db)
    print(f"matchs incomplets : {len(todo)}")
    if not todo:
        return
    events = await find_events({m["external_id"] for m in todo})
    client = db._get_client()
    headers = {**db.headers, "Prefer": "return=minimal"}
    applied = 0
    for m in todo:
        ext = m["external_id"]
        detail = await lolesports_api.get_event_details(ext)
        patch = patch_for(m, events.get(ext), detail)
        print(f"  {ext} : {'calendrier' if ext in events else 'absent du calendrier'} -> {patch or 'rien à remplir'}")
        if args.apply and patch:
            # garde-fou : on n'écrit que si chaque champ est resté tel qu'on
            # l'a lu (NULL ou chaîne vide), jamais par-dessus une valeur
            params = {"id": f"eq.{m['id']}"}
            for col in patch:
                params[col] = "is.null" if m.get(col) is None else f"eq.{m.get(col)}"
            r = client.patch(f"{db.base}/matches", params=params, json=patch, headers=headers)
            applied += r.status_code < 400
    if args.apply:
        print(f"appliqué : {applied} matchs. Étape suivante : scripts/backfill_game_winners.py --apply")


if __name__ == "__main__":
    asyncio.run(main())
