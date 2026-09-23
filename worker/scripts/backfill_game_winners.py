# -*- coding: utf-8 -*-
"""
BACKFILL_GAME_WINNERS — remplit games.winner_team_id (et matches.winner_team_id
manquants) quand le résultat est CERTAIN, sans source externe fragile.

games.winner_team_id n'a jamais été rempli (0 / 700 au 23/09/2026) : le hero
de l'accueil ne pouvait pas afficher le score du dernier match depuis la base.
Règles, dans l'ordre (aucune valeur existante n'est écrasée) :

  1. match à une seule game (Bo1, et les « matchs » gol.gg qui sont des
     games) : vainqueur de la game = vainqueur du match ;
  2. match lolesports (id numérique) : getEventDetails donne les manches
     gagnées par équipe (gameWins) et les games jouées. Balayage (0 manche
     pour l'un) -> toutes les games jouées à l'autre ; sinon, la DERNIÈRE
     game jouée va au vainqueur de la série, les autres restent inconnues ;
     vainqueur du match déduit des manches s'il manquait.

Les games ambiguës (séries disputées) attendent une source par game
(Leaguepedia ScoreboardGames, limitée en débit le 23/09).

Usage :
  python scripts/backfill_game_winners.py            # rapport
  python scripts/backfill_game_winners.py --apply
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from dotenv import load_dotenv  # noqa: E402

load_dotenv()
from services import lolesports_api  # noqa: E402
from services.supabase_client import get_db  # noqa: E402


def fetch_all(db, table: str, params: dict) -> list[dict]:
    client, rows, off = db._get_client(), [], 0
    while True:
        r = client.get(f"{db.base}/{table}", params={**params, "limit": "1000", "offset": str(off), "order": "id.asc"})
        r.raise_for_status()
        page = r.json() or []
        rows += page
        if len(page) < 1000:
            return rows
        off += 1000


async def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    db = get_db()
    client = db._get_client()
    matches = fetch_all(db, "matches", {"select": "id,external_id,winner_team_id,team_blue_id,team_red_id,state"})
    games = fetch_all(db, "games", {"select": "id,match_id,external_id,game_number,winner_team_id"})
    teams = fetch_all(db, "teams", {"select": "id,code"})
    code_of = {t["id"]: (t.get("code") or "").upper() for t in teams}
    games_by_match: dict[str, list[dict]] = defaultdict(list)
    for g in games:
        games_by_match[g["match_id"]].append(g)

    game_patch: dict[str, str] = {}
    match_patch: dict[str, str] = {}
    why = Counter()
    for m in matches:
        gs = sorted(games_by_match.get(m["id"], []), key=lambda g: g.get("game_number") or 0)
        if not gs or m.get("state") != "completed":
            continue
        winner = m.get("winner_team_id")
        ext = m.get("external_id") or ""
        if not ext.isdigit():
            # « match » gol.gg = une game par construction
            if len(gs) == 1 and winner and not gs[0].get("winner_team_id"):
                game_patch[gs[0]["id"]] = winner
                why["golgg_une_game"] += 1
            elif len(gs) > 1:
                why["multi_sans_api"] += 1
            continue
        # match lolesports : toujours via l'API, même avec une seule game en
        # base (une série peut avoir des games manquantes chez nous)
        d = await lolesports_api.get_event_details(ext)
        mt = (d or {}).get("match") or {}
        # équipes de l'API -> les DEUX équipes du match, par code (la table
        # teams garde d'anciens ids lolesports, KC y figure même en double)
        ours = {code_of.get(m.get(k) or ""): m.get(k) for k in ("team_blue_id", "team_red_id") if m.get(k)}
        wins = {ours.get((t.get("code") or "").upper()): int(((t.get("result") or {}).get("gameWins")) or 0)
                for t in (mt.get("teams") or [])}
        wins.pop(None, None)
        played = {str(g.get("id")) for g in (mt.get("games") or []) if g.get("state") == "completed"}
        if len(wins) != 2 or not played:
            why["api_incomplet"] += 1
            continue
        (ta, wa), (tb, wb) = sorted(wins.items(), key=lambda kv: -kv[1])
        if wa == wb:
            why["egalite"] += 1
            continue
        if not winner:
            match_patch[m["id"]] = ta
            winner = ta
        elif winner != ta:
            why["contradiction_match"] += 1      # base et API divergent : on ne touche à rien
            continue
        played_rows = [g for g in gs if str(g.get("external_id")) in played]
        if wb == 0:
            for g in played_rows:
                if not g.get("winner_team_id"):
                    game_patch[g["id"]] = ta
                    why["balayage"] += 1
        elif played_rows:
            last = played_rows[-1]
            if not last.get("winner_team_id"):
                game_patch[last["id"]] = ta
                why["derniere_game"] += 1
            why["games_ambigues"] += len(played_rows) - 1

    print(f"games à remplir : {len(game_patch)} | matchs à compléter : {len(match_patch)} | {dict(why)}")
    if not args.apply:
        return
    done = 0
    for gid, tid in game_patch.items():
        r = client.patch(f"{db.base}/games", params={"id": f"eq.{gid}", "winner_team_id": "is.null"},
                         json={"winner_team_id": tid}, headers={**db.headers, "Prefer": "return=minimal"})
        done += r.status_code < 400
    for mid, tid in match_patch.items():
        client.patch(f"{db.base}/matches", params={"id": f"eq.{mid}", "winner_team_id": "is.null"},
                     json={"winner_team_id": tid}, headers={**db.headers, "Prefer": "return=minimal"})
    print(f"appliqué : {done} games, {len(match_patch)} matchs")


if __name__ == "__main__":
    asyncio.run(main())
