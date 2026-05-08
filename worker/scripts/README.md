# worker/scripts/ — Inventory

Operator scripts that run alongside the daemon (`worker/main.py`).
Categorised 2026-05-08 (Wave 19, audit follow-up). Re-run a quick audit
when this dir grows past ~60 files or after a major data-shape change.

## How to read this

- **ACTIVE** — runs on a schedule (Windows Task Scheduler / cron) or as
  a long-running supervised process. Failure = pipeline degradation.
  Touch only when you understand the cadence.
- **MAINTENANCE** — operator-triggered fix-it scripts. Safe to run
  ad-hoc when the symptom matches the docstring. Most are idempotent.
- **BACKFILL** — one-shot historical-data scripts. Safe to keep around
  even after their first run ; they protect against re-running a
  Supabase reset / migrating onto a fresh DB. Most are idempotent.
- **DEPRECATED** — logic migrated into the daemon or the bug they
  fixed is fixed in core code. Candidates for deletion ; see the
  [Deletion candidates](#deletion-candidates) section before touching.

When you add a new script :

1. Header docstring with `Why`, `When to run`, and `Idempotent ? yes/no`.
2. Add a row to the table below.
3. If it should run on a schedule, register it via
   `install-maintenance-tasks.ps1` at the repo root.

---

## ACTIVE — scheduled / daemon-supervised

| Script | Cadence | Purpose |
|---|---|---|
| `auto_fix_loop.py` | every 4 h, supervised | Sweep `qc_described` + `force_publish` to unblock kills the analyser left in limbo. |
| `backfill_clip_errors.py` | manual on regression | Re-enqueue `clip_error` kills into `pipeline_jobs` after a clipper hotfix. |
| `backfill_embeddings.py` | manual when new column / model | Compute Gemini embeddings for published kills missing them. Rate-limited, slow. |
| `backfill_og_images.py` | manual after pipeline change | Enqueue `og.generate` jobs for published kills missing `og_image_url`. |
| `backfill_stuck_pipeline.py` | manual when sentinel reports stuck rows | Re-enqueue kills stuck in `vod_found` / `clipped` / `analyzed` / `manual_review`. |
| `backup_supabase.py` | **Sunday 04:00** (Task Scheduler) | Weekly `pg_dump` → R2 with 7-day retention. **Wave 14 ops fix.** |
| `hls_backfill.py` | manual after HLS pipeline change | Parallel 6-worker re-encode of published clips missing `hls_master_url`. |
| `monitor_loop.py` | every 4 h, supervised | 3-min lightweight pipeline-health poll, pipes into Claude Monitor channel. |
| `prune_pipeline_jobs.py` | **Sunday 03:00** (Task Scheduler) | `fn_prune_pipeline_jobs` RPC — deletes terminal-state rows older than 30 days. |
| `prune_user_events.py` | **1st of month, 03:30** (Task Scheduler) | `fn_prune_user_events` RPC — deletes events older than 90 days. |
| `reanalyze_pollution_qc.py` | **manual after analyser prompt change** | Re-classify published clips with the latest anti-pollution prompt. |
| `release_zombie_claims.py` | **daily 02:00** (Task Scheduler) | Release `pipeline_jobs` rows stuck in `claimed` past `max_attempts`. **Wave 17 ops fix.** |
| `supervise_worker.py` | runs as systemd-equivalent | Watchdog + auto-restart with exponential backoff (15-min stability reset). |

## MAINTENANCE — operator-triggered

| Script | When to run | Purpose |
|---|---|---|
| `dlq_drain.py` | DLQ alert fires | Bulk-recover `dead_letter` rows : requeue safe errors, cancel unrecoverable. |
| `fix_qc_described_threshold.py` | legacy — superseded by `auto_fix_loop` | One-shot : flip `qc_described=true` for kills with description ≥ 30 chars. |
| `force_publish_stuck.py` | legacy — superseded by `auto_fix_loop` | One-shot : flip `analyzed → published` when `is_publishable=true`. |
| `lab_generate_evaluations.py` | when blind-A/B benchmarking models | 5 clips × 4 models → `lab_evaluations`. |
| `live_dashboard.py` | during incidents | 5 s-refresh terminal dashboard : published count, queue, DLQ. |
| `quarantine_offset_zero.py` | one-shot after legacy ingestion | Nullify `vod_offset_seconds=0` + downgrade affected clips to `analyzed`. |
| `queue_status.py` | quick triage | Single snapshot of `pipeline_jobs` counts per kind/status. |
| `reanalyze_with_premium.py` | when re-running Pro tier on Lite output | Back-run Pro 2.5 over Flash-Lite descriptions. ~€37.50 budget per full run. |
| `recompute_champion_class.py` | one-shot after Riot map update | Deterministic server-side champion class from the static Riot map. |
| `recompute_fight_type.py` | one-shot when classifier prompt changes | Re-derive `fight_type` / `matchup_lane` / `lane_phase` from data, not Gemini. |
| `recon_videos_now.py` | manual trigger | One-shot trigger for the channel reconciler daemon. |
| `recover_exhausted_clip_errors.py` | post-NVENC / cookies infra fix | Reset `retry_count=0` for kills the runtime gave up on. |
| `reenqueue_one_kill.py` | targeted admin override | Single-kill re-queue with audit trail. |
| `regen_audit_targets.py` | post Opus 4.7 audit | Re-generate the 45 audit clips flagged as critical / shallow. |
| `runtime_status.py` | "what config is the daemon using right now ?" | Print effective worker tuning. No secrets, no DB contact. |
| `sync_legacy_qc_validated.py` | one-shot legacy schema sync | Sync legacy `game_events.qc_clip_validated` from `kills` split columns. |
| `verify_migrations.py` | post-deploy | Assert migrations 024-032 objects exist in Supabase. |

## BACKFILL — historical / one-shot

| Script | Purpose |
|---|---|
| `backfill_golgg.py` | Full historical KC catalog import from gol.gg (2021 → 2026). |
| `backfill_league.py` | Team-level fan-out wrapper to backfill an entire league. |
| `backfill_phase1_metadata.py` | Populate canonical metadata from `kc_matches.json` (Phase 1 prep). |
| `backfill_player_ids.py` | Backfill `killer_player_id` + `victim_player_id` from `kc_matches.json`. |
| `backfill_team.py` | Generic per-team historical backfill. KC + future leagues. |
| `backfill_team_ids.py` | Resolve NULL `team_blue_id`/`team_red_id` from `game_participants`. |
| `backfill_team_ids_from_lolesports.py` | Resolve NULL team sides via lolesports API when `game_participants` rows missing. |
| `deep_scan_channel.py` | Full-history `yt-dlp` channel scan into `channel_videos` (thousands of videos per channel — slow). |
| `fix_missing_match_winners.py` | Backfill `matches.winner_team_id` from game outcomes. |
| `migrate_kills_to_moments.py` | Group published kills into `moments` (30 s window clustering). |
| `reanalyze_backlog.py` | Re-analyze published kills for the Scroll-Vivant pivot fields. |
| `seed_ai_annotations.py` | Synthesize `ai_annotations` rows for pre-migration-028 kills. |
| `seed_leagues.py` | Upsert major Riot pro circuits into the `leagues` catalog. *(Wave 19 — re-run after migration 056.)* |
| `seed_more_channels.py` | Add `@kameto` / `@LCSEsports` / `@lolesports` channels + trigger discoverer. |

## Archived (`_archive/`)

The following scripts were moved to `worker/scripts/_archive/` on
2026-05-08 (Wave 19.7) after confirming they hadn't been run in 3+
months and their logic is covered elsewhere. They remain in git
history for forensic / point-in-time replay but are not part of the
active toolchain. See `_archive/README.md` for the full retirement
rationale.

| Script | Replacement |
|---|---|
| `recompute_champion_class.py` | analyser pipeline (insert-time static-map lookup). |
| `recompute_fight_type.py` | analyser pipeline (deterministic post-Gemini step). |
| `regen_audit_targets.py` | n/a — one-shot run completed. |
| `quarantine_offset_zero.py` | `sentinel.py` (PR7-A) filters at ingest. |
| `fix_qc_described_threshold.py` | `auto_fix_loop.py::_fix_qc_described` (every 4 h). |
| `force_publish_stuck.py` | `auto_fix_loop.py::_force_publish_stuck` (every 4 h). |

## Operator notes

- `__init__.py` is just a module marker — leave it alone.
- `KCKills_Worker_Supervisor.xml` is the Task Scheduler export of the
  worker watchdog ; not a script. Treat it as configuration.
- All Supabase-touching scripts read `SUPABASE_URL` + `SUPABASE_SERVICE_KEY`
  from `worker/.env`. Service-role key bypasses RLS — never run these
  against a shared / staging DB without confirming `SUPABASE_URL`.
- Most scripts are dry-run-friendly with `--limit 10` or `--dry-run` ;
  read the script's `argparse` block before the first real run.
