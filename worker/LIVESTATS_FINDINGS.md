# Livestats API — findings du 11 avril 2026

Session de debug en sandbox Claude Code Web avant reprise en local.
**Tout le code worker est committé mais ces findings critiques ne l'étaient pas encore.**

## TL;DR

Le harvester actuel **ne peut pas marcher** sur des matchs anciens. Il contient
trois bugs majeurs qui ont été identifiés en tapant les vraies APIs. Ces bugs
bloquent complètement la phase zeta.11 (test end-to-end sur 1 match) tant
qu'ils ne sont pas corrigés.

## Découverte #1 — Le feed livestats est purgé après ~3 semaines

Testé sur trois matchs KC de complétude croissante :

| Match | Date | Age au test | Kills détectables via walk-forward |
|-------|------|-------------|---------------------------------------|
| SK vs MKOI (game 1) | 2026-04-11 16:30 UTC | quelques heures | **37 kills** ✅ |
| VIT vs KC | 2026-03-28 15:15 UTC | ~2 semaines | **26 kills** ✅ |
| FNC vs KC | 2026-02-01 18:45 UTC | ~2.5 mois | **0 kills** ❌ (feed vide) |

**Implication** : le backfill des 83 matchs historiques via livestats est
IMPOSSIBLE. Il faut un fallback :
- `services/oracles_elixir.py` (CSV J+1 avec KDA par joueur)
- `services/leaguepedia.py` (Cargo API, kills timestamped)
- Input manuel pour les kills hypes

## Découverte #2 — L'endpoint `/window/{game_id}` a un comportement contre-intuitif

### Comportements observés

```
GET /livestats/v1/window/{game_id}                  → 200 + 10 frames @ game_start
GET /livestats/v1/window/{game_id}?startingTime=... → 200 | 204 | 400
```

- **Pas de `startingTime`** → retourne 10 frames au "game start" moment.
  Ces 10 frames ont toutes le MÊME timestamp à la ms près (snapshot 10x
  d'observateurs différents), pas une série temporelle.
- **`startingTime` avec secondes non-alignées sur 10** → **400 BAD_QUERY_PARAMETER**
  `"startingTime must be aligned to 10 seconds"`
- **`startingTime` aligné mais sans data** → **204 No Content**
- **`startingTime` aligné et valide** → **200 + 10 frames** au moment demandé

### Stratégie de scan correcte

```python
# ❌ Ancien harvester (NE MARCHE PAS)
for offset_min in range(15, 95, 3):   # step 3min trop coarse
    t = match.start + offset_min      # match.start = scheduled, pas actual
    ts = t.strftime(...)              # pas aligné sur 10s
    data = await livestats_api.get_window(game_id, ts)

# ✅ Bonne stratégie
# 1. Call default pour choper le rfc460Timestamp du "game start" réel
data = await livestats_api.get_window(game_id, starting_time=None)
game_start = parse(data["frames"][0]["rfc460Timestamp"])
game_start = round_to_10s(game_start)

# 2. Walk forward en pas de 10 ou 20 secondes jusqu'à 50 minutes
t = game_start + timedelta(seconds=10)
while t < game_start + timedelta(minutes=55):
    ts = t.strftime('%Y-%m-%dT%H:%M:%S.000Z')  # toujours .000Z
    data = await livestats_api.get_window(game_id, ts)
    if data:
        process_frames(data)
    t += timedelta(seconds=10)
```

### Hit rate typique

Sur un walk-forward 10-second step de 50 minutes = 300 probes :
- SK vs MKOI (frais) : **147/300 = 49% hit rate**
- VIT vs KC (2 semaines) : **~30% hit rate**
- FNC vs KC (2.5 mois) : **0% kill data, juste frames vides**

## Découverte #3 — La progression des kills est monotone mais avec sauts

Sample de SK vs MKOI Game 1 (walk 20-second step) :

```
T+01:48  total_kills=1   (first blood)
T+06:49  total_kills=3
T+07:28  total_kills=4
T+09:51  total_kills=5
T+11:52  total_kills=6
T+13:28  total_kills=8   (+2 = teamfight ou double)
T+14:48  total_kills=10  (+2)
T+15:08  total_kills=14  (+4 = teamfight majeur)
T+35:10  total_kills=37  (final count)
```

Les sauts de +2, +3, +4 doivent être correctement attribués. La logique actuelle
dans `_diff_frames` gère les teamfights via corrélation par sides, mais il faut
aussi tenir compte du fait que plusieurs kills peuvent être assignés au même
player dans un unique diff (pour les multi-kills → triple, quadra, penta).

## Découverte #4 — Le match.startTime est MENTEUR

```python
# Match metadata
match["startTime"]       → "2026-04-11T16:30:00Z"  # announced slot
# Actual game 1 in-client start (from livestats default call)
first_frame_ts           → "2026-04-11T17:05:52Z"  # ~35 min later
```

Le scheduled startTime inclut la période de draft + champion select + setup
broadcast avant que la game démarre réellement. L'harvester actuel utilise le
scheduled startTime, ce qui décale toutes ses estimations de +30 min.

**Fix** : ne pas faire confiance à `match.startTime`, toujours appeler
`window/{game_id}` sans params pour déterminer le vrai game start.

## Découverte #5 — Le events array est systématiquement vide

Les endpoints `/window/` et `/details/` retournent tous les deux un schema
où chaque frame a un `events: []`. Sur toutes les calls testées
(150+ frames lus) : **toujours vide**.

**Implication** : on DOIT dériver les kill events par diff de frames sur
les compteurs K/D/A par participant. Pas d'événements discrets exposés.

## Découverte #6 — IDs de games valides pour debug

Les trois games suivants sont connus pour avoir des données livestats
exploitables au moment du test. Utilisables comme fixtures :

```
115548668059523777  SK vs MKOI Game 1    2026-04-11 16:30  37 kills
115548668059523778  SK vs MKOI Game 2    2026-04-11 16:30  similar
115548668059523725  VIT vs KC Game 1     2026-03-28 15:15  26 kills
```

Note : ces IDs sont valides à la date du test. Au-delà de ~3 semaines,
leur feed sera purgé. Mieux vaut refetch un nouveau game_id à chaque
session de debug.

## Bugs à fixer dans le harvester

### Bug 1 — scheduled time au lieu de game start
**Fichier** : `modules/harvester.py` fonction `extract_kills_from_game`

```python
# AVANT
start = datetime.fromisoformat(match_start.replace("Z", "+00:00"))
for offset_min in range(15, 95, 3):
    t = start + timedelta(minutes=offset_min)
```

**Fix** : appeler `livestats_api.get_window(game_id, None)` d'abord, parser
le `rfc460Timestamp` du premier frame, l'utiliser comme anchor.

### Bug 2 — step trop coarse (3 minutes)
Change `range(15, 95, 3)` → walk 10s step sur ~50 minutes.

### Bug 3 — timestamp pas aligné sur 10s
Les timestamps ne sont pas round-down à la seconde × 10 près. Le moindre
`.secondes % 10 != 0` déclenche un 400 BAD_QUERY_PARAMETER.

```python
ts = ts.replace(microsecond=0, second=(ts.second // 10) * 10)
```

### Bug 4 — pas de gestion du 204 No Content
Le `livestats_api.get_window` retourne `None` sur 204, ce qui est bien,
mais l'harvester devrait continuer à walker même sur 10+ 204 consécutifs
sans abandonner le scan.

## Bugs dans services/livestats_api.py

```python
# AVANT — renvoie None silencieusement sur 204
if r.status_code == 200 and len(r.content) > 100:
    return r.json()
```

Pas de bug strict, mais on perd l'info du statut. Idéalement on devrait
retourner un enum `NO_DATA` / `VALID` / `NOT_ALIGNED` pour que l'harvester
sache si l'abandonner est justifié.

## Ce qui est validé et qui marche

- ✅ `services/lolesports_api.py` : `getSchedule`, `getEventDetails` retournent
  des données sensées avec la clé API partagée
- ✅ La chaîne de VOD metadata : `getEventDetails → game.vods[].parameter`
  retourne des YouTube video IDs réels (ex `u1tGfol41yY` en-US,
  `GGZxsLc12gA` fr-FR pour FNC vs KC)
- ✅ ffmpeg 6.1.1 et yt-dlp 2026.03.17 installables et fonctionnels
- ✅ Tous les modules worker s'importent sans erreur et ont leur `run()`
- ✅ Les tests existants `tests/test_harvester.py` et `tests/test_scheduler.py`
  passent tous (5/5 + 5/5)

## Ce qui reste bloqué par credentials

- ❌ Supabase writes (besoin de SUPABASE_SERVICE_KEY)
- ❌ R2 uploads (besoin des R2_*)
- ❌ Gemini analysis (besoin de GEMINI_API_KEY)
- ❌ Discord notifications (besoin de DISCORD_WEBHOOK_URL)

## Plan de reprise en local Claude Code

1. Relancer Claude Code en local dans `C:\...\kckills` (ou équivalent)
2. Checkout de la branche `main-xk4YG` (toutes les mêmes commits)
3. Lire CE fichier en premier
4. Corriger les bugs 1-4 dans `modules/harvester.py`
5. Appliquer la même logique dans `modules/pipeline.py` (qui appelle
   `extract_kills_from_game`)
6. Tester sur l'un des game_ids listés ci-dessus (utiliser un match récent)
7. Une fois le harvester OK, brancher Supabase/R2/Gemini et tenter un
   pipeline end-to-end complet
