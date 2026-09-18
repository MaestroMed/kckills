# tools/edit — chaîne « Edit TikTok » (détection de moments → montage calé sur la musique)

Workspace de travail : `D:\kckills_worker\edit_summer\` (clips sources, jsonl, plan, rendus).
Tout tourne avec le venv du worker (`worker\.venv`), ffmpeg 8 (NVENC) et librosa.

| Étape | Script | Entrée → Sortie |
|---|---|---|
| 1. Kills : jugement du clip | `move_detector.py <n> [match_ext_ids]` | clips `_h.mp4` (R2) → `detector.jsonl` (Gemini 3.8 Flash : spectacle_score, move_type, punch_seconds, hype_fr) |
| 2. Objectifs / swings | `objective_scanner.py` | feed livestats → `objectives.jsonl` (dragon/soul/elder/baron/tower/kill_burst/gold_swing) + `objectives_games.json` |
| 3. Moves hors kills | `hp_scanner.py` | feed livestats (PV par joueur) → `hp_events.jsonl` (survie < 10 % PV, kill à < 20 % PV) |
| 4. Jugement VOD | `objective_judge.py --types ...` | VOD (yt-dlp sections 720p) + **vérif timer** (OCR local `modules/timer_ocr`, sinon Gemini) + re-découpe si dérive → `objectives_judged.jsonl` + `obj/*.mp4` |
| 5. Musique | `beats.py <mp3> --window 60` | tempo, grille, fenêtre la plus énergique → `beats.json` |
| 6. Plan | `build_plan.py --min-spectacle 6 --target 60 --music <mp3> --music-offset <edit_start>` | hook + intro + shots (2t / rafale 1t / 4t + slow-mo) + outro → `plan.json` |
| 7. Rendu | `assemble.py plan.json out.mp4` | 1080×1920 30 fps NVENC, zoom-punch + shake + flash, overlays Oswald/Impact, vignette, mix musique + casters −13 dB, loudnorm −14 LUFS |

Garde-fous coût : Gemini 3.8 Flash sur des segments de 40 s max (≈ 0,004 $/jugement),
OCR local du timer avant tout appel, jamais de vidéo entière.
