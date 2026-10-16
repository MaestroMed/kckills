"""Vérifie chaque kill du feed contre l'écran : la victime doit mourir dans
le tableau du HUD à l'instant que prévoit la carte du chrono.

Côté de la victime : bleu = gauche, rouge = droite (convention des
diffusions officielles). Ligne = (participantId − 1) mod 5 (top → support).
Un kill est « vu » si le portrait de la victime grise à ±`tol` s de la
position prévue ; Δ = position lue − position prévue.
"""
from __future__ import annotations

from engine_v2.clockmap import ClockMap
from engine_v2.hud_deaths import Death


def check(kills: list[dict], cm: ClockMap, deaths: list[Death], tol: float = 8.0) -> list[dict]:
    used: set[int] = set()
    out = []
    for k in sorted(kills, key=lambda x: x.get("game_time_seconds") or 0):
        g = k.get("game_time_seconds")
        pos, gap = cm.file_pos(g) if g is not None else (None, True)
        side = "left" if k.get("victim_side") == "blue" else "right"
        try:
            row = (int(k.get("victim_participant_id")) - 1) % 5
        except (TypeError, ValueError):
            row = None
        best, bi = None, None
        if pos is not None and row is not None:
            for i, d in enumerate(deaths):
                if i in used or d.side != side or d.row != row:
                    continue
                dt = d.t - pos
                if abs(dt) <= tol and (best is None or abs(dt) < abs(best)):
                    best, bi = dt, i
        if bi is not None:
            used.add(bi)
        out.append({
            "chrono": g,
            "killer": k.get("killer_name"),
            "victim": k.get("victim_name"),
            "multi_kill": k.get("multi_kill"),
            "file_pos": round(pos, 1) if pos is not None else None,
            "gap": gap,
            "seen": bi is not None,
            "delta_s": round(best, 1) if best is not None else None,
        })
    return out
