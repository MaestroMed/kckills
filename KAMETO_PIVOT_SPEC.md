# Pivot Kameto VOD-only — Spec d'architecture

> Statut : draft v1, 22 avril 2026
> Cible : remplacer la chaîne d'acquisition VOD officielle LEC par les VODs Kameto (chaîne YouTube principale + clips) pour pouvoir backfill toutes les games KC depuis sa création (2021).
> Suppose que le pilote actuel (340 clips KC LEC 2025-2026) est en working grade — c'est l'étape "vrai produit" pour LOLTOK.

---

## 1. Pourquoi pivoter

### Limites actuelles de la chaîne LEC officielle
- **Couverture temporelle limitée** : `getEventDetails` retourne fiablement les VODs des 18 derniers mois. Tout ce qui est antérieur a soit aucune VOD soit des liens cassés.
- **Pas d'événements pré-LEC** : LFL 2021-2023, EU Masters, scrim, showmatch — invisible.
- **VODs broadcast épurées** : pas de réactions caster, pas de pré/post game, pas d'intervention des joueurs.
- **Mono-langue** : essentiellement EN, parfois FR. Pas de multi-source (anglais Drakos, français Pulsar, espagnol Kala...).

### Ce que Kameto apporte
- **Catalogue exhaustif** : la chaîne Kameto couvre TOUS les matchs KC depuis 2021 (~300+ matchs, ~750+ games)
- **Watch-along caster** : Kameto + invités (Wiki, AMC, Doigby...) commentent en direct → réaction émotionnelle riche
- **Clips Kameto déjà coupés** : `@KametoCorpClips` héberge des extraits courts déjà éditorialement choisis
- **Multi-source naturel** : on peut rajouter Eto, Domingo, etc. — chaque streamer = une "voice over" différente du même match
- **Quasi-illimité légalement** : les VODs sont publiques YouTube, on s'aligne sur fair-use highlight aggregation comme TheScore esports

---

## 2. Décisions structurantes (à valider avant code)

| # | Question | Recommandation |
|---|---|---|
| K1 | **Source de vérité du timing kill** | Live stats feed lolesports (epoch RFC3339) + OCR fallback in-frame quand feed manque |
| K2 | **Détection début/fin de game dans la VOD** | OCR du timer in-game à la frame 0 + scene detection (ffmpeg `select=gt(scene\,0.4)`) pour les coupures broadcast |
| K3 | **VOD splitter (1 vidéo Kameto = N games)** | Module `vod_splitter.py` → produit N "virtual VODs" avec offset_start chacune |
| K4 | **Reconciliation game ↔ match** | Match metadata depuis Oracle's Elixir CSV (date + équipes) + score validation contre kc_matches.json |
| K5 | **Multi-streamer (Eto, Domingo, etc.)** | `vod_sources` table déjà en place (migration 001) — on hydrate avec `source_type='etostark'` etc. |
| K6 | **Backfill order** | Most-recent-first (2026 → 2025 → 2024 → 2023 → 2022 → 2021) — l'utilisateur a +1 incentive sur les matchs récents |
| K7 | **Rate limit YouTube** | yt-dlp + cookie rotation. 10 dl/heure max via scheduler. Backoff 429 multiplié × 2. |
| K8 | **Storage R2** | 1 game ≈ 1.5 GB MP4 source (40min × 720p). 750 games × 1.5 GB = **1.1 TB**. Free tier 10 GB → migration payante OBLIGATOIRE. Estimer ~$15/mois R2 pour 1 TB. |

---

## 3. Architecture cible

```
┌──────────────────────────────────────────────────────────────────────┐
│                  YouTube — chaîne Kameto                             │
│  @KametoCorp (long VODs) + @KametoCorpClips (extraits courts)        │
│  + bonus: Eto / Domingo / SkyyArt / etc. via vod_sources             │
└────────────┬─────────────────────────────────────────────────────────┘
             │ yt-dlp (rate-limited, cookie-rotated)
┌────────────▼─────────────────────────────────────────────────────────┐
│  WORKER PYTHON                                                       │
│                                                                      │
│  KAMETO_DISCOVERER (NEW)                                             │
│    Polls @KametoCorp video list, classifies each:                    │
│      - watch_along (long, full match)                                │
│      - clip (short, single game extract)                             │
│      - other (vlog, content non-LoL)                                 │
│    Inserts into kameto_videos table.                                 │
│                                                                      │
│  VOD_SPLITTER (NEW)                                                  │
│    For each watch_along: detect game boundaries via OCR + scene      │
│    detection. Splits the VOD into N (game_index, t_start, t_end)     │
│    rows in vod_segments. Reconciles each segment against the         │
│    matches table by date + score validation.                         │
│                                                                      │
│  HARVESTER (REUSED, ENHANCED)                                        │
│    For each (match, game) tuple: fetch live stats feed for kill      │
│    timestamps. If feed missing (matchs <2024), fall back to          │
│    Oracle's Elixir CSV (kills par player par game, pas de            │
│    timestamp individuel — réparti uniformément dans la durée game).  │
│                                                                      │
│  CLIPPER (REUSED, ENHANCED)                                          │
│    yt-dlp --download-sections to extract just the kill window from   │
│    the Kameto VOD instead of the LEC official one. Same H/V/V_low    │
│    encoding pipeline.                                                │
│                                                                      │
│  CALIBRATOR (NEW)                                                    │
│    Per-clip OCR check: read the in-game timer at clip mid-point,     │
│    compute drift vs expected game_time_seconds. If drift > 30s,      │
│    correct the offset for the parent VOD segment AND re-clip every   │
│    affected clip.                                                    │
│                                                                      │
│  ANALYZER / OG_GENERATOR / HLS_PACKAGER : unchanged (déjà solides)   │
└────────────┬─────────────────────────────────────────────────────────┘
             │
┌────────────▼─────────────────────────────────────────────────────────┐
│                       SUPABASE                                       │
│  + new tables:                                                       │
│      kameto_videos      (every video discovered, classified)         │
│      vod_segments       (game boundaries within each VOD)            │
│      legacy_match_data  (Oracle's Elixir + Leaguepedia ingest)       │
│  + extends:                                                          │
│      kills.source_voice_id ('kameto'|'eto'|'domingo')               │
│      games.kameto_video_id, games.kameto_segment_id                  │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 4. Estimation de scope

| Phase | Scope | Effort | R2 storage |
|---|---|---|---|
| K-Phase 0 | Migration schema + KAMETO_DISCOVERER + table kameto_videos | 2j | — |
| K-Phase 1 | VOD_SPLITTER (OCR + scene detection) | 4j | — |
| K-Phase 2 | Reconciliation game↔match via Oracle's Elixir | 2j | — |
| K-Phase 3 | Adaptation HARVESTER + CLIPPER pour mode Kameto-source | 2j | — |
| K-Phase 4 | CALIBRATOR (drift correction) | 2j | — |
| K-Phase 5 | Migration R2 vers paid tier | 0.5j | +1 TB ($15/mois) |
| K-Phase 6 | Backfill 2026 (~80 games × ~30 kills = 2400 clips) | runtime ~5j | +50 GB |
| K-Phase 7 | Backfill 2025 (~80 games × ~30 = 2400 clips) | runtime ~5j | +50 GB |
| K-Phase 8 | Backfill 2024 (~60 games) | runtime ~3j | +30 GB |
| K-Phase 9 | Backfill 2023 (LFL+LEC, ~70 games) | runtime ~4j | +35 GB |
| K-Phase 10 | Backfill 2022 (LFL Rekkles, ~80 games) | runtime ~5j | +40 GB |
| K-Phase 11 | Backfill 2021 (LFL début, ~50 games) | runtime ~3j | +25 GB |
| K-Phase 12 | UI : timeline filter par ère + multi-source switcher sur /kill/[id] | 2j | — |

**Total dev** : ~20 jours-homme. **Total runtime backfill** : ~25 jours en continu (PC allumé).
**Total clips estimé** : ~12 000 (vs 340 actuels = ×35).
**Coût opérationnel mensuel après backfill** : ~$15 R2 + ~10€ existing = **~$25/mois**.

---

## 5. Risques + mitigations

| Risque | Probabilité | Impact | Mitigation |
|---|---|---|---|
| YouTube ban yt-dlp / Kameto fait privé une vidéo | M | H | Cookie rotation, scheduler 10/h, fallback Twitch VOD si dispo |
| OCR timer in-game inexact (résolution streamer variable) | H | M | Multi-frame voting (lit 5 frames consécutives, prend la médiane) |
| VOD_SPLITTER rate des transitions game | M | M | 2-pass : scene-detect d'abord, puis validation par OCR aux candidats |
| Reconciliation game↔match ambigüe (2 matchs même jour) | L | M | Score check + duration check, fallback manual review queue |
| R2 storage explose au-delà des prévisions | M | L | Migration tier supérieur instantané, transparent côté code |
| Live stats feed missing pour matchs anciens | H | M | Oracle's Elixir CSV fallback (déjà implémenté, juste à activer) |
| Quota Gemini 1000 RPD vs 12k clips à analyser | C | H | Batch sur 12+ jours OU upgrade payant Gemini (négligeable, $0.10/M tokens) |
| Copyright Kameto si on réuploade ses voice-over | L | C | Honor `/community` flow + crédit explicite "voice-over Kameto" sur chaque clip |

---

## 6. Compatibilité avec l'existant

### Ce qui ne change PAS
- `/scroll`, `/clips`, `/best`, `/records`, `/week`, etc. — tous les feeds consomment kills.* sans care de la source
- ANALYZER, OG_GENERATOR, HLS_PACKAGER — pipeline post-clipping inchangé
- Frontend UI — la seule UI nouvelle = source switcher sur `/kill/[id]`
- Auth Discord, comments, ratings — inchangés

### Ce qui change
- **Worker SENTINEL devient secondaire** : le polling lolesports continue mais ne sert qu'à enrichir les matchs récents avec metadata officielle (scores, streams)
- **kc_matches.json devient une source d'enrichissement, plus la primary** : Kameto videos drivent l'ingestion
- **`/kill/[id]` gagne un dropdown source** : "Voice-over par Kameto / Eto / Domingo"
- **Hero homepage clips** : peuvent tirer du long-format Kameto (réactions cinématiques) au lieu des extraits broadcast

---

## 7. Path de mise en route

### Étape 1 — Validation (1 séance, no code)
- Mehdi confirme ou challenge les 8 décisions K1-K8
- Notamment K8 (R2 paid tier $15/mois) — go/no-go financier
- Choix de la première ère à backfill (2026 si on veut shipper vite, 2021 si on veut d'abord prouver le pipeline sur petit volume)

### Étape 2 — K-Phase 0 (2j)
- Migration 010 : `kameto_videos`, `vod_segments`, `legacy_match_data`
- KAMETO_DISCOVERER module qui peuple `kameto_videos`
- Smoke test : "combien de VODs disponibles couvrant LEC 2026 ?"

### Étape 3 — K-Phase 1+2 (6j)
- VOD_SPLITTER + reconciliation
- Test sur 1 seule VOD watch-along Kameto LEC 2026 → produire les segments game

### Étape 4 — K-Phase 3+4 (4j)
- Adapter CLIPPER + ajouter CALIBRATOR
- Produire 5 clips de demo depuis Kameto VOD pour comparaison qualité avec broadcast LEC

### Étape 5 — K-Phase 5 (0.5j)
- Migration R2 paid tier (CB + DNS, peu de code)

### Étape 6 — K-Phase 6+ (backfill batch, en continu)
- Lancer le backfill ère par ère, monitorer via le backoffice admin
- Mehdi peut killer/relancer l'ingestion à tout moment via `/admin/pipeline`

### Étape 7 — K-Phase 12 (2j)
- UI source switcher
- Update homepage hero pour montrer la richesse multi-source

---

## 8. Pour démarrer immédiatement

Quand tu donnes le go, on attaque dans cet ordre :

1. **Smoke test yt-dlp** : `yt-dlp -F https://youtube.com/@KametoCorp/videos --dateafter 20260101` pour voir combien de VODs on a sous la main
2. **Smoke test Oracle's Elixir** : pull du CSV LEC 2026 via leur Drive
3. **Smoke test OCR** : lance `pytesseract` sur 3 frames d'une VOD Kameto pour vérifier la lisibilité du timer in-game

Si les 3 smokes passent, on attaque K-Phase 0 en 1 PR.

---

## Verdict

Le pivot Kameto est **techniquement faisable** avec ~20 jours de dev et une dépense de ~$15/mois supplémentaires. Le résultat = **×35 sur le catalogue de clips** + multi-source caster + couverture historique complète depuis 2021.

C'est ce qui transforme le pilote KC en **vrai pilote LOLTOK** — l'engine devient capable de gérer N'IMPORTE QUEL streamer + N'IMPORTE QUELLE équipe/jeu une fois le pattern validé sur Kameto/KC.

**Tes décisions à prendre** :
- (a) Go pour smoke tests Étape 8 ?
- (b) Validation K1-K8 ?
- (c) Budget R2 $15/mois OK ?
