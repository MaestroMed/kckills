# SPEC — Backfill propre & Algorithme de Décryptage VOD
## Requirements pour Fable — kckills.com
### Rédigé le 2026-07-14 par Kairos (Opus). Destinataire : Fable (claude-fable-5).

> **But du document.** Mehdi veut un backfill **propre et rigoureux** de tous
> les kills KC : chaque VOD et chaque clip passés « au crible », multi-vérifiés,
> avec un offset + un drift calculés à **plusieurs instants de la partie** (un
> vrai algorithme de décryptage pour localiser chaque kill dans la VOD), et
> **une méga-table** qui centralise tout. Le coût en tokens n'est pas une
> contrainte (« tant pis si ça coûte »). Ce document décrit l'état actuel, les
> problèmes, et ce qu'il faut construire. Il est **auto-suffisant** : Fable n'a
> pas besoin de la conversation d'origine.

---

## 0. TL;DR — ce qu'il faut livrer

1. **Méga-table `clip_ledger`** — une ligne par kill canonique, avec TOUT :
   sources VOD, offset par source, échantillons de drift à N instants, hiérarchie
   multi-kill, verdicts QC multi-passes, état de chaque asset. (§4)
2. **Algorithme de décryptage offset/drift multi-points** — remplace le
   single-point actuel. Échantillonne le timer in-game à plusieurs game-times,
   ajuste un modèle de drift (linéaire + sauts de pause), robuste à une panne
   Gemini via fallbacks. (§5)
3. **Règle de dédup multi-kill** — un quadra EST aussi un triple et un double :
   collapse la séquence en UN kill canonique (tier max), les sous-paliers
   deviennent des métadonnées, pas des clips séparés. (§6)
4. **QC multi-vérification par clip** — « bon départ, bon clip » : plusieurs
   checks indépendants avant publication. (§7)

---

## 1. Contexte pipeline (état actuel)

Worker Python asyncio local (`worker/`), Supabase Postgres + RLS, clips sur
Cloudflare R2 (`clips.kckills.com`), front Next.js sur Vercel. Le worker détecte
les kills, trouve les VODs, clippe (yt-dlp + ffmpeg), analyse (Gemini), publie.

Flux d'un kill :
```
harvester (détection kill via diff de frames livestats)
  → event_publisher (insert kills, status='raw')
  → vod_hunter (trouve VOD + offset officiel getEventDetails)
  → vod_offset_finder_v2 (affine l'offset via scan Gemini du timer)
  → clipper (yt-dlp --download-sections + ffmpeg triple format)
  → clip_qc (re-lit le timer du clip réel, re-clippe si drift > 45s, max 3x)
  → analyzer (Gemini : highlight_score, tags, description)
  → og_generator → published
```

Modules pertinents : `modules/harvester.py`, `modules/vod_offset_finder_v2.py`,
`modules/clip_qc.py`, `modules/clipper.py`, `modules/analyzer.py`,
`modules/event_publisher.py`, `modules/job_dispatcher.py`.

⚠️ **Ne pas casser la session parallèle** : au moment de l'écriture,
`clipper.py`, `event_publisher.py`, `job_dispatcher.py` ont des modifs
non-commitées (debug retro-clips en cours). Coordonner avant d'y toucher.

---

## 2. Schéma actuel (ce sur quoi s'appuyer)

Tables clés (voir `supabase/migrations/`, dernière = **087**, la **088** libre —
la mémoire projet indique qu'une 088 « clé de dédup NULL-proof » a peut-être
déjà été appliquée via le SQL editor : **vérifier avant de numéroter**).

- **`kills`** — cœur produit. Champs : `game_id`, `event_epoch` (BIGINT,
  pause-proof), `game_time_seconds`, `killer_player_id`/`killer_champion`,
  `victim_player_id`/`victim_champion`, `assistants` JSONB, `confidence`
  (high/medium/low/estimated/verified), `tracked_team_involvement`
  (team_killer/team_victim/team_assist), `is_first_blood`, `multi_kill`
  (null/double/triple/quadra/penta), `clip_url_*`, `highlight_score`,
  `ai_tags`, `ai_description`, `status` (raw→enriched→vod_found→clipping→
  clipped→analyzed→published, + clip_error/manual_review/**duplicate**),
  `retry_count`.
- **`games`** — `vod_youtube_id`, `vod_offset_seconds` (offset officiel),
  `alt_vod_youtube_id`, `alt_vod_stream_start_epoch`, `alt_vod_delay_seconds`.
- **`game_vod_sources`** — multi-source : `source_type`
  (official_lec/kameto/etostark/other), `platform`, `video_id`,
  `offset_seconds`, `stream_start_epoch`, `stream_delay_seconds`,
  `sync_validated`, `priority`. **C'est déjà la bonne granularité pour le
  multi-source ; la méga-table doit s'y référer, pas la dupliquer.**
- **`kill_assets`** (migration 026) — un asset = un fichier généré
  (h/v/v_low/thumb) avec `is_current` + `content_hash`. ⚠️ **`content_hash` a
  une contrainte UNIQUE** (migrations 010 / 030). ⚠️ **PIÈGE MÉMOIRE** : ne
  JAMAIS supprimer les `kill_assets` par `is_current=false` (le GC R2 doit être
  référence-based : des `clip_url_*` pointent sur des v1 `is_current=false`
  encore servies). Dédup = **neutraliser** (`status='duplicate'`), **jamais
  delete**.

---

## 3. Les 5 problèmes à résoudre

### P1 — Doublons multi-kill (diagnostic de Mehdi, correct)
> « Il y a des doubles parce qu'un quadra est aussi un triple kill et aussi un
> doublé. Faut gérer ça. »

En LoL l'annonceur crie « Double Kill » puis « Triple Kill » puis « Quadra Kill »
au fur et à mesure. Le harvester crée un kill à chaque palier (ou le clipper
clippe des fenêtres qui se chevauchent), → 2–4 clips au **contenu quasi
identique** → collisions `content_hash` (voir P4) → doublons dans le feed.
`modules/harvester.py::_detect_multi_kill(delta_kills)` mappe delta→tier, et une
fenêtre glissante 30 s « rattrape » les pentas étalés — c'est là que naissent
les chevauchements.

### P2 — Offset drift (la plainte principale)
`vod_offset_finder_v2` : calcule un candidat via heuristique epoch, valide le
timer à **candidat+60 s** (1 point), scanne par pas de 90 s jusqu'à +30 min si
Gemini voit NONE. `clip_qc` : re-lit le timer au **milieu du clip** (1 point),
re-clippe si drift > 45 s (max 3×). **Deux single-point Gemini.** Problèmes :
- Pas de modèle de drift dans le temps : les streams Twitch (Kameto/Eto) ont un
  delay variable + pauses → le drift n'est pas constant sur la partie. Valider à
  1 instant ne garantit rien aux autres instants.
- 100 % dépendant de Gemini (vision timer). Panne Gemini = offset non validé =
  clips qui montrent morts / draft / plateau (exactement ce que Mehdi voit).

### P3 — Pas de méga-table
La vérité est éparpillée : `kills` (timing/kill), `games` + `game_vod_sources`
(VOD/offset), `kill_assets` (fichiers/hash). Impossible de voir d'un coup, pour
un kill : quelles sources ont été essayées, quel offset par source, quel drift
mesuré à quels instants, quels checks QC ont passé/échoué. Mehdi veut ça
centralisé (« t'aurais dû te créer une méga-table, avec tout dedans »).

### P4 — `content_hash` UNIQUE → 409 sur le status-flip batch
Log actuel : 934 lignes `batch_update_in_clause_failed_falling_back` + 2 754
hits `23505` (`Key (content_hash)=… already exists`). Deux clips identiques
(P1) → même hash → le PATCH batch qui écrit le hash 409 → fallback. **Piège
mémoire `clip-status-flip-no-unique-cols`** : ne jamais mettre `content_hash`
(index UNIQUE) dans un PATCH de flip de statut ; sinon 409 → cache SQLite →
drop → kill bloqué. Le hash doit être écrit **une seule fois** au moment de la
création de l'asset, jamais dans un update de statut, et une collision doit
**router vers la dédup** (neutraliser le nouveau), pas faire échouer le batch.

### P5 — Fragilité Gemini (incident en cours)
Le **spend cap mensuel Google AI Studio est atteint depuis le 2026-07-13
14h29 (Paris)** : 3 606 appels `429 RESOURCE_EXHAUSTED` en ~12 h. Tier =
`premium` (Gemini 3.5 Flash, $1.50/$9 par M) + auto-upgrade sur chaque multikill
+ lectures de timer sur input vidéo (cher) → le backfill plein régime a vidé le
cap en ~1 jour. **Conséquence** : scoring QC ET validation d'offset tous deux
morts. L'algo de décryptage **doit** dégrader gracieusement sans Gemini (§5.4).

---

## 4. MÉGA-TABLE — design proposé (`clip_ledger`)

Une ligne = un **kill canonique** (après dédup multi-kill). Référence les tables
existantes plutôt que de les copier. Colonnes proposées (à affiner) :

```sql
CREATE TABLE clip_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kill_id UUID REFERENCES kills(id) NOT NULL,      -- kill canonique
    game_id UUID REFERENCES games(id) NOT NULL,

    -- Identité du kill (dénormalisé pour l'audit d'un coup d'œil)
    event_epoch BIGINT NOT NULL,
    game_time_seconds INT,
    killer_champion TEXT, victim_champion TEXT,
    multi_kill TEXT,                                 -- tier canonique max

    -- Hiérarchie multi-kill (résout P1) : les paliers absorbés
    multi_kill_tier INT,                             -- 2..5
    absorbed_kill_ids UUID[],                        -- les sous-kills neutralisés
    sequence_start_epoch BIGINT,                     -- 1re mort de la séquence
    sequence_end_epoch BIGINT,                       -- dernière mort

    -- Décryptage offset/drift PAR SOURCE (résout P2/P3)
    vod_source_id UUID REFERENCES game_vod_sources(id),  -- source retenue
    resolved_offset_seconds NUMERIC,                 -- offset final utilisé
    drift_samples JSONB,                             -- [{game_time, vod_time, timer_read, method, confidence}, ...]
    drift_model JSONB,                               -- {type:'linear'|'piecewise', slope, intercept, breakpoints:[...]}
    offset_confidence NUMERIC,                       -- 0..1

    -- QC multi-passes (résout P7)
    qc_checks JSONB,                                 -- [{name, verdict, score, detail}, ...]
    qc_verdict TEXT,                                 -- pass|reject|needs_review
    qc_pass_count INT,

    -- Assets & dédup (résout P4)
    content_hash TEXT,                               -- PAS UNIQUE ici : c'est un registre, pas une contrainte
    is_duplicate_of UUID REFERENCES clip_ledger(id), -- si dédup
    asset_ids UUID[],                                -- kill_assets liés

    status TEXT,                                     -- même machine d'état + 'duplicate'
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
```

Principes :
- **`content_hash` sans UNIQUE dans le ledger** — c'est un journal d'audit. La
  détection de doublon se fait par requête (`GROUP BY content_hash HAVING
  count > 1`) + par la clé sémantique multi-kill, pas par une contrainte qui
  fait 409.
- **`drift_samples`** matérialise l'exigence « offset et drift calculés à
  différents temps de la partie » : chaque échantillon = (game_time visé, temps
  VOD réel, timer lu, méthode, confiance).
- Le ledger **n'efface rien** : neutralisation via `is_duplicate_of` +
  `status='duplicate'`.

---

## 5. ALGORITHME DE DÉCRYPTAGE (offset + drift multi-points)

### 5.1 Principe
Ne plus valider à **1** instant, mais **échantillonner le mapping game_time ↔
vod_time à N instants** répartis sur la partie, puis **fitter un modèle de
drift** et l'utiliser pour placer *n'importe quel* kill au bon endroit de la VOD.

### 5.2 Échantillonnage
Pour chaque source VOD d'une game, lire le timer in-game à ~5–8 game-times
répartis (ex. 5 %, 20 %, 40 %, 60 %, 80 %, 95 % de la durée). Pour chaque point :
`vod_time_at_frame - timer_read = game_start_in_vod (candidat)`. Stocker chaque
mesure dans `drift_samples`.

### 5.3 Modèle de drift
- **VOD officielle LEC** : offset quasi constant (pas de pause côté broadcast) →
  modèle **linéaire** (souvent pente ≈ 0). Les pauses in-game sont déjà gérées
  par l'epoch (`event_epoch`), donc pour l'officiel l'offset epoch-based suffit
  et **n'a pas besoin de Gemini** (cf. 5.4).
- **Streams Twitch (Kameto/Eto)** : delay variable + le streamer met en pause /
  coupe → drift **par morceaux (piecewise)**. Détecter les breakpoints (sauts
  brusques entre échantillons consécutifs) et fitter un segment linéaire entre
  chaque. Rejeter les échantillons aberrants (RANSAC / médiane).
- Sortie : `drift_model` + `offset_confidence` = qualité du fit (résidus).

### 5.4 Dégradation sans Gemini (impératif — cf. P5)
L'algo doit produire un offset exploitable **même Gemini à sec** :
- **Officiel** : `vod_offset_seconds` de `getEventDetails` est fiable →
  clipper directement, `offset_confidence` moyenne, à re-valider quand Gemini
  revient. **Aucun Gemini requis pour les VODs officielles.**
- **Fallbacks vision non-Gemini** à évaluer : OCR local du timer (Tesseract sur
  le crop coin-haut du HUD), détection du killfeed, empreinte audio du shout
  caster, matching de la minimap. Ces fallbacks alimentent `drift_samples` avec
  `method` ≠ 'gemini' et une `confidence` propre.
- **Budget Gemini** quand dispo : scheduler partagé, délai min 4 s, plafond
  ~950 RPD, reset 07:00 UTC. Réserver Gemini aux points ambigus, pas à tout.

### 5.5 Multi-source
Choisir la source retenue par `game_vod_sources.priority` + `offset_confidence`
+ disponibilité. Garder les autres comme sources de secours dans le ledger
(permet le switch multi-source côté front `/kill/[id]`).

---

## 6. DÉDUP MULTI-KILL (résout P1 + P4)

Règle : **une séquence multi-kill = UN kill canonique**.
- Détecter une séquence : même `killer_player_id`, morts consécutives dans une
  fenêtre glissante (≤ ~10 s entre morts, borne penta ~30 s), camp victime
  opposé. Le harvester a déjà `_detect_multi_kill` + fenêtre 30 s — réutiliser.
- **Collapse** : garder le kill du **tier max** (penta > quadra > triple >
  double) comme canonique ; les paliers inférieurs de la MÊME séquence →
  `status='duplicate'`, référencés dans `absorbed_kill_ids` + `is_duplicate_of`.
  **Jamais de delete** (piège R2/kill_assets).
- Le clip canonique couvre toute la séquence (`sequence_start_epoch` →
  `sequence_end_epoch` + pads).
- **Doublons non-multikill** (même kill détecté 2× par ré-runs) : dédup par clé
  sémantique NULL-proof `(game_id, event_epoch, victim_champion)` (la mémoire
  indique une migration 088 en ce sens) **et/ou** `content_hash` identique. En
  cas de collision hash sur insert : compter `23505` comme « déjà présent »
  (confirmé), router vers neutralisation, **ne pas** faire échouer le batch et
  **ne pas** mettre `content_hash` dans un PATCH de flip de statut.

---

## 7. QC MULTI-VÉRIFICATION PAR CLIP (« bon départ, bon clip »)

Chaque clip candidat passe **plusieurs checks indépendants** avant `published` ;
verdict = agrégat (ex. tous les checks bloquants doivent passer). Stocker dans
`qc_checks`. Checks proposés :

| Check | Question | Méthode |
|---|---|---|
| `start_is_gameplay` | La 1re seconde est bien du gameplay LoL (pas draft/plateau/pub) ? | vision (Gemini ou fallback OCR HUD) |
| `timer_matches` | Le timer lu ≈ `game_time_seconds` attendu (drift < seuil) ? | §5, multi-points |
| `kill_visible` | Le kill est visible à l'écran (pas hors-champ) ? | vision |
| `actors_match` | Champions killer/victim à l'écran == métadonnées ? | vision / killfeed |
| `duration_sane` | Durée dans les bornes, pas de gel/frame noire ? | ffprobe + diff de frames |
| `audio_present` | Piste audio caster présente (≥ seuil RMS) ? | ffprobe |
| `not_duplicate` | `content_hash` + clé sémantique non déjà publiés ? | requête ledger |

« Multi vérif » = idéalement **plusieurs passes / angles** sur les checks vision
critiques (ex. 2–3 lectures indépendantes du timer + vote), le coût en tokens
étant explicitement accepté par Mehdi. Un clip qui échoue un check bloquant →
`needs_review` (jamais publié tel quel), pas `published`.

---

## 8. Contraintes & garde-fous (NON négociables)

- **RLS** activé partout ; worker = service role, front = anon key.
- **Clips sur R2 uniquement**, jamais via Supabase (egress). GC R2
  **référence-based** ; ne jamais supprimer `kill_assets` par `is_current`.
- **`content_hash` UNIQUE** = piège : hors de tout PATCH de statut ; collision →
  dédup, pas 409-fail.
- **Dédup = neutraliser (`status='duplicate'`)**, jamais delete.
- **Migrations** appliquées par Mehdi via le SQL editor Supabase (pas d'auto).
  Numéroter à partir de **088** après vérif (une 088 dédup peut déjà exister).
- **Secrets** (`worker/.env`) jamais commités/échoués.
- **Scheduler global** : tous les appels externes passent par lui (Gemini 4 s /
  950 RPD, yt-dlp 10 s + backoff 429, etc.).
- **Règle produit** : on n'affiche QUE les kills où KC tue (`team_killer`),
  jamais les morts KC.
- **Cap Gemini** : à relever par Mehdi sur https://ai.studio/spend ; l'algo ne
  doit pas *dépendre* d'un cap non-atteint pour produire un offset correct.

---

## 9. Livrables attendus de Fable

1. Migration `088+` : table `clip_ledger` (§4) + index (game_id, kill_id,
   content_hash non-unique, status partiel).
2. Migration dédup multi-kill : colonnes d'absorption sur `kills` si besoin +
   backfill des séquences existantes en `status='duplicate'`.
3. Module `modules/decryptage.py` (ou refonte `vod_offset_finder_v2` +
   `clip_qc`) : échantillonnage multi-points, fit du modèle de drift, fallbacks
   non-Gemini (§5).
4. Module QC multi-passes (§7) alimentant `qc_checks`/`qc_verdict`.
5. Script de backfill one-shot : rejoue TOUS les kills existants dans le
   nouveau pipeline (au crible), remplit `clip_ledger`, neutralise les doublons.
6. Tests avec fixtures (`worker/fixtures/`) pour : dédup multi-kill, fit de
   drift piecewise, dégradation sans Gemini.

---

*Document de référence pour Fable. Rien de destructif ne doit être exécuté sans
validation de Mehdi (migrations manuelles, GC R2, neutralisation de masse).*
