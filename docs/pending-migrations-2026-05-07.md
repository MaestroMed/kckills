# Pending Supabase migrations — 2026-05-07

The worker daemon emits warnings for at least one missing schema object
(`leagues` table → 404 on every sentinel cycle). The 9 migrations below
are committed to `supabase/migrations/` but were never applied to this
project's Supabase. Apply them in order via Supabase Studio's SQL
editor on https://supabase.com/dashboard/project/_/sql/new.

Each one is idempotent (`CREATE … IF NOT EXISTS`, etc.) — re-running
a partially-applied one is safe.

| # | File | Touches | Why |
|---|---|---|---|
| 043 | `043_leagues_table.sql` | new `leagues` table, seed for LEC | Multi-league support. Worker `sentinel` warns on every cycle without it. |
| 044 | `044_kill_descriptions_i18n.sql` | new `kill_descriptions_i18n` table | i18n translations for kill descriptions. |
| 045 | `045_rename_kc_involvement.sql` | rename `kills.kc_involvement` column | Rename for multi-team correctness. |
| 046 | `046_recommendation_helpers.sql` | functions for `/scroll` recommender | pgvector cosine + Wilson blend RPCs. |
| 047 | `047_user_events_clip_delivery.sql` | new event types in `user_events` | Track clip delivery telemetry. |
| 048 | `048_kill_clip_context.sql` | new `ai_clip_context` columns | Anti-pollution gate for Gemini QC. |
| 049 | `049_channel_videos_skipped_status.sql` | enum extension on `channel_videos.status` | Accepts `skipped_<kind>` values. |
| 050 | `050_security_advisor_fixes.sql` | RLS / search_path / function permission fixes | Security advisor highlighted these. |
| 051 | `051_security_definer_search_path_lock.sql` | `SET search_path = public, pg_temp` on 6 SECURITY DEFINER funcs | CVE-class hijack vector. |

## Recommended order

Apply 043 → 051 in numeric order. None of them conflict, and the
worker should pick up the new schema automatically (no daemon restart
needed for most — `leagues` is read on each sentinel cycle).

## Verification

After applying 043 :

```sql
SELECT slug, name, lolesports_league_id FROM leagues ORDER BY priority;
-- Should return at least the LEC row (seeded by the migration).
```

Then watch the worker log for the disappearance of `supabase_select_failed table=leagues`.

## Stuck-job cleanup (separate, also pending)

The worker keeps logging `stuck_kill_reset_skip_active_job` for
roughly a dozen kills from the previous machine that are stuck in
`status=vod_found` with abandoned `clip.create` jobs. The existing
script handles this :

```powershell
cd C:\Users\Matter1\Kckills\worker
.\.venv\Scripts\python.exe scripts\backfill_stuck_pipeline.py --state vod_found --dry-run
# inspect the count, then drop --dry-run :
.\.venv\Scripts\python.exe scripts\backfill_stuck_pipeline.py --state vod_found
```

It re-enqueues the kills' `clip.create` jobs at default priority, so
the clipper picks them up next cycle.

If `backfill_stuck_pipeline.py` doesn't help (kills still stuck after
a sentinel cycle), the issue is upstream of the queue — most likely
the watchdog finds them but skips because of an existing active job.
In that case, run `release_zombie_claims.py --type clip.create` to
release any jobs whose `attempts >= max_attempts`.
