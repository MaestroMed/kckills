"""E3 dans le clipper du démon : contrôle d'un clip juste coupé, 0 réseau.

Utilise la chronologie du feed EN CACHE (écrite par modules/qc3_sync) ; si
elle manque, rend None et le clipper garde ses contrôles d'avant. Le
lecteur de chrono est le premier profil calibré qui lit le bon chrono ; le
score est lu avec le profil de bandeau associé s'il a appris assez de
chiffres (sinon verdict « pass_timer » au mieux).
"""
from __future__ import annotations

import gzip
import json
import os

from engine_v2.chrono import ChronoReader
from engine_v2.score import ScoreReader
from qc3.pilot import expected_scores
from qc3.timeline import _cache_path, build_timeline
from qc3.verify import ClipVerdict, verify_clip

PROFILE_PAIRS = (("worlds26_row", "worlds26"), ("ewc26", "ewc26"))
MATCH_TOL_MS = 1_500
_TL_CACHE: dict[str, object] = {}


def _timeline(game_ext_id: str):
    if game_ext_id in _TL_CACHE:
        return _TL_CACHE[game_ext_id]
    p = _cache_path(game_ext_id)
    if not os.path.exists(p):
        return None
    with gzip.open(p, "rt", encoding="utf-8") as f:
        d = json.load(f)
    tl = build_timeline(game_ext_id, d["meta"], d["frames"])
    _TL_CACHE.clear()
    _TL_CACHE[game_ext_id] = tl
    return tl


def check(kill: dict, game_ext_id: str, clip_path: str, kill_t: float) -> ClipVerdict | None:
    """`kill_t` = position de l'instant du feed dans le clip (le `before` de la fenêtre)."""
    tl = _timeline(game_ext_id)
    if tl is None or not kill.get("event_epoch"):
        return None
    e = int(kill["event_epoch"])
    cands = [k for k in tl.kills if abs(k.epoch_ms - e) <= MATCH_TOL_MS
             and k.victim_champion == kill.get("victim_champion")]
    if not cands:
        return None
    k = min(cands, key=lambda x: abs(x.epoch_ms - e))
    best = None
    for chrono_profile, hud in PROFILE_PAIRS:
        reader = ChronoReader(chrono_profile)
        if not reader.calibrated:
            continue
        score = ScoreReader(hud)
        v = verify_clip(clip_path, kill_t, k.chrono_s, reader,
                        score_reader=score if len(score.templates) >= 8 else None,
                        expected_score_at=expected_scores(tl, k), killer_side=k.killer_side)
        if v.verdict in ("pass", "pass_timer", "mistimed", "broken"):
            return v            # ce profil lit le HUD : verdict retenu
        best = best or v
    return best
