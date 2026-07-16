"""LOCAL_SCORER — score heuristique gratuit depuis la métadonnée (0 token).

Rôle : FALLBACK quand Gemini est indisponible (cap/quota/panne). Aujourd'hui le
chemin dégradé de l'analyzer publie avec highlight_score NULL → le clip est
invisible du feed curé (plancher score >= 7) jusqu'à une éventuelle réanalyse.
Un score heuristique calibré vaut mieux que pas de score du tout.

NE remplace PAS Gemini pour le classement fin : benchmark 2026-07-16 sur 1962
kills publiés (vérité terrain Gemini flash-lite) —
    Spearman 0.44 · MAE 0.67 · top-90 overlap 18 %
→ la métadonnée capture les segments (multikill/solo/FB) mais pas l'outplay
visuel qui fait les tout meilleurs clips. Donc : fallback only, et le feed curé
reste piloté par les scores Gemini dès qu'ils existent.

Calibration (scripts/benchmark_local_scorer.py) : base 6.6 = moyenne Gemini des
kills routine (6.90) moins les bonus moyens ; les bonus sont les DELTAS mesurés
par segment, pas des intuitions. Re-runner le benchmark après tout retuning.
"""
from __future__ import annotations

# Deltas mesurés vs routine (Gemini avg par segment, 1962 kills, 2026-07-16).
MK_BONUS = {"double": 0.55, "triple": 1.1, "quadra": 1.6, "penta": 2.3}
BASE = 6.6


def heuristic_score(kill: dict) -> float:
    """Score 1-10 depuis les colonnes harvester. Déterministe, 0 token."""
    s = BASE
    mk = (kill.get("multi_kill") or "").lower()
    s += MK_BONUS.get(mk, 0.0)
    if kill.get("is_first_blood"):
        s += 0.25
    sb = kill.get("shutdown_bounty") or 0  # toujours 0 aujourd'hui — future-proof
    if sb >= 400:
        s += 0.5
    elif sb > 0:
        s += 0.25
    assists = kill.get("assistants")
    if isinstance(assists, list):  # clé absente = inconnu ≠ solo prouvé
        if len(assists) == 0:
            s += 0.5
        elif len(assists) >= 3:
            s += 0.15
    if (kill.get("game_time_seconds") or 0) >= 1800:
        s += 0.15
    return round(max(1.0, min(10.0, s)), 1)


def heuristic_tags(kill: dict) -> list[str]:
    """Tags que la métadonnée PROUVE (jamais de tags visuels devinés)."""
    tags: list[str] = []
    assists = kill.get("assistants")
    if isinstance(assists, list):  # clé absente = inconnu, pas de tag deviné
        if len(assists) == 0:
            tags.append("solo_kill")
        elif len(assists) >= 3:
            tags.append("teamfight")
    if (kill.get("shutdown_bounty") or 0) > 0:
        tags.append("shutdown")
    return tags[:5]
