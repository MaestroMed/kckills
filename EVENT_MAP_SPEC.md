# EVENT MAP SPEC — Canonical Game Events Architecture

**Date** : 2026-04-23
**PR** : PR6-B (migration 014, event_mapper module)
**Status** : Active design — landing in pieces, see Roadmap below

---

## The Problem (User's Words)

> "Il te faut une table profonde qui retient tous les moves de la game pour
> éviter les doublons et les repassees en boucle. On doit vraiment publié
> rétro activement du très bon. Que du bon. Et pour ça il faut qu'on soit
> sûr de ce qu'on envoie et qu'on l'envoie bien : Un solokill est un
> solokill, un teamfight est un teamfight, etc. Faut peut être tout mapper
> d'abord et ensuite coché les cases dès qu'on a les clips propre, bien QC
> checked, etc ?"

Translated to engineering :

1. **Map first, tick boxes after** — every detectable event should land in
   a single canonical table BEFORE any clip work happens. We then "tick
   boxes" (clipped ✓, QC'd ✓, described ✓, ...) as gates pass.
2. **Strong typing** — a solo_kill IS a solo_kill, never accidentally
   classified as a teamfight by a half-broken regex.
3. **No duplicate processing** — once an event is mapped, the pipeline
   never re-detects it. No infinite loops, no double-clipping.
4. **Curate retroactively** — only the very best ships to the site. The
   gate is explicit and reversible (admin can pull a clip back).

## The Old Pipeline (and why it falls short)

```
livestats   ──► harvester  ──► kills (status='raw')
                                 │
                                 ▼
                            transitioner
                                 │ (status='vod_found')
                                 ▼
                              clipper ──► R2 (h, v, v_low, thumb)
                                 │ (status='clipping' → 'clipped')
                                 ▼
                              analyzer ──► Gemini
                                 │ (status='analyzed')
                                 ▼
                            og_generator ──► R2 (og.png)
                                 │ (status='published')
                                 ▼
                               /scroll
```

Issues :
- The `kills.status` enum tries to be both **what kind of event** and
  **how far through processing** — these collide. There's no canonical
  "we know about all 14 kills in this game" snapshot.
- `kill_visible`, `clip_validated`, `needs_reclip`, `confidence` are
  scattered. No single "ready to publish?" signal — `og_generator` flips
  to `published` based on `status='analyzed'` alone.
- No record of events the pipeline FAILED to map. If livestats was down
  for 30s and we missed a teamfight, nothing tells us.
- Re-running `harvester` for a backfill would either double-insert or
  silently skip — no audit trail of what's been mapped.
- Future detectors (objectives, ganks, picks) would each need their own
  table or another overload of `kills`.

## The New Pipeline

```
livestats     ──► harvester      ──► kills (legacy, kept for compat)
                                  ──► moments (legacy, kept for compat)
                                       │
                                       ▼
                                  event_mapper ──► game_events  ◄── CANONICAL MAP
                                                       │
                                                       │  qc_clip_produced ✓
                                  clipper writes ──────┤  qc_typed ✓
                                                       │
                                                       │  qc_clip_validated ✓
                                  clip_qc writes ──────┤
                                                       │
                                                       │  qc_visible ✓ qc_described ✓
                                  analyzer writes ─────┤
                                                       │
                                                       │  qc_human_approved (optional)
                                  admin UI writes ─────┤
                                                       │
                                                       ▼
                                            is_publishable (GENERATED)
                                                       │
                                                       ▼
                                  event_publisher ──► /scroll feed
                                       (sets published_at)
```

Key shifts :

- **`game_events` is the single source of truth.** Every detectable event
  gets exactly one row, with strong typing on `event_type`.
- **The QC checklist is explicit.** Six boolean columns, each owned by
  the module that ticks it. `is_publishable` is `GENERATED ALWAYS AS`
  from those gates — application code can never lie about the state.
- **Existing tables stay.** `kills` and `moments` remain as-is, with a
  soft FK from `game_events.kill_id` / `moment_id`. Legacy consumers
  (admin UI, /scroll RPC) don't break overnight.
- **Game-level completion**. `games.event_mapping_complete` flips TRUE
  once `event_mapper` has produced one row per detected event for a
  game. Idempotent re-runs are no-ops.

## The Schema (migration 014, full SQL in repo)

### `game_events` columns by category

**Identity** :
- `id UUID` — PK
- `game_id UUID` — FK to games

**WHAT happened** :
- `event_type TEXT CHECK IN (...)` — solo_kill, duo_kill, multi_kill,
  first_blood, shutdown, skirmish, teamfight, ace, dragon_taken,
  baron_taken, herald_taken, tower_taken, inhibitor_taken, nexus_taken,
  objective_steal, gank, invade, pick, other
- `multi_kill_grade TEXT CHECK IN ('double','triple','quadra','penta',NULL)`

**WHEN** :
- `event_epoch BIGINT` — UTC ms (VOD sync source of truth)
- `game_time_seconds INT` — for display
- `duration_seconds INT` — NULL for instant events

**WHO** :
- `primary_actor_player_id`, `primary_actor_team_id`, `primary_actor_champion`
- `primary_target_player_id`, `primary_target_team_id`, `primary_target_champion`
- `secondary_actors JSONB` — assist player_ids, teamfight participants

**WHERE (game state)** :
- `blue_team_gold INT`, `red_team_gold INT`, `gold_swing INT`

**KC RELEVANCE** :
- `kc_involvement TEXT CHECK IN ('kc_winner','kc_loser','kc_neutral','no_kc')`

**Legacy links** :
- `kill_id UUID FK kills` — `UNIQUE INDEX WHERE NOT NULL` for dedup
- `moment_id UUID FK moments` — `UNIQUE INDEX WHERE NOT NULL` for dedup

**QC checklist (the gates)** :
- HARD gates (FALSE blocks publish, default FALSE) :
  - `qc_clip_produced BOOLEAN` — clipper succeeded
  - `qc_clip_validated BOOLEAN` — clip_qc said timer drift OK
  - `qc_typed BOOLEAN` — event_type confirmed (auto or human)
  - `qc_described BOOLEAN` — ai_description passed validation
- PERMISSIVE gates (only FALSE blocks; NULL passes) :
  - `qc_visible BOOLEAN` — gemini said event visible on screen
  - `qc_human_approved BOOLEAN` — explicit admin OK; NULL = no review

**The single signal** :
- `is_publishable BOOLEAN GENERATED ALWAYS AS (...) STORED`
- TRUE iff all 4 hard gates are TRUE and neither permissive gate is FALSE

**Publication** :
- `published_at TIMESTAMPTZ` — set by trigger first time `is_publishable` flips TRUE
- `publish_blocked_reason TEXT` — admin reason when `qc_human_approved=FALSE`

**Metadata** :
- `detection_source TEXT` — auto_kill, auto_moment, auto_objective, manual_admin, oracle_elixir, kameto_channel
- `detection_confidence TEXT` — high, medium, low, estimated, verified
- `notes TEXT`
- `created_at`, `updated_at`

### Game-level flag

```sql
ALTER TABLE games
    ADD COLUMN event_mapping_complete BOOLEAN DEFAULT FALSE,
    ADD COLUMN event_mapping_completed_at TIMESTAMPTZ;
```

`event_mapper` flips this TRUE per-game after one mapping pass. The
module skips games where it's already TRUE — re-runs are O(games_with_FALSE_flag).

### Audit view

`v_game_events_qc_audit` returns one row per event with a comma-separated
`blocked_reason` string ("no_clip, qc_pending, untyped" or "OK"). Drives
the upcoming admin /qc dashboard.

## Module Ownership

| Module | Reads | Writes | Notes |
|--------|-------|--------|-------|
| `harvester` | livestats | `kills`, `moments` | Unchanged. Still produces the legacy rows. |
| `event_mapper` | `kills`, `moments`, `games` | `game_events`, `games.event_mapping_complete` | NEW. Idempotent. Inserts events post-harvest. |
| `clipper` | `kills` (vod_found) | `kills` clip URLs, `game_events.qc_clip_produced` | TICK : sets `qc_clip_produced=TRUE` after success |
| `clip_qc` (sampler + admin) | `kills.clip_url_*` | `game_events.qc_clip_validated`, `qc_visible` | TICK after Gemini timer reading |
| `analyzer` | `kills` (clipped) | `kills.ai_*`, `game_events.qc_described`, `qc_visible` | TICK after `validate_description` passes |
| `event_publisher` | `game_events WHERE is_publishable AND published_at IS NULL` | `game_events.published_at`, `kills.status='published'` | NEW. Replaces og_generator's final flip. |
| `og_generator` | `game_events.is_publishable` | `kills.og_image_url` | Becomes a "render the OG image" worker — no longer the publish gate. |

## Backfill Strategy

Migration 014 runs a one-shot `INSERT ... SELECT FROM kills` that
populates `game_events` from existing rows :
- `event_type` derived from `kills.multi_kill` and `kills.fight_type`
  (multi_kill wins, then fight_type, else `solo_kill`)
- `qc_clip_produced` = `clip_url_vertical IS NOT NULL`
- `qc_clip_validated` = proxy from current status (analyzed/published)
- `qc_typed` = both champions present
- `qc_described` = ai_description >= 80 chars
- `qc_visible` = `kills.kill_visible` (NULL preserved)
- Legacy 340 published clips will mostly land with `is_publishable=TRUE`

After migration, the `event_mapper` daemon takes over for new games.

## Roadmap (incremental landing)

1. ✅ **PR6-B-1** — migration 014 (table + indexes + backfill + view)
2. ✅ **PR6-B-2** — `EVENT_MAP_SPEC.md` (this doc)
3. ⏳ **PR6-B-3** — `event_mapper.py` module + daemon wiring
4. ⏳ **PR6-C** — clipper / clip_qc / analyzer write QC ticks alongside
   their existing `kills` writes (via small `services/event_qc.py` helpers)
5. ⏳ **PR6-D** — `event_publisher.py` module that watches `game_events`
   for `is_publishable=TRUE AND published_at IS NULL`, flips `kills.status`
   to `published` and triggers the OG generator
6. ⏳ **PR6-E** — `/admin/events` dashboard backed by `v_game_events_qc_audit`
   for human review (qc_human_approved toggle)
7. ⏳ **PR7+** — independent objective detectors (dragon, baron, herald,
   tower) that insert non-kill `game_events` rows. The MAP gets fuller.

## Anti-Goals

- We are NOT replacing `kills` or `moments` — both stay. They're the
  legacy detail tables. `game_events` is the canonical INDEX over them.
- We are NOT introducing a new feed RPC yet. `/scroll` keeps reading
  `kills WHERE status='published'`. After PR6-D the two stay in sync
  because event_publisher updates both.
- We are NOT building objective detectors in PR6 — just the table can
  hold them when they ship.

## Why This Architecture Is Right

- **Single source of truth** for "what happened in this game". Audits,
  re-runs, dashboards all key off one table.
- **Strong typing** at the database level. Postgres CHECK constraint
  catches typos, hallucinations, and "creative" classifications at
  insert time.
- **Idempotency** baked in. Unique partial indexes on `kill_id` /
  `moment_id` mean re-running event_mapper is a no-op.
- **Incremental QC** — each module ticks its gate. Failures are
  visible (the gate stays FALSE) instead of silent (the kill never
  reaches `analyzed`).
- **Reversible publication** — admin can flip `qc_human_approved=FALSE`
  and the GENERATED column instantly drops `is_publishable` to FALSE,
  removing the event from the public surface.
- **Future-proof** — new event types ship via a single ALTER CHECK,
  not a new table. New gates ship via a single ADD COLUMN + GENERATED
  rebuild.
