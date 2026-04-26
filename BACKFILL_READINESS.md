# Backfill historique KC — readiness audit (2026-04-27)

État de la base + plan pour produire des clips depuis les ~10K kills historiques
déjà ingérés en data-only.

---

## 📊 État actuel de la base

```
TOTAL kills en DB              : 12 302
  livestats (live LEC)         :  2 424 dont 667 publiés (clips visibles)
  gol.gg (historique 2021-26)  :  9 878 dont   0 publiés ⚠️

GAMES                          :    537
  livestats has_vod            :    102 / 126 (81%)
  gol.gg has_vod               :      0 / 411 (0%) ⚠️

MATCHES par année (scheduled_at) :
  2021                         : 0  ← gol.gg n'a pas peuplé scheduled_at
  2022                         : 0
  2023                         : 0
  2024                         : 0
  2025                         : 16
  2026                         : 26
```

**Le gros gap** : 9 878 kills historiques 2021-2024 ingérés depuis gol.gg,
**aucun n'a de clip**. Les 411 games associées n'ont pas de VOD YouTube
matchée. C'est le scope du backfill que tu prépares.

---

## ✅ Ce qui est déjà en place

| Composant | État | Note |
|---|---|---|
| `worker/services/golgg_scraper.py` | ✅ Live | Per-kill timeline pour tout pro LoL game depuis 2014 |
| `worker/services/leaguepedia.py` | ✅ Live | Cargo API fallback (KDA aggregate, pas per-kill) |
| `worker/services/leaguepedia_scraper.py` | ✅ Live | Better fallback 2011+ |
| `worker/services/oracles_elixir.py` | ✅ Live | CSV J+1 fallback |
| `worker/scripts/backfill_golgg.py` | ✅ Live | **31 tournois KC 2021-2026 hardcoded** + checkpoint resume |
| `worker/modules/channel_reconciler.py` | ✅ Live | Match VODs YouTube ↔ games |
| `worker/modules/vod_offset_finder.py` | ✅ Live | Trouve timestamp ingame dans la VOD |
| `worker/modules/clipper.py` | ✅ Live | yt-dlp + ffmpeg triple format |
| `worker/modules/analyzer.py` | ✅ Live | Gemini + nouveau prompt anti-pollution Wave 12 |

**Aucun nouveau code worker à écrire.** Tout le pipeline existe.

---

## 🚧 Ce qui manque pour vraiment shipper les clips historiques

### 1. VOD discovery rate sur gol.gg games (= 0%)

Le `channel_reconciler` fait de l'inverse : il scanne les YouTube channels
KC (Kameto Clips, EtoStark, official LEC, etc.) puis matche les VOD trouvées
avec les games en DB. Pour les vieilles games (2021-2023), beaucoup de VODs
sont :
- **Sur la chaîne LFL officielle** (qui n'est pas dans `KC_YOUTUBE_CHANNELS` à
  vérifier — `worker/lib/youtube-channels.ts` côté web)
- **Sur la chaîne LEC/EU Masters officielle** (à vérifier)
- **Privées / unlisted** chez Kameto / pour des moments spécifiques
- **En 360p** car réuploadées par des fan-channels (qualité dégradée)

**Action** : scan les channels LFL/LEC/EUM officielles + KamiVS + Eto en plus
des channels actuels. Possiblement ajouter un "manual VOD lookup" CLI où tu
peux coller une URL YouTube + game_id et le worker apprend.

### 2. vod_offset_finder pour les VODs LFL/EUM (= jamais testé)

Le module est branché pour les vrais matchs LEC (timestamp exact via
livestats feed). Pour les VODs historiques, il faut OCR du timer ingame
+ Gemini vision pour valider. À tester sur 5-10 games avant de lancer en
masse pour catch les régressions.

### 3. yt-dlp survival sur les vieilles VODs

Certaines VODs LFL 2021 sont :
- Bloquées par age-gate (Premium recommandé — ✅ ton cookie Firefox les
  passe)
- Re-encodées par YouTube en 360p only (qualité finale dégradée)
- Privatisées / supprimées (clip impossible — fallback Leaguepedia static
  card)

### 4. Capacité storage

```
Per kill : 4 fichiers
  - {id}_h.mp4     720p horizontal  ~25 MB
  - {id}_v.mp4     720p vertical    ~25 MB  
  - {id}_v_low.mp4 360p vertical    ~5 MB
  - {id}_thumb.jpg 720p JPEG        ~50 KB

≈ 55 MB par kill

9 878 kills × 55 MB = 543 GB total
```

| Service | Free tier | Coût après |
|---|---|---|
| **R2 storage** | 10 GB | $0.015/GB → **543 GB ≈ $8/mois** |
| R2 egress (Class B reads) | 10M / mois | gratuit toujours |
| R2 writes (Class A) | 1M / mois | 9 878 × 4 = 39 512 (largement OK) |

**Action** : passer R2 en plan payant ($5 minimum + $0.015/GB) AVANT de
lancer le backfill. Sinon le pipeline s'arrête à 10 GB.

**Optimisation possible** : ne garder QUE le `_v_low` 360p pour les clips
historiques (qualité acceptable + 5 MB seulement = **49 GB total**, sous
le free tier). Décision UX à prendre.

### 5. Capacité Gemini

- Free tier : 1 000 RPD = ~250 clips analysés / jour
- 9 878 clips ÷ 250/jour = **40 jours de backfill** au rythme free tier
- Avec **paid tier $0.10/M input tokens** : illimité, ~$1-2 total pour 10K clips

**Action** : passer Gemini en payant avant le backfill (déjà fait ?
`KCKILLS_GEMINI_TIER` config — à vérifier).

### 6. Capacité Supabase

```
Free tier : 500 MB DB + 5 GB egress / mois
Actuel    : ~12K kills + 537 games + ~2K matches metadata
Estimé après backfill : +10K kills metadata ≈ +50 MB → toujours sous 500 MB
Egress : pas de change (clips servis depuis R2 directement)
```
✅ **Supabase tient sans upgrade**.

---

## 🎯 Plan d'attaque recommandé pour le backfill

### Phase 1 — Prep (1-2h, à faire AVANT lancement)
- [ ] Vérifier que les channels YouTube LFL/LEC/EUM officielles sont dans
      `KC_YOUTUBE_CHANNELS` (worker/lib/youtube-channels.ts)
- [ ] **Upgrade R2** au plan payant (ou décider de skip les formats 720p
      et garder uniquement 360p)
- [ ] **Upgrade Gemini** au tier balanced ou premium (sinon 40 jours)
- [ ] **Apply migration 048** (déjà fait ✓)
- [ ] **Vérifier que `youtube_cookies` Firefox profile reste connecté**
      (la session expire après ~30j d'inactivité YouTube)

### Phase 2 — Validation sur 10 games (1h)
- [ ] Run `backfill_golgg.py --tournament "LFL Spring 2021" --limit 10`
- [ ] Manuellement check les 10 games :
    - VOD trouvée ? (channel_reconciler)
    - Offset correct ? (vod_offset_finder + Gemini timer check)
    - Clips produits ? (clipper)
    - Gemini classifie correctement ? (live_gameplay vs replay etc.)
- [ ] Si > 70% OK → green light. Sinon investiguer les bugs.

### Phase 3 — Backfill complet (10-40 jours selon Gemini tier)
- [ ] Lancer `backfill_golgg.py` en background (déjà idempotent + checkpoint)
- [ ] Monitor `/admin/analytics` quotidiennement :
    - Compteur "Live gameplay" doit grimper
    - "% pollution" doit rester < 30 %
    - DLQ doit rester sous 100 jobs en stuck
- [ ] Watchdog Discord si silence > 6h ou error rate > 20 %

### Phase 4 — QC + cleanup post-backfill
- [ ] Re-run `reanalyze_pollution_qc.py --since-days 30` pour double-check
      les nouveaux clips
- [ ] Identifier les games où VOD jamais trouvée → manual_review queue
      pour upload via /admin/hero-videos ou skip silencieux

---

## 🔥 Risques + mitigations

| Risque | Probabilité | Mitigation |
|---|---|---|
| YouTube IP-bloque (bot detect) | Moyenne | ✅ cookies Firefox en place |
| Gemini quota dépassé (free tier) | Haute si pas upgrade | Upgrade à balanced/premium |
| R2 quota dépassé (10 GB) | Haute | Upgrade payant OU skip 720p |
| Vieilles VODs supprimées | Moyenne | Fallback Leaguepedia static card |
| Multi-game VOD leakage | Connue | ✅ task spawn d'investigation en cours |
| Pollution rate > 50% | Faible | ✅ Wave 12 anti-pollution gate live |

---

## 💡 Décisions à prendre avant de lancer

1. **Budget R2** : payer $8/mois OU skip 720p (49 GB stay free) ?
2. **Budget Gemini** : free 40 jours OU paid 1 jour ?
3. **Scope** : tous les tournois 2021-2024 (31 tournois) OU prioriser les
   moments iconiques (EU Masters wins, LEC Sacre, etc.) ?
4. **VOD source priority** : LEC officielle (qualité max mais souvent 30 min
   de gameplay sans caster) OU Kameto Clips (highlights déjà découpés mais
   moins de coverage) ?

Réponds-moi sur ces 4 décisions et je peux soit :
- Lancer Phase 2 validation immédiatement
- OU continuer à polish d'autres trucs en attendant tes choix

---

*Audit produit le 2026-04-27 par Claude.*
