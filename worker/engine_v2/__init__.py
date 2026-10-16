"""Moteur de clipping v2 (pilote E0, 16/10/2026).

Une game = une unité de travail : la VOD entière en local, l'horloge du jeu
lue à l'écran (chrono.py, 0 jeton), la carte temps VOD ↔ chrono avec pauses
et replays (clockmap.py), les morts lues dans le tableau du HUD (hud_deaths.py)
pour vérifier chaque kill du feed, puis le cadrage vertical par la caméra
LoLscan. Rien ici n'écrit en base : le pilote produit un rapport et des clips
d'essai dans D:/kckills_worker/engine_v2/.
"""
