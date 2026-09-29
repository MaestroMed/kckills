# -*- coding: utf-8 -*-
"""
VOD_OFFSET — un offset VOD absent reste ABSENT, jamais 0.

Incident du 29/09/2026 : 1 149 clips publiés montraient la draft, le plateau,
une interview ou la facecam d'un streamer au lieu du kill. Tous venaient d'un
offset « absent » transformé en 0 quelque part :
  * clipper : `int(game["vod_offset_seconds"] or 0)` — offset NULL (EWC 2026,
    VOD branchée avant que vod_offset_finder ait calibré) -> clip coupé à
    `game_time` secondes du DÉBUT du live, en plein pré-show ;
  * backfill_vods_2025 / backfill_games / backfill_history / pipeline :
    `vod.get("offset") or 0` — l'API lolesports omet l'offset et renvoie la
    MÊME VOD de série pour chaque game d'un BO5 -> 5 games « à 0 » sur une
    seule VOD (LEC 2025 : jusqu'à 101 clips sur 106 hors jeu).

Règle (déjà celle de sentinel depuis PR7-A) : 0 n'est pas un offset, c'est
l'absence d'offset. Une VOD de broadcast ne démarre jamais pile au lancement
d'une game ; un vrai calage (vod_offset_finder, décryptage) donne une valeur
strictement positive.
"""
from __future__ import annotations


def parse_api_offset(raw) -> int | None:
    """`vod.offset` de l'API lolesports -> secondes, ou None si absent,
    vide, nul, négatif ou illisible."""
    if raw is None or raw == "":
        return None
    try:
        val = int(float(raw))
    except (TypeError, ValueError):
        return None
    return val if val > 0 else None


def usable_offset(value) -> int | None:
    """`games.vod_offset_seconds` utilisable pour couper une VOD YouTube.

    None pour NULL, 0 ou négatif : couper à 0 + game_time tombe dans le
    pré-show / la draft. L'appelant doit alors REPORTER le clip (le temps
    que vod_offset_finder calibre), jamais couper « au cas où »."""
    return parse_api_offset(value)
