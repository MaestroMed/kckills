# -*- coding: utf-8 -*-
"""
DEDUP_CROSS_GAME — une même game réelle importée DEUX fois (gol.gg + feed
lolesports), donc chaque kill publié en double sur le site.

modules/dedup.py compare deux sources à l'intérieur d'UNE ligne `games`.
Ici la game existe en deux lignes distinctes (ex. MSI 2026 : golgg_game_79531
et 115570934355614504) : le dédoublonnage par game ne pouvait pas les voir.

  1. games appariées par leur draft : ensemble des champions vus dans les
     kills (Jaccard ≥ 0,8, meilleur candidat unique) ;
  2. kills appariés par (tueur, victime) dans l'ordre chronologique de
     chaque source, après correction du décalage médian entre sources
     (le temps gol.gg est un chrono, le temps livestats du temps réel) ;
  3. un seul gardien par paire : publié > engagement (notes + commentaires)
     > row livestats (instant exact) > kill visible > meilleur score ;
     l'autre est NEUTRALISÉ comme dans backfill_au_crible (status
     'duplicate', is_duplicate_of, publication retirée, game_event bloqué).
     JAMAIS de delete.

Usage :
  python scripts/dedup_cross_game.py            # rapport seulement
  python scripts/dedup_cross_game.py --apply
"""
from __future__ import annotations

import argparse
import json
import os
import re
import statistics
import sys
import time
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from dotenv import load_dotenv  # noqa: E402

load_dotenv()
from services.supabase_client import get_db  # noqa: E402

KILL_COLS = ("id,game_id,event_epoch,game_time_seconds,killer_champion,victim_champion,status,"
             "multi_kill,clip_url_vertical,killer_player_id,highlight_score,created_at,"
             "rating_count,comment_count,kill_visible,data_source,publication_status")
MIN_JACCARD = 0.8
MIN_CHAMPIONS = 6
PAIR_TOLERANCE_S = 25         # même (tueur, victime), après décalage LOCAL
VICTIM_TOLERANCE_S = 15       # 2e passe : même victime, décalage local
REPORT_DIR = Path(r"D:\kckills_worker\dedup_cross_game")


def fetch_all(db, table: str, select: str, **filters) -> list[dict]:
    client, rows, offset = db._get_client(), [], 0
    while True:
        r = client.get(f"{db.base}/{table}", params={"select": select, "limit": "1000",
                                                      "offset": str(offset), "order": "id.asc", **filters})
        r.raise_for_status()
        page = r.json() or []
        rows.extend(page)
        if len(page) < 1000:
            return rows
        offset += 1000


def is_live_row(k: dict) -> bool:
    return (k.get("event_epoch") or 0) > 0


def t_of(k: dict) -> float:
    return float(k.get("game_time_seconds") or 0)


# Graphies différentes selon la source (gol.gg « Wukong », « KhaZix »,
# « RenataGlasc » ; feed « MonkeyKing », « Khazix », « Renata ») : on compare
# des clés normalisées (lettres minuscules + alias Data Dragon).
_ALIASES = {"wukong": "monkeyking", "renataglasc": "renata", "nunuwillump": "nunu"}
TEST_CHAMPIONS = {"probekill", "probevictim", "test1", "test2"}


def champ_key(name: str | None) -> str:
    k = re.sub(r"[^a-z0-9]", "", (name or "").lower())
    return _ALIASES.get(k, k)


def champions(kills: list[dict]) -> set[str]:
    out = set()
    for k in kills:
        for c in (k.get("killer_champion"), k.get("victim_champion")):
            if c:
                out.add(champ_key(c))
    return out


def pair_games(golgg: dict[str, list[dict]], others: dict[str, list[dict]]) -> list[tuple[str, str, float]]:
    """(game gol.gg, game jumelle, jaccard) — meilleur candidat unique."""
    sets = {gid: champions(ks) for gid, ks in others.items()}
    out = []
    for gid, ks in golgg.items():
        cs = champions(ks)
        if len(cs) < MIN_CHAMPIONS:
            continue
        scored = sorted(((len(cs & s) / len(cs | s), oid) for oid, s in sets.items() if s), reverse=True)
        if not scored or scored[0][0] < MIN_JACCARD:
            continue
        if len(scored) > 1 and scored[1][0] >= scored[0][0] - 0.15:
            continue        # ambigu (même draft ailleurs ?) : on ne touche pas
        out.append((gid, scored[0][1], round(scored[0][0], 3)))
    return out


def _local_offset(anchors: list[tuple[float, float]], t: float, default: float) -> float:
    """Décalage (source b - source a) au voisinage de t : médiane des 3
    ancres les plus proches (une pause décale les horloges en escalier)."""
    if not anchors:
        return default
    near = sorted(anchors, key=lambda av: abs(av[0] - t))[:3]
    return statistics.median(d for _, d in near)


def pair_kills(a: list[dict], b: list[dict], fixed: list[tuple[dict, dict]] | None = None
               ) -> tuple[list[tuple[dict, dict]], list[dict], list[dict]]:
    """Paires (row de a, row de b) du même kill ; + orphelins de chaque côté.

    `fixed` : paires déjà neutralisées lors d'un passage précédent — elles
    servent d'ANCRES de décalage et leurs deux rows ne sont jamais
    réappariées (sans ça, un 2e passage force des paires entre kills
    distincts restés seuls de chaque côté).

    1. ancres : paires fixées + couples (tueur, victime) uniques des deux
       côtés dont l'écart est cohérent avec la médiane (±40 s) ;
    2. même (tueur, victime) à ±PAIR_TOLERANCE_S du décalage LOCAL ;
    3. même victime à ±VICTIM_TOLERANCE_S (attribution du kill différente
       selon la source dans un teamfight ; une victime ne meurt pas deux
       fois en 15 s)."""
    fixed = fixed or []
    taken = {x["id"] for pair in fixed for x in pair}
    a = [k for k in a if k["id"] not in taken]
    b = [k for k in b if k["id"] not in taken]

    def key(k):
        return champ_key(k.get("killer_champion")), champ_key(k.get("victim_champion"))
    by_key_a, by_key_b = defaultdict(list), defaultdict(list)
    for k in a:
        by_key_a[key(k)].append(k)
    for k in b:
        by_key_b[key(k)].append(k)
    anchors = [(t_of(x), t_of(y) - t_of(x)) for x, y in fixed]
    boot = sorted((t_of(by_key_a[kk][0]), t_of(by_key_b[kk][0]) - t_of(by_key_a[kk][0]))
                  for kk in by_key_a if len(by_key_a[kk]) == 1 and len(by_key_b.get(kk, [])) == 1)
    # Une pause décale les horloges en ESCALIER : on garde une ancre si au
    # moins une de ses voisines dans le temps (±2) donne le même écart
    # (±25 s). Une ancre isolée (couple unique mais kills distincts) saute.
    good = []
    for i, (t, d) in enumerate(boot):
        neigh = [boot[j][1] for j in (i - 2, i - 1, i + 1, i + 2) if 0 <= j < len(boot)]
        if any(abs(x - d) <= 25 for x in neigh):
            good.append((t, d))
    anchors += good
    ref = [d for _, d in anchors] or [d for _, d in boot]
    median = statistics.median(ref) if ref else 0.0

    pairs: list[tuple[dict, dict]] = []
    used_a: set[str] = set()
    used_b: set[str] = set()
    cands = []
    for kk, ka in by_key_a.items():
        for x in ka:
            off = _local_offset(anchors, t_of(x), median)
            for y in by_key_b.get(kk, []):
                dist = abs(t_of(y) - off - t_of(x))
                if dist <= PAIR_TOLERANCE_S:
                    cands.append((dist, x, y))
    for _, x, y in sorted(cands, key=lambda c: c[0]):
        if x["id"] in used_a or y["id"] in used_b:
            continue
        used_a.add(x["id"])
        used_b.add(y["id"])
        pairs.append((x, y))
    anchors += [(t_of(x), t_of(y) - t_of(x)) for x, y in pairs]
    cands2 = []
    for x in (k for k in a if k["id"] not in used_a):
        off = _local_offset(anchors, t_of(x), median)
        for y in (k for k in b if k["id"] not in used_b):
            if champ_key(x.get("victim_champion")) != champ_key(y.get("victim_champion")):
                continue
            dist = abs(t_of(y) - off - t_of(x))
            if dist <= VICTIM_TOLERANCE_S:
                cands2.append((dist, x, y))
    for _, x, y in sorted(cands2, key=lambda c: c[0]):
        if x["id"] in used_a or y["id"] in used_b:
            continue
        used_a.add(x["id"])
        used_b.add(y["id"])
        pairs.append((x, y))
    return pairs, [k for k in a if k["id"] not in used_a], [k for k in b if k["id"] not in used_b]


def keeper_key(k: dict):
    return (
        k.get("status") != "published",
        -((k.get("rating_count") or 0) + (k.get("comment_count") or 0)),
        not is_live_row(k),
        k.get("kill_visible") is False,
        k.get("clip_url_vertical") is None,
        -(k.get("highlight_score") or 0),
        k.get("created_at") or "",
    )


def patch_in(db, table: str, ids: list[str], body: dict, key: str = "id") -> bool:
    client, ok = db._get_client(), True
    for i in range(0, len(ids), 80):
        chunk = ids[i:i + 80]
        r = client.patch(f"{db.base}/{table}", params={key: f"in.({','.join(chunk)})"}, json=body,
                         headers={**db.headers, "Prefer": "return=minimal"})
        if r.status_code >= 400:
            print(f"  PATCH {table} échoué ({r.status_code}) : {r.text[:200]}")
            ok = False
    return ok


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--rollback", default=None, help="rapport JSON d'un --apply : restaure les statuts d'origine")
    args = ap.parse_args()
    db = get_db()
    if args.rollback:
        rep = json.loads(Path(args.rollback).read_text(encoding="utf-8"))
        groups: dict[tuple, list[str]] = defaultdict(list)
        for r in rep.get("rollback") or []:
            groups[(r["status"], r.get("publication_status"))].append(r["id"])
        for (st, pub), ids in groups.items():
            patch_in(db, "kills", ids, {"status": st, "is_duplicate_of": None, "publication_status": pub})
            # qc_human_approved=FALSE rend l'événement non publiable : le démon
            # (event_publisher) dépublierait le kill restauré. NULL = « pas revu ».
            patch_in(db, "game_events", ids, {"qc_human_approved": None, "publish_blocked_reason": None},
                     key="kill_id")
        print(f"restaurés : {sum(len(v) for v in groups.values())}")
        return
    games = fetch_all(db, "games", "id,external_id,match_id,game_number")
    ext = {g["id"]: g.get("external_id") or "" for g in games}
    all_kills = [k for k in fetch_all(db, "kills", KILL_COLS + ",is_duplicate_of")
                 if champ_key(k.get("killer_champion")) not in TEST_CHAMPIONS
                 and champ_key(k.get("victim_champion")) not in TEST_CHAMPIONS]
    by_id = {k["id"]: k for k in all_kills}
    all_by_game: dict[str, list[dict]] = defaultdict(list)
    for k in all_kills:
        all_by_game[k["game_id"]].append(k)
    kills = [k for k in all_kills if k.get("status") != "duplicate"]
    by_game: dict[str, list[dict]] = defaultdict(list)
    for k in kills:
        by_game[k["game_id"]].append(k)
    # appariement des games sur TOUTES leurs rows (stable d'un passage à l'autre)
    golgg_all = {gid: ks for gid, ks in all_by_game.items() if ext.get(gid, "").startswith("golgg_")}
    others_all = {gid: ks for gid, ks in all_by_game.items() if not ext.get(gid, "").startswith("golgg_")}
    game_pairs = pair_games(golgg_all, others_all)
    golgg = {gid: by_game.get(gid, []) for gid in golgg_all}
    others = {gid: by_game.get(gid, []) for gid in others_all}

    plan, report = [], {"generated": time.strftime("%Y-%m-%d %H:%M:%S"), "apply": args.apply, "games": []}
    for g_id, o_id, jac in game_pairs:
        # paires déjà neutralisées entre ces deux games (passage précédent)
        g_ids = {k["id"] for k in golgg_all[g_id]}
        o_ids = {k["id"] for k in others_all[o_id]}
        fixed = []
        for k in golgg_all[g_id] + others_all[o_id]:
            other = by_id.get(k.get("is_duplicate_of") or "")
            if k.get("status") == "duplicate" and other:
                if k["id"] in g_ids and other["id"] in o_ids:
                    fixed.append((k, other))
                elif k["id"] in o_ids and other["id"] in g_ids:
                    fixed.append((other, k))
        pairs, orph_g, orph_o = pair_kills(golgg[g_id], others[o_id], fixed)
        both_pub = sum(1 for x, y in pairs if x.get("status") == "published" and y.get("status") == "published")
        rep = {"golgg_game": ext[g_id], "twin_game": ext[o_id], "jaccard": jac, "pairs": len(pairs),
               "both_published": both_pub, "orphans_golgg": len(orph_g), "orphans_twin": len(orph_o),
               "neutralize": []}
        for x, y in pairs:
            keep, drop = sorted((x, y), key=keeper_key)
            plan.append({"drop": drop["id"], "keep": keep["id"], "drop_status": drop.get("status"),
                         "drop_publication_status": drop.get("publication_status"),
                         "drop_engagement": (drop.get("rating_count") or 0) + (drop.get("comment_count") or 0)})
            rep["neutralize"].append({"drop": drop["id"][:8], "keep": keep["id"][:8],
                                      "kill": f"{x.get('killer_champion')}>{x.get('victim_champion')}",
                                      "drop_src": "livestats" if is_live_row(drop) else "gol.gg",
                                      "drop_status": drop.get("status")})
        report["games"].append(rep)

    visible_dups = sum(1 for p in plan if p["drop_status"] == "published")
    lost_engagement = sum(p["drop_engagement"] for p in plan)
    report["rollback"] = [{"id": p["drop"], "status": p["drop_status"],
                           "publication_status": p["drop_publication_status"]} for p in plan]
    report["summary"] = {"game_pairs": len(game_pairs), "kills_to_neutralize": len(plan),
                         "published_duplicates_removed_from_site": visible_dups,
                         "engagement_on_neutralized": lost_engagement}
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    path = REPORT_DIR / f"report_{time.strftime('%Y%m%d_%H%M%S')}.json"
    path.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    for rep in report["games"]:
        print(f"{rep['golgg_game']:>18} <-> {rep['twin_game']:<20} J={rep['jaccard']} paires={rep['pairs']} "
              f"(2 publiés : {rep['both_published']}) orphelins gol.gg={rep['orphans_golgg']} jumelle={rep['orphans_twin']}")
    print(json.dumps(report["summary"], ensure_ascii=False), "->", path)

    if not args.apply or not plan:
        return
    by_keeper: dict[str, list[str]] = defaultdict(list)
    for p in plan:
        by_keeper[p["keep"]].append(p["drop"])
    done = 0
    for keeper, drops in by_keeper.items():
        if patch_in(db, "kills", drops, {"status": "duplicate", "is_duplicate_of": keeper,
                                         "publication_status": "retracted"}):
            done += len(drops)
        patch_in(db, "game_events", drops, {"qc_human_approved": False,
                                            "publish_blocked_reason": "duplicate_cross_game"}, key="kill_id")
    print(f"neutralisés : {done}/{len(plan)}")


if __name__ == "__main__":
    main()
