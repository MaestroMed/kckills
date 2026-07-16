"""Benchmark : que peut prédire la métadonnée seule vs le score Gemini ?

Tire tous les kills publiés scorés (vérité terrain Gemini), calcule un score
heuristique candidat à partir des colonnes harvester (multi_kill, first blood,
shutdown, assists, solo, game_time), et mesure :
  - Spearman (corrélation de rang — ce qui compte pour ORDONNER le feed)
  - MAE (erreur absolue sur le score 1-10)
  - Overlap du top-90 (le pool des openers du scroll)
  - Distribution par segment (multikill vs routine)

Usage : .venv/Scripts/python.exe scripts/benchmark_local_scorer.py
"""
from __future__ import annotations

import sys
sys.path.insert(0, ".")

import httpx
from services.supabase_client import get_db

# IMPORTANT : on benchmarke la VRAIE formule de prod (modules.local_scorer),
# pas une copie locale — sinon le benchmark dérive du code déployé.
from modules.local_scorer import heuristic_score  # noqa: E402


def spearman(xs: list[float], ys: list[float]) -> float:
    def ranks(v):
        order = sorted(range(len(v)), key=lambda i: v[i])
        r = [0.0] * len(v)
        i = 0
        while i < len(order):
            j = i
            while j + 1 < len(order) and v[order[j + 1]] == v[order[i]]:
                j += 1
            avg = (i + j) / 2.0
            for t in range(i, j + 1):
                r[order[t]] = avg
            i = j + 1
        return r
    rx, ry = ranks(xs), ranks(ys)
    n = len(xs)
    mx, my = sum(rx) / n, sum(ry) / n
    num = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    dx = sum((a - mx) ** 2 for a in rx) ** 0.5
    dy = sum((b - my) ** 2 for b in ry) ** 0.5
    return num / (dx * dy) if dx and dy else 0.0


def main() -> None:
    db = get_db()
    rows: list[dict] = []
    offset = 0
    while True:
        r = httpx.get(
            f"{db.base}/kills", headers=db.headers,
            params={
                "select": "id,multi_kill,is_first_blood,shutdown_bounty,"
                          "assistants,game_time_seconds,highlight_score",
                "status": "eq.published",
                "highlight_score": "not.is.null",
                "tracked_team_involvement": "eq.team_killer",
                "order": "id",
                "offset": str(offset), "limit": "1000",
            }, timeout=30)
        batch = r.json()
        if not isinstance(batch, list) or not batch:
            break
        rows.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000

    print(f"dataset: {len(rows)} kills publiés scorés (vérité terrain Gemini)")
    if not rows:
        return

    g = [float(k["highlight_score"]) for k in rows]
    h = [heuristic_score(k) for k in rows]

    mae = sum(abs(a - b) for a, b in zip(g, h)) / len(g)
    rho = spearman(g, h)

    # Top-90 overlap (pool des openers scroll)
    top_g = {rows[i]["id"] for i in sorted(range(len(g)), key=lambda i: -g[i])[:90]}
    top_h = {rows[i]["id"] for i in sorted(range(len(h)), key=lambda i: -h[i])[:90]}
    overlap = len(top_g & top_h)

    # Segments
    def seg_stats(pred):
        idx = [i for i in range(len(rows)) if pred(rows[i])]
        if not idx:
            return "n=0"
        gs = [g[i] for i in idx]
        hs = [h[i] for i in idx]
        return (f"n={len(idx):4d}  gemini_avg={sum(gs)/len(gs):.2f}  "
                f"heur_avg={sum(hs)/len(hs):.2f}")

    print(f"\nSpearman (ordre)   : {rho:.3f}")
    print(f"MAE (score 1-10)   : {mae:.2f}")
    print(f"Top-90 overlap     : {overlap}/90 ({100*overlap//90}%)")
    print("\nSegments :")
    print("  multikill  :", seg_stats(lambda k: k.get("multi_kill")))
    print("  firstblood :", seg_stats(lambda k: k.get("is_first_blood")))
    print("  shutdown   :", seg_stats(lambda k: (k.get("shutdown_bounty") or 0) > 0))
    print("  solo       :", seg_stats(lambda k: not (k.get("assistants") or [])))
    print("  routine    :", seg_stats(lambda k: not k.get("multi_kill")
                                      and not k.get("is_first_blood")
                                      and not (k.get("shutdown_bounty") or 0)))
    # Distribution du score Gemini (pour situer le plancher score>=7 du feed)
    ge7 = sum(1 for x in g if x >= 7)
    print(f"\nGemini >= 7 : {ge7}/{len(g)} ({100*ge7//len(g)}%)  "
          f"| heuristique >= 7 : {sum(1 for x in h if x >= 7)}/{len(h)}")


if __name__ == "__main__":
    main()
