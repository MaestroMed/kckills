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
- PageHero à appliquer sur : `/hall-of-fame`, `/era/[id]`, `/alumni/[slug]`, `/stats`, `/compare`, `/review`
- Migration `<img>` → `next/image` dans `KillCard`, `PlayerCard`, `era/[id]`, `alumni/[slug]`, `hall-of-fame`, `records`
- Nettoyage des 22 `@keyframes` dans `globals.css`

### UX avancée
- Pinch-zoom sur mobile (remplace le tap) — nécessite gesture handler custom ou Framer Motion
- Shared-layout animation grille ↔ scroll via Framer `layoutId` (V1 utilise router.push à la place)

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
