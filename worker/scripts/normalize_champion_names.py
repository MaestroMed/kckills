# -*- coding: utf-8 -*-
"""
NORMALIZE_CHAMPION_NAMES — une seule graphie par champion dans kills.

Le feed lolesports écrit les clés Data Dragon (MonkeyKing, Khazix, Leblanc,
Renata, Velkoz, KSante…) ; l'import gol.gg écrivait les noms d'affichage
concaténés (Wukong, KhaZix, LeBlanc, RenataGlasc, VelKoz, KSante…). Un même
champion était donc compté sous deux noms (pages champion, grille, recherche,
statistiques). Le web contourne pour les IMAGES (ddragonKey), pas pour les
regroupements.

Règle : la graphie canonique est celle du feed (clé Data Dragon), choisie par
clé normalisée (lettres minuscules) ; seules les graphies qui diffèrent sont
réécrites, sur killer_champion / victim_champion. Les rows à event_epoch 0
(gol.gg) ne sont pas dans l'index unique sémantique : aucun risque de 23505.

Usage :
  python scripts/normalize_champion_names.py           # rapport
  python scripts/normalize_champion_names.py --apply
"""
from __future__ import annotations

import argparse
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from dotenv import load_dotenv  # noqa: E402

load_dotenv()
from services.supabase_client import get_db  # noqa: E402

# graphies d'affichage -> clé Data Dragon quand le nom strippé diffère
ALIASES = {"wukong": "monkeyking", "renataglasc": "renata", "nunuwillump": "nunu"}
TEST_NAMES = {"probekill", "probevictim", "test1", "test2"}


def norm(name: str) -> str:
    k = re.sub(r"[^a-z0-9]", "", (name or "").lower())
    return ALIASES.get(k, k)


def fetch_all(db, params: dict) -> list[dict]:
    client, rows, off = db._get_client(), [], 0
    while True:
        r = client.get(f"{db.base}/kills", params={**params, "limit": "1000", "offset": str(off), "order": "id.asc"})
        r.raise_for_status()
        page = r.json() or []
        rows += page
        if len(page) < 1000:
            return rows
        off += 1000


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    db = get_db()
    rows = fetch_all(db, {"select": "id,event_epoch,killer_champion,victim_champion"})
    # graphie canonique = la plus fréquente chez les rows du feed (event_epoch > 0)
    feed_names: dict[str, Counter] = defaultdict(Counter)
    for r in rows:
        if (r.get("event_epoch") or 0) > 0:
            for col in ("killer_champion", "victim_champion"):
                if r.get(col):
                    feed_names[norm(r[col])][r[col]] += 1
    canonical = {k: c.most_common(1)[0][0] for k, c in feed_names.items()}
    changes: dict[tuple[str, str], list[str]] = defaultdict(list)   # (col, canon) -> ids
    variants = Counter()
    for r in rows:
        if (r.get("event_epoch") or 0) > 0:
            continue    # rows du feed : déjà canoniques, et dans l'index unique sémantique
        for col in ("killer_champion", "victim_champion"):
            name = r.get(col)
            if not name or norm(name) in TEST_NAMES:
                continue
            canon = canonical.get(norm(name))
            if canon and canon != name:
                changes[(col, canon)].append(r["id"])
                variants[f"{name} -> {canon}"] += 1
    total = sum(len(v) for v in changes.values())
    print(f"{total} valeurs à réécrire")
    for v, n in variants.most_common(40):
        print(f"  {n:5d}  {v}")
    if not args.apply or not total:
        return
    client = db._get_client()
    done = 0
    for (col, canon), ids in changes.items():
        for i in range(0, len(ids), 80):
            chunk = ids[i:i + 80]
            r = client.patch(f"{db.base}/kills", params={"id": f"in.({','.join(chunk)})"}, json={col: canon},
                             headers={**db.headers, "Prefer": "return=minimal"})
            if r.status_code < 400:
                done += len(chunk)
            else:
                print("  échec", col, canon, r.status_code, r.text[:160])
    print(f"réécrites : {done}/{total}")


if __name__ == "__main__":
    main()
