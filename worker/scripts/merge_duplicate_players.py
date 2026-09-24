# -*- coding: utf-8 -*-
"""
MERGE_DUPLICATE_PLAYERS — fusionne les joueurs KC présents en double
(même IGN à la casse près : « kyeahoo » officiel + « Kyeahoo » gol.gg,
« Saken » + « SAKEN »).

Pourquoi : chaque doublon coupe les stats d'un joueur en deux (page joueur,
grille « Qui tue qui », classements) et la recherche par IGN (ilike + limit 1)
pouvait tomber sur la mauvaise ligne. Constat du 24/09/2026 : kyeahoo avait
925 kills sur la ligne officielle et 189 sur la ligne gol.gg.

Règles :
  - ligne canonique = id lolesports (numérique) > rôle renseigné > photo >
    le plus de kills référencés ;
  - toutes les références passent sur la canonique : kills (tueur, victime),
    game_events (acteur, cible), game_participants, player_follows,
    player_champion_stats ; le rôle / la photo manquants sont recopiés ;
  - le doublon n'est JAMAIS supprimé : il est détaché de l'équipe
    (team_id NULL) et renommé « <ign> [fusionné] » pour que plus aucune
    recherche par IGN ne le trouve ;
  - journal complet (ids modifiés) dans D:\\kckills_worker\\logs pour
    pouvoir revenir en arrière.

Usage :
  python scripts/merge_duplicate_players.py            # rapport
  python scripts/merge_duplicate_players.py --apply
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from dotenv import load_dotenv  # noqa: E402

load_dotenv()
from services.supabase_client import get_db  # noqa: E402

REFS = [  # (table, colonne)
    ("kills", "killer_player_id"),
    ("kills", "victim_player_id"),
    ("game_events", "primary_actor_player_id"),
    ("game_events", "primary_target_player_id"),
    ("game_participants", "player_id"),
    ("player_follows", "player_id"),
    ("player_champion_stats", "player_id"),
]
LOG_DIR = Path(r"D:\kckills_worker\logs")


def ids_referencing(client, base, table, col, pid) -> list[str] | None:
    """ids des lignes de `table` qui pointent sur `pid` (None si la table
    n'existe pas / pas de colonne id exploitable)."""
    out, off = [], 0
    while True:
        r = client.get(f"{base}/{table}", params={"select": "id", col: f"eq.{pid}", "limit": "1000", "offset": str(off)})
        if r.status_code >= 400:
            return None
        page = r.json() or []
        out += [x["id"] for x in page]
        if len(page) < 1000:
            return out
        off += 1000


def canonical_key(p: dict, refcount: int):
    ext = p.get("external_id") or ""
    # id lolesports d'abord, puis la ligne qui porte les données : on ne
    # déplace jamais des milliers de références vers un doublon vide.
    return (ext.isdigit(), refcount, bool(p.get("role")), bool(p.get("image_url")))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    db = get_db()
    client = db._get_client()
    headers = {**db.headers, "Prefer": "return=minimal"}
    tracked = client.get(f"{db.base}/teams", params={"select": "id", "is_tracked": "eq.true"}).json()
    team_ids = [t["id"] for t in tracked]
    players = client.get(f"{db.base}/players", params={
        "select": "id,ign,role,image_url,external_id,team_id", "team_id": f"in.({','.join(team_ids)})"}).json()
    groups = defaultdict(list)
    for p in players:
        groups[(p["ign"] or "").strip().lower()].append(p)

    journal = {"started": time.strftime("%Y-%m-%d %H:%M:%S"), "apply": args.apply, "merges": []}
    for key, rows in groups.items():
        if len(rows) < 2 or not key:
            continue
        refs = {p["id"]: {f"{t}.{c}": ids_referencing(client, db.base, t, c, p["id"]) for t, c in REFS} for p in rows}
        count = {pid: sum(len(v or []) for v in r.values()) for pid, r in refs.items()}
        rows.sort(key=lambda p: canonical_key(p, count[p["id"]]), reverse=True)
        canon, dups = rows[0], rows[1:]
        for dup in dups:
            moved = {k: v for k, v in refs[dup["id"]].items() if v}
            print(f"{dup['ign']} ({dup['id'][:8]}, {count[dup['id']]} réf.) -> {canon['ign']} ({canon['id'][:8]}) : "
                  + ", ".join(f"{k}={len(v)}" for k, v in moved.items()) or "aucune référence")
            entry = {"canonical": canon["id"], "duplicate": dup["id"], "duplicate_row": dup, "moved": moved}
            journal["merges"].append(entry)
            if not args.apply:
                continue
            for (table, col) in REFS:
                ids = refs[dup["id"]].get(f"{table}.{col}") or []
                for i in range(0, len(ids), 150):
                    chunk = ids[i:i + 150]
                    r = client.patch(f"{db.base}/{table}", params={"id": f"in.({','.join(chunk)})", col: f"eq.{dup['id']}"},
                                     json={col: canon["id"]}, headers=headers)
                    if r.status_code >= 400:
                        raise SystemExit(f"{table}.{col} : {r.status_code} {r.text[:200]}")
            fill = {k: dup[k] for k in ("role", "image_url") if dup.get(k) and not canon.get(k)}
            if fill:
                client.patch(f"{db.base}/players", params={"id": f"eq.{canon['id']}"}, json=fill, headers=headers)
            client.patch(f"{db.base}/players", params={"id": f"eq.{dup['id']}"},
                         json={"team_id": None, "ign": f"{dup['ign']} [fusionné]"}, headers=headers)
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    path = LOG_DIR / f"merge_duplicate_players_{time.strftime('%Y%m%d_%H%M%S')}.json"
    path.write_text(json.dumps(journal, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(journal['merges'])} fusion(s) {'appliquée(s)' if args.apply else 'prévue(s)'} — journal {path}")


if __name__ == "__main__":
    main()
