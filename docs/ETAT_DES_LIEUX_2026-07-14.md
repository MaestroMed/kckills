# État des lieux — clips KCKills
### Audit lecture seule du 2026-07-14 (Fable). Zéro appel Gemini, zéro write DB.

Méthode : agrégats PostgREST sur `kills` / `games` / `game_vod_sources` /
`kill_assets` (14 026 kills, 32 017 assets) + **ffprobe sur les 2 993 clips
publiés** (R2, egress gratuit) + corrélation avec `encoder_args` /
`encoding_node`. Scripts dans le scratchpad de session, résultats JSON
conservés (`audit_result.json`, `probe_audio_result.json`).

---

## 1. Vue d'ensemble

| Métrique | Valeur |
|---|---|
| Kills en base | **14 026** |
| Publiés | **2 993** |
| Backlog `raw` | **9 124** (dont 6 178 gol.gg sans epoch, 2 947 livestats) |
| `vod_found` en attente de clip | 670 |
| `analyzed` jamais publiés | 679 |
| `clip_error` | 369 (142 à retry épuisé) |
| Games | 666 (36 sans VOD, 60 offset null/0 dont 41 avec kills) |
| `game_vod_sources` | 27 lignes seulement, **0 validée** — le multi-source n'a jamais servi |

Le statut `duplicate` n'existe pas encore en base : **la migration dédup
(« 088 ») n'a jamais été appliquée** — la 087 est bien la dernière.

## 2. Doublons — les chiffres réels

* **2 193 groupes de doublons sémantiques** (même `game_id` + `event_epoch` +
  `victim_champion`) totalisant **9 865 lignes**.
* Cas pathologique : **une seule mort (DrMundo→Jayce, game `dbb474bb`) existe
  en ~340 exemplaires**, dont des dizaines `published`/`analyzed`. Cette game
  cumule 1 548 kills `raw` à elle seule.
* **Cause racine** : l'index unique `idx_kills_unique_event` (migration 030)
  exige `killer_player_id` ET `victim_player_id` NOT NULL et `event_epoch > 0`.
  Les lignes avec player_id NULL (mapping joueur raté) et les backfills gol.gg
  (`event_epoch = 0`) le contournent → chaque re-run du harvester/backfill
  ré-insère tout.
* **122 séquences multi-kill avec plusieurs clips publiés** (le « un quadra
  est aussi un triple et un double ») — ex. game `epoch=0` : le triple de
  Kaisa publié en 3 clips séparés (solo + double + triple).
* `kill_assets` : **2 134 content_hash partagés entre des kills différents**
  → des clips byte-identiques rattachés à des lignes kills distinctes
  (c'est la source des 23505/409 dans les batchs).
* En revanche, **0 content_hash partagé entre kills publiés** : les doublons
  visibles dans le feed sont des fichiers *différents* du même moment
  (fenêtres qui se chevauchent) — la dédup par hash seul ne suffira jamais,
  il faut la clé sémantique + le collapse multi-kill.

## 3. Pourquoi des clips « sans version 16:9 » sur le site

**272 kills publiés n'ont AUCUNE URL de clip sur la ligne `kills`**
(`clip_url_horizontal`, `clip_url_vertical`, `thumbnail_url`… tous NULL) —
**alors que leurs 4 assets courants existent dans `kill_assets` et sur R2**
(vérifié sur échantillon : 50/50 ont horizontal + vertical + vertical_low +
thumbnail `is_current`).

→ C'est le bug du status-flip batch de mai 2026 (23505 sur `content_hash`
→ fallback → la ligne kills n'a jamais reçu son PATCH d'URLs). **Réparation
pure DB possible : resynchroniser `clip_url_*` depuis `kill_assets` —
aucun re-clip nécessaire.** (`updated_at` de ces lignes : 2026-05.)

## 4. Pourquoi des clips « sans son »

ffprobe sur les 2 993 publiés :

| Verdict | Nb |
|---|---|
| OK (audio + vidéo) | 2 488 |
| **Sans piste audio** | **212** |
| Sans flux vidéo (corrompus) | 19 |
| Sans URL (cf. §3) | 272 |
| Erreur probe | 2 |

Les 212 muets ont tous `encoder_args.a_codec = aac` → l'encodage demandait
bien l'audio, mais **la source téléchargée n'avait pas de piste audio**
(yt-dlp a sélectionné un format vidéo-seule quand le HLS muxé avc1 n'était
pas dispo ; ffmpeg produit alors un MP4 muet sans broncher). Étalé sur
mai→juillet, ~40 games.

→ Triple correctif : (1) sélecteur de format yt-dlp avec audio obligatoire,
(2) check QC bloquant `audio_present` (ffprobe, local, gratuit),
(3) re-clip ciblé des 212 + 19.

## 5. Offset / drift

* Validation actuelle = **1 seul point Gemini** (`vod_offset_finder_v2` à
  candidat+60 s, `clip_qc` au milieu du clip, seuils incohérents 45 s vs 30 s
  documentés).
* Le prototype multi-points existe déjà (`reclip_calibrated.py` +
  `vod_time_maps.json`) et ses données **prouvent le drift intra-game** :
  sur une même VOD, l'offset passe de 3 509 s → 3 525 s → 3 562 s au fil de
  la partie (sauts de pause). Un offset unique par game ne PEUT PAS être
  juste partout.
* 41 games ont `vod_offset_seconds` null/0 avec des kills (dont des publiés) —
  clips potentiellement sur le mauvais moment.

## 6. Pourquoi Gemini a brûlé 50 €

1. **`GEMINI_MODEL=gemini-3-flash-preview` dans `.env` écrase le routing par
   tier pour TOUS les étages** (chaîne de fallback `GEMINI_MODEL_QC →
   GEMINI_MODEL → tier`). Les lectures de timer — l'appel le plus fréquent du
   backfill — tournaient sur 3-flash ($0.30/$2.50) au lieu de flash-lite
   ($0.10/$0.40).
2. Le modèle `-preview` n'est pas dans `ai_pricing.GEMINI_PRICES` → tarifé au
   `DEFAULT_PRICE` flash-lite → **le cap journalier $10 sous-comptait la
   dépense réelle ~3-6×**.
3. `qc.py::validate_clip` upload la **vidéo entière** à Gemini (tokens vidéo,
   très cher) là où une frame JPEG suffit.
4. 3 606 appels 429 en ~12 h le 13/07 : les process ont continué à marteler
   l'API après épuisement (chaque tentative = requête facturable côté quota).

→ Correctifs : retirer `GEMINI_MODEL` du `.env` (le tier `balanced` route
déjà QC/offset sur flash-lite), ajouter les modèles `-preview` à la table de
prix, circuit-breaker sur 429 RESOURCE_EXHAUSTED (arrêt propre jusqu'au
reset 07:00 UTC), et surtout **OCR local en premier ressort** pour les
lectures de timer (0 token) avec Gemini en arbitre des cas ambigus.

## 7. Backlog raw : que contient-il ?

* 6 178 gol.gg (`event_epoch=0`, pas de VOD mapping fiable) — l'historique
  2021-2025 à backfiller proprement via le décryptage.
* 2 947 livestats (epoch fiable) dont une grosse part = doublons du §2.
* 3 630 des 9 124 raw sont `team_victim` (KC se fait tuer) → **jamais
  publiables** (règle produit) mais gardés en base.
* Après dédup, le vrai backlog publiable est estimé à ~2-3 000 kills.

## 8. Plan de remise en état (ordre d'exécution)

1. **Migration 088** (`clip_ledger` + drift par source + statut `duplicate`) — écrite, à appliquer.
2. **Migration 089** (neutralisation des doublons sémantiques + index unique NULL-proof) — écrite, à relire avant application (touche ~7 700 lignes).
3. **Réparation URLs** des 272 publiés (script DB pur, dry-run d'abord).
4. **Config Gemini** : retirer l'override `.env`, pricing preview, circuit-breaker 429.
5. **Décryptage multi-points** (`modules/decryptage.py`) : OCR local d'abord, Gemini en arbitre, modèle piecewise par source, persisté dans `game_vod_sources`.
6. **QC multi-passes** : checks locaux gratuits (ffprobe audio/durée/frames) + vision échantillonnée ; verdicts dans `clip_ledger.qc_checks` → gates `game_events`.
7. **Backfill au crible** : rejoue tout, remplit le ledger, re-clippe les 212 muets + 19 corrompus + drift détecté.
