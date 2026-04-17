# Scroll Vivant V1 — Handoff

Branche : `claude/fix-deployment-error-ETzEU`
Dernière session : refonte homepage en grille magnétique 4 axes + zoom-in TikTok.

## État actuel

| Phase | Statut | Artefacts |
|-------|--------|-----------|
| 1. Worker + dimensions | ✅ code | migration `004_scroll_vivant_dimensions.sql`, prompt Gemini refactor, script `worker/scripts/reanalyze_backlog.py` |
| 2. Design primitives | 🟡 partiel | PageHero / StatCard / NavCard / FilterChips créés, appliqués sur `/records` uniquement |
| 3. Grid engine | ✅ | `components/grid/*` + `hooks/useGridEngine.ts` + `lib/grid/*` + `ScrollVivantSection` intégrée dans `app/page.tsx` |
| 4. Zoom-in grid → scroll | ✅ | `components/scroll/ScrollFeed.tsx` extrait, filtre `?kill&axis&value` |
| 5. Reduced-motion + a11y | ✅ | tilt 3D désactivé si `prefers-reduced-motion`, focus-visible sur cellules |

## Pour mettre en ligne (ordre à respecter)

### 1. Migration Supabase
```sql
-- déjà appliquée par toi (✅ confirmé)
-- fichier : supabase/migrations/004_scroll_vivant_dimensions.sql
```
Si besoin de re-vérifier :
```sql
SELECT column_name FROM information_schema.columns
 WHERE table_name = 'kills'
   AND column_name IN ('lane_phase','fight_type','objective_context',
                       'matchup_lane','champion_class','game_minute_bucket');
-- doit retourner 6 lignes
```

### 2. Re-analyser le backlog (critique)

La grille est vide tant que les 6 dimensions ne sont pas remplies.

```bash
cd worker

# dry-run pour compter
python scripts/reanalyze_backlog.py --dry-run

# traiter en batchs (quota Gemini 950 RPD, 4s/kill → max ~4h)
python scripts/reanalyze_backlog.py --limit 100
# idempotent : skip les kills où lane_phase IS NOT NULL
```

Vérif de progression :
```sql
SELECT
  COUNT(*) FILTER (WHERE lane_phase IS NOT NULL) AS enriched,
  COUNT(*) AS total
FROM kills WHERE status = 'published';
```

La grille devient utilisable dès ~60% d'enrichissement (selon le plan). Avec 100% elle est dense.

### 3. Vérif côté front

Une fois le backlog traité, `fn_get_grid_cells` doit retourner des lignes :
```sql
SELECT cell_x, cell_y, kill_count
  FROM fn_get_grid_cells('game_minute_bucket', 'killer_player_id', '{}')
 LIMIT 10;
```

Puis vérifier sur `/` que la section "Scroll sur 4 axes" s'affiche entre le HERO et le ROSTER. Si elle ne s'affiche pas : soit 0 cellules retournées, soit 0 joueurs trackés (`getTrackedRoster()` → `teams.is_tracked = true`).

## Scope reporté (hors V1)

### Cosmétique
- ✅ PageHero appliqué sur `/hall-of-fame`, `/stats`, `/compare`. PageHero étendu avec un variant `cinematic` + tag/accent/topRight/scrollHint pour réutilisation future.
- ❌ `/era/[id]` et `/alumni/[slug]` gardent leur hero cinematic propre — remplacés par un **PortraitCubeMorph** (Canvas dot-matrix qui fait morpher entre les champion splashes de l'ère / signatureChampion de l'alumni). Cf. ci-dessous.
- ✅ Migration `<img>` → `next/image` complétée sur `era/[id]`, `alumni/[slug]`, `hall-of-fame`, `player/[slug]`, `top`, `KCTimeline` (popup), `KillOfTheWeek`. Reste : `homepage page.tsx` (4 imgs encore), `HomeClipsShowcase`, `HomeFilteredContent`, `not-found`, `kill/[id]`, `navbar` (logo SVG inline OK), composants `CommentPanel`, `video-player`, `ScrollFeed` (aggregate item), et `KCTimeline` (m.img motion-wrapped — à voir si on garde Framer ou migre).
- ❌ Nettoyage `@keyframes` non fait (low value, risk medium).

### UX avancée
- ✅ **Pinch-zoom mobile sur la grille** — `GridCanvas.tsx`. 2 doigts qui s'écartent au-delà d'un ratio 1.45 → navigation vers `/scroll?kill=&axis=&value=` du cell actif. Pendant le pinch, la grille suit les doigts en temps réel (transition 60ms). Au relâchement : si committed, animation "diving in" 220ms (scale 1.6 + opacity 0.4) puis router.push.
- ✅ **Shared-layout grille ↔ scroll** via la **View Transitions API native** (Chrome 126+, Safari 18+). Pas de Framer layoutId. CSS `@view-transition { navigation: auto }` dans `globals.css` + `view-transition-name: kill-<id>` sur la cellule active de la grille ET sur l'item du scroll qui matche `initialKillId`. Le browser morphe automatiquement le rectangle entre les deux pages. Dégradation silencieuse sur Firefox.

### Cube portrait morph (nouveau, marquee feature)
- `components/PortraitCubeMorph.tsx` — composant client Canvas qui sample chaque image source en grille brightness (60×80 par défaut), puis dessine des cubes iso-gold dont l'opacité/taille encodent l'intensité.
- Crossmorph cellule par cellule entre N images sur un cycle `holdMs` + `morphMs`.
- Honor `prefers-reduced-motion` (collapse sur 1 seule image, pas de cycle).
- Pause sur `document.hidden` (Page Visibility API).
- Utilisé sur :
  - `/era/[id]` : top 6 champions distincts de l'ère, accent = `era.color`
  - `/alumni/[slug]` : `loading` + `splash` du signatureChampion en boucle, accent = `accentColor`

### V2 (adaptatif, post-launch)
- Embeddings pgvector sur `ai_description` pour un axe "kills similaires"
- Algorithme qui remap les axes selon les préférences comportementales détectées
- Persistance DB des événements Umami pour ML collaboratif
- Backoffice CMS pour curer les clips hero, les ères, les alumni, et la playlist du carrousel YouTube sans deploy

### V2 — Concepts différenciants (à designer / prototyper)

#### Sphere Scroll 360 Horizon
Concept à explorer : une variante du `/scroll` où les kills ne défilent pas verticalement mais s'enroulent sur un horizon sphérique 3D — l'utilisateur scrolle "autour" plutôt que "vers le bas". Inspiration : le HUD d'Iron Man, les visions astrales. Permettrait un parallax encore plus immersif et un onboarding magique. À prototyper sur three.js ou react-three-fiber, possiblement gated derrière un toggle "Mode immersif".

#### Cube Morphing Map sur les pages joueur
Étendre le `PortraitCubeMorph` (déjà déployé sur era + alumni) aux pages `/player/[slug]`. Pour chaque joueur du roster actif, le hero morphe entre :
1. Sa photo officielle LEC
2. Son champion signature (splash)
3. 1-2 portraits Karmine Life si dispo
4. Optionnel : un portrait IA généré "héroïque"
La map de cubes pourrait pulser au beat d'un thème sonore propre au joueur.

#### Sound design synchro morphing
Composer / sourcer une nappe sonore dédiée aux transitions cube-morph (era, alumni, player). Idée : un drone Hextech (KR / FR ambient), un "swoosh" cristallin sur chaque transition de portrait, un sub-bass discret quand un cube atteint pleine intensité. À gater sur autoplay-policy (premier interaction utilisateur), avec mute par défaut + bouton son global. Référence : Apple TV + intros, Riot Games Cinematic Trailers.

#### Clip-centric platform — composant réutilisable filtré par contexte
Le tagging profond qu'on vient de poser sur les 340 kills (les 6 dimensions Scroll Vivant + `killer_player_id`, `victim_player_id`, `match_external_id`, `tracked_team_involvement`, `multi_kill`, `is_first_blood`, `highlight_score`, `avg_rating`) ouvre la voie à une vraie plateforme **clip-centric** : la même section vidéo, déclinable sur toutes les pages du site avec un simple changement de filtre.

**Plan** :
1. Extraire un composant unique `<ClipReel filter={...} />` (peut-être 2 variants : `compact-grid` pour les pages secondaires + `parallax-ribbon` réutilisant le moteur du carrousel YouTube actuel pour les hero secondaires).
2. Le `filter` est un objet typé qui se traduit en query Supabase + scoring :
   ```ts
   type ClipFilter = {
     killerPlayerId?: string;          // page joueur
     victimPlayerId?: string;          // page joueur (kills subis)
     matchExternalId?: string;         // page match
     championKiller?: string;          // page champion (future)
     championVictim?: string;
     fightType?: FightType;            // page filtrée par type
     laneMatchup?: MatchupLane;        // axe lane
     minuteBucket?: MinuteBucket;
     opponentCode?: string;            // page rival (G2, FNC...)
     trackedTeamInvolvement?: 'team_killer'|'team_victim'|'team_assist';
     minHighlight?: number;            // "best of"
     limit?: number;
   };
   ```
3. Côté Supabase : RPC `fn_get_clips_filtered(p_filter jsonb, p_limit int)` qui projette les colonnes minimum (id, killer/victim, thumbnail, clip_url_vertical, clip_url_horizontal, ai_description, multi_kill, highlight_score, avg_rating) — réutilisable, RLS-friendly, egress-controlled.
4. Pages cibles immédiates :
   - **Page joueur** (`/player/[slug]`) : remplace l'agrégation actuelle par `<ClipReel filter={{ killerPlayerId, minHighlight: 6, limit: 12 }} />` + un second reel "kills subis" + un reel "carry games".
   - **Page match** (`/match/[slug]`) : `<ClipReel filter={{ matchExternalId }} />` + sous-sections par game.
   - **Page rivalité** (futur `/rivalry/[opponentCode]`) : `<ClipReel filter={{ opponentCode, limit: 20 }} />`.
   - **Page champion** (futur `/champion/[name]`) : `<ClipReel filter={{ championKiller }} />` + reel "vs ce champion".
   - **Page joueur d'équipe rivale** (futur) : symétrique.
5. Variant `parallax-ribbon` peut directement réutiliser `YouTubeParallaxCarousel` en généralisant son input (`{ id, title, thumbnail, accentColor, channelLabel, onPlay }`) — soit on factorise l'animation dans un `<ParallaxRibbon items={...} />` agnostique, soit on passe les clips KC dans la même structure.
6. Tracking Umami : un event `clip_reel_view` avec `{ context, filter_summary }` pour mesurer ce que les users consultent par contexte → V2 personalization signal.

Cette refonte transforme le scroll vivant d'une seule expérience en briques composables — chaque page du site devient un point d'entrée vers les bons clips.

#### Hero poster breathing (déjà livré)
La photo de fond du hero homepage respire désormais (opacity 0.55↔1, scale 1↔1.018, 9s cycle). Cf `globals.css` — `.hero-poster-breathe`. Cycle calé pour ne pas distraire la lecture du clip qui tourne au-dessus.

### V2 (adaptatif, post-launch)
- Embeddings pgvector sur `ai_description` pour un axe "kills similaires"
- Algorithme qui remap les axes selon les préférences comportementales détectées
- Persistance DB des événements Umami pour ML collaboratif

## Architecture clé à connaître

### Les 4 axes (`web/src/lib/grid/axis-config.ts`)
- `game_minute_bucket` (horizontal par défaut) : 0-5, 5-10, ... 35+
- `killer_player_id` (vertical par défaut) : UUID roster KC → label IGN
- `opponent_team_code` (diagonale ↘) : dérivé dans la RPC via LATERAL join
- `fight_type` (diagonale ↙) : solo_kill, gank, 2v2, 3v3, 4v4, 5v5, pick

### La RPC (`fn_get_grid_cells`)
Whitelist stricte sur `p_axis_x` / `p_axis_y` (protection RLS). Retourne 1 ligne par cellule avec `top_kill_id` choisi par `ROW_NUMBER() OVER (PARTITION BY cx, cy ORDER BY avg_rating DESC)`.

### Le flux zoom-in
Tap GridCell → `/scroll?kill=<uuid>&axis=<axisY>&value=<cellY>` → page filtre les `videoItems` par `videoMatchesFilter(axis, value)` → `ScrollFeed` reçoit `initialKillId` et scroll l'élément en vue au mount.

### Instrumentation (V2-ready)
Events Umami déjà émis (`lib/grid/analytics.ts`) :
- `grid_scroll_direction` (axe x/y/diagonale)
- `grid_cell_view` (avec dwell_ms)
- `grid_cell_zoom_in` (tap → scroll mode)
- `grid_axis_pivot` (changement via AxisPivot)

Ces events alimenteront le remapping adaptatif V2.

## Risques connus

- **Gemini hallucine sur les 6 nouveaux champs** : validation stricte dans `analyzer._enum_or_none` + fallback NULL. `minute_bucket` et `lane_phase` sont recalculés côté serveur depuis `game_time_seconds` (ground truth) après la réponse Gemini.
- **Egress Supabase** : la RPC retourne uniquement les colonnes nécessaires (pas de SELECT *). Budget ~50 KB par chargement homepage (64 cellules × ~800B).
- **Bundle grid** : 11.4 kB dans la route `/scroll`, le `GridCanvas` client n'est pas lazy-loaded en V1 (pas nécessaire au vu de la taille).

## Commandes utiles

```bash
# Dev
cd web && npm run dev
# → http://localhost:3000 (grille sur la homepage)

# Build de vérif
cd web && npx next build

# Worker re-analyze
cd worker && python scripts/reanalyze_backlog.py --limit 50

# Applied migrations
psql $DATABASE_URL -c "\\dt kills" -c "\\df fn_get_grid_cells"
```

## Contact / contexte

Session initiale : audit + refonte après discussion sur l'écart entre homepage et pages secondaires. Vision partagée : transformer le scroll vertical mono-axial en grille 360° magnétique pivotable sur 4 dimensions, avec instrumentation from day 1 pour un V2 adaptatif.

Le but opérationnel : montrable à EtoStark pour feedback live en stream.
