# LoLTok — DB Scaling Plan

**Owner:** Agent CC (PR-loltok wave)
**Last reviewed:** 2026-04-25
**Status:** design — no migration triggered yet

This document maps the *forward path* for the LoLTok PostgreSQL workload as
the product moves from "Mehdi's pilot for the Karmine Corp" to "every kill
in every LEC year, served to Europe at scale". Each phase has a trigger
metric, a target stack, the migration steps, and a rollback plan. The aim
is to **never be more than one quarter of runway away from the next tier**
so we can move *before* free-tier hits its cliff (Supabase pauses after
7 days idle, hard-caps egress at 5 GB / mois).

---

## 0. Current state (April 2026)

| Metric | Value | Headroom on Supabase free |
|---|---|---|
| DB size | ~50 MB (12K kills, 2.6K kill_assets, 5K pipeline_jobs, 1K ai_annotations) | 10x — 500 MB ceiling |
| Egress / mois | < 100 MB (~250 page loads/day, no real traffic yet) | 50x — 5 GB ceiling |
| MAU | < 50 (Mehdi + close circle) | 1000x — 50K MAU ceiling |
| Concurrent connections | 1-3 | 60x — pgbouncer pool 60 |
| Backup strategy | manual `pg_dump` weekly | 0 — no PITR on free |
| Read replicas | 0 | n/a on free |

**Reality check:** the bottleneck today is **NOT the DB**. It's the worker
pipeline (Gemini quota, ffmpeg throughput, R2 write rate). The DB is fine
until we either
1. start pulling 1000+ MAU in production, or
2. backfill the historical 1.2M kill catalogue, or
3. lose an outage and realise we have no PITR to recover.

The plan below pre-stages each migration so it can ship in **a single
weekend** when the trigger fires.

---

## 1. Phase 1 — Supabase Pro ($25 / mois)

### Trigger

**Any one of these**:
- DB size > 250 MB (50% of free ceiling)
- Egress > 2 GB / mois sustained over 4 weeks
- MAU > 5 K (10% of the 50 K free ceiling)
- **OR we publicly launch** (PITR is non-negotiable when real users appear)

### What we get for $25 / mois

| Capability | Free | Pro |
|---|---|---|
| DB size | 500 MB | 8 GB included, scales to 8 TB |
| Egress | 5 GB / mois | 250 GB / mois |
| Compute | 1 micro shared | 2 dedicated vCPU |
| PITR | none | 7 days (huge) |
| Connection pooler | shared | dedicated pgbouncer (60 → 200 conns) |
| Read replicas | none | 1 read replica $10/mo extra |
| Branching | none | yes (preview DBs per PR) |
| Pause on idle | yes (7 days) | never |
| Support SLA | community | email |

### Migration steps

1. **Pre-flight (do NOT skip)**
   - `pg_dump` of the entire schema + data, store in R2 with lifecycle = 90 days.
   - Note current `pg_indexes` so we can compare post-upgrade.
   - Run `EXPLAIN ANALYZE` on the 5 hottest queries (see §6) and store the
     plans — we need a baseline to detect regressions.
2. **Upgrade in dashboard** (Supabase → Settings → Compute → Pro). Zero
   downtime, but the read replica option only appears after the upgrade
   completes (~5 min).
3. **Enable PITR**: Settings → Database → Backups → enable PITR. Default
   retention 7 days. Costs nothing extra (included in Pro).
4. **Verify** the 5 baseline queries match prior plans within 10% latency.
5. **Update the heartbeat doc** in `worker/modules/heartbeat.py` to no
   longer worry about the 7-day-pause edge case.

### Rollback plan

The Pro tier doesn't have a "downgrade" option that preserves DB > 500 MB.
Rollback = restore the `pg_dump` from R2 onto a **fresh** free project,
update the worker `.env` to point there. Expected downtime: 30-60 min if
practiced once.

### Index audit at this phase

The schema in `001_initial_schema.sql` declares these indexes
(canonical list — re-derived from the migration file, treat as truth until
we run `\\di` against prod):

| Index | Purpose | Health at 1M rows |
|---|---|---|
| `idx_kills_game(game_id, game_time_seconds)` | per-match kill timeline | OK — composite, low cardinality on game_id |
| `idx_kills_killer(killer_player_id, created_at DESC)` | player profile feed | OK |
| `idx_kills_status WHERE status != 'published'` | pipeline scan (worker hot path) | OK — partial, narrow |
| `idx_kills_highlight(highlight_score DESC NULLS LAST) WHERE status='published'` | top-rated feed | **WATCH** — full B-tree on a float, expensive at 1M |
| `idx_kills_team(tracked_team_involvement, avg_rating DESC NULLS LAST)` | team pages | OK |
| `idx_kills_multi(multi_kill) WHERE multi_kill IS NOT NULL` | pentakill page | OK — partial, very narrow |
| `idx_kills_published(created_at DESC) WHERE status='published'` | scroll feed | **CRITICAL** — drives /scroll ; cluster on this if needed |
| `idx_kills_search GIN(search_vector)` | full-text | OK — GIN scales fine |
| `idx_ratings_kill(kill_id)` | rating count | OK |
| `idx_comments_kill(kill_id, created_at) WHERE is_deleted=false AND moderation_status='approved'` | comment fetch | OK — partial |

**To add at this phase:**
- `CREATE INDEX idx_ai_annotations_current ON ai_annotations(kill_id) WHERE is_current = true;` —
  the trigger `fn_sync_ai_annotation_to_kill` joins on this constantly.
- `CREATE INDEX idx_pipeline_jobs_claim ON pipeline_jobs(type, status, scheduled_at) WHERE status = 'pending';` —
  the queue claim query in `worker/services/job_queue.py` does N table scans
  per worker per second otherwise.
- `CREATE INDEX idx_kill_assets_lookup ON kill_assets(kill_id, type) WHERE is_current = true;` —
  the analyzer's `_lookup_current_asset` query (see `analyzer.py` line ~927)
  is unindexed today and walks the whole asset table per kill.

---

## 2. Phase 2 — Scale-out tier (200 K MAU)

### Trigger

- MAU > 50 K (Pro tier softlimit on free egress effectively)
- Egress > 100 GB / mois (40% of Pro ceiling)
- p99 read latency > 200 ms on `/scroll` (today: ~30 ms)
- DB size > 4 GB (50% of Pro included storage)

### Three options, compared

We've shortlisted three target stacks. None is unconditionally best — pick
based on what's hurting:

| Dimension | Supabase Team ($599 / mois) | Neon Scale ($69 / mois base + usage) | Aurora Serverless v2 ($50-200 / mois variable) |
|---|---|---|---|
| Sticker price | $599 fixed | $69 base, ~$150 typical at this scale | Pure usage : $50 idle, $300+ peak |
| Compute | 8 vCPU dedicated | scale-to-zero + autoscale 0.25-8 vCPU | 0.5-16 ACU autoscale |
| Storage | 100 GB included, $0.125/GB after | $69 includes 50 GB, $1.50/GB after | $0.10/GB-month (cheap) |
| Egress | 1 TB included | included in compute hours | $0.09/GB out (expensive at scale) |
| PITR | 14 days | 7 days, branchable | 35 days |
| Read replicas | 2 included, +$50 each after | unlimited via branching | up to 15 |
| Branching | yes | yes (the killer feature) | no (clones cost full storage) |
| Auth integrated | yes (Supabase Auth) | no — bring your own (Clerk, Auth0, Supabase Auth alone) | no |
| RLS support | yes (native) | yes (Postgres native) | yes (Postgres native) |
| Connection pooling | included | included (pgbouncer + Neon proxy) | RDS Proxy ~$15/mo |
| Migration friction from Pro | zero (same vendor) | medium (export/import + Auth swap) | high (Auth swap + new VPC) |
| Vendor lock | high | medium (vanilla Postgres) | medium (vanilla Postgres + AWS) |
| Idle cost (3 AM dead night) | $599 | ~$0.04/h ≈ $30/mo | $50/mo minimum (1 ACU floor) |

### Recommendation

**Neon Scale** — for these reasons specific to LoLTok:

1. **Bursty traffic profile**. EU LEC matches are Friday–Sunday evenings.
   Weekday daytime sees < 5% of weekend traffic. Neon's scale-to-zero
   between matches is worth ~$200/mois vs Supabase Team's flat fee.
2. **Branching = preview deploys for free**. Today every web PR runs
   against the live DB. With Neon, each branch gets its own copy in 3
   seconds, matches Vercel's preview-per-branch model. Mehdi's `vercel.json`
   skips Vercel preview deploys for cost reasons (per global CLAUDE.md);
   Neon branching gives back the *DB* preview without per-branch cost.
3. **Vanilla Postgres**. We don't depend on Supabase Realtime (already
   disabled per CLAUDE.md egress optimisation). We *do* depend on Supabase
   Auth — the migration cost is ~2 days to swap to Clerk or self-hosted
   Supabase Auth pointing at Neon as DB. Acceptable.
4. **Cost predictability for a hobby project**. Worst-case Neon at this
   scale is ~$200/mois. Worst-case Aurora is $500+ if a bug spins a
   read-replica loop overnight.

**Stay on Supabase Pro and *don't* go to Team unless we hit > 200 K MAU.**
Team is overpriced for a < 200K-user product. The leap from Pro to Team is
24x in price for ~3x in capacity.

**Aurora Serverless v2** is the right answer if we get acquired into
an AWS-heavy org or our team grows past the point where one person can
own ops. Until then, the operational complexity (VPC, IAM, RDS Proxy
tuning) is a tax we don't need to pay.

### Migration steps (Pro → Neon)

1. **Provision Neon** in `eu-west-2` (same region as Vercel EU edge for
   minimal RTT). Branch off `main`.
2. **Schema port**: `pg_dump --schema-only` from Supabase, replay on Neon.
   The 13 migrations in `supabase/migrations/` apply cleanly — they're
   vanilla Postgres + RLS, no Supabase-only extensions used (we deliberately
   avoided `pg_net` and `realtime`).
3. **Auth migration** — pick one:
   - **Option A (recommended)**: keep Supabase Auth, point its DB connection
     at Neon. Supabase Auth can be self-hosted or stay at Supabase as an
     "Auth-only" project ($0 if no DB usage there).
   - **Option B**: swap to Clerk. Clerk Free = 10K MAU, $25/mo for 10-50K.
     Clerk's Discord OAuth is one-click. ~2 days of work + a profile-table
     migration script.
4. **Data sync window**: dual-write for 7 days from worker (Supabase + Neon
   simultaneously). On day 7, flip read traffic to Neon, keep Supabase as
   read-only fallback for 14 days, then decommission.
5. **Update RLS policies** — same SQL, but verify auth.uid() resolution if
   we swap to Clerk (we'd need a Clerk JWT verifier extension or a thin
   PostgREST proxy).

### Rollback plan

Because we dual-write for 7 days, rollback within the first week is just
"flip reads back to Supabase". After 7 days, we'd need to replay the
worker's local SQLite cache (`worker/local_cache.py`) of any new writes
against Supabase to catch up. Expected downtime: 0 if caught in week 1,
~2h if caught later.

---

## 3. Phase 3 — Hot/cold sharding (1 M MAU + 1.2 M historical kills)

### Trigger

- DB size > 50 GB (mostly historical kills)
- p99 read latency on /scroll > 200 ms despite a read replica
- Historical-kill page latency > 1 s (player profile pages going back to 2011)
- Egress > 1 TB / mois

### Strategy: hot/cold tier, NOT user-facing sharding

Two patterns considered:

**Pattern A: shard by year** (rejected for V1)

- 2011-2015 → cold partition
- 2016-2020 → cold partition
- 2021-now → hot partition

Pro: simple to reason about, date-range queries are fast.
Con: every cross-year query (player career stats, head-to-head matchups
across LEC eras) becomes a UNION across N partitions. The web app doesn't
know about the sharding, so we'd need a routing layer.

**Pattern B: shard by region** (rejected)

- EMEA (LEC, LFL, EMEA Masters) → primary
- NA (LCS) → secondary
- APAC (LCK, LPL) → tertiary

Pro: matches traffic geography (EU users mostly query EMEA kills).
Con: cross-region content (Worlds, MSI) requires a federated query layer.
Premature for our 95%-EMEA traffic profile.

**Pattern C: hot/cold time-tier** (RECOMMENDED)

The single hot dimension is **recency × activity**. A 2014 LCK kill that
nobody has loaded in 6 months is cold; a 2026 LEC kill from last weekend
is white-hot.

```
┌─────────────────────────────────────────────────────────────┐
│  HOT TIER  — last 90 days, all RPCs hit this                │
│  Postgres (Neon Scale or self-hosted on Hetzner)             │
│  ~50K kills × 5 KB row + indexes = ~500 MB                  │
│  All reads are < 50 ms                                       │
└──────────────────┬──────────────────────────────────────────┘
                   │ daily cron at 03:00 UTC
                   ▼
┌─────────────────────────────────────────────────────────────┐
│  WARM TIER — 90 days to 2 years                             │
│  Same Postgres, marked `is_archived=false` but `is_hot=false`│
│  ~250K kills, indexes still fit                             │
│  Reads < 200 ms                                              │
└──────────────────┬──────────────────────────────────────────┘
                   │ monthly cron, archived rows go to ↓
                   ▼
┌─────────────────────────────────────────────────────────────┐
│  COLD TIER — > 2 years                                      │
│  TimescaleDB hypertable OR S3/R2 Parquet via DuckDB         │
│  ~1.2 M kills, 80% of total volume                          │
│  Reads via /api/historical/* with explicit "loading" UX      │
│  Reads 500 ms — 2 s acceptable (career-stats, deep search)  │
└─────────────────────────────────────────────────────────────┘
```

### Why TimescaleDB over plain Postgres partitioning

TimescaleDB hypertables auto-partition on `event_epoch`, give us native
compression (10-20x on time-series workloads), and continuous aggregates
for "kills per player per month" rollups. Plain Postgres partitioning
works but requires us to write the time-bucketing aggregates by hand.

### Why not Aurora at this scale

Aurora Serverless costs ~$0.12 / ACU-hour. For 1 M MAU we'd run 4-8 ACU
on average = $350-700 / mois on compute alone, before storage and egress.
Neon Scale with usage at 1 M MAU lands at ~$300 / mois. The break-even
is roughly 2 M MAU — at that point Aurora's ops maturity wins, but we're
not there yet.

### When ONE read replica isn't enough

Single-replica is fine until **either**:
- Replica lag > 5 s on the /scroll endpoint (users see comments they
  posted disappear and reappear).
- Read replica CPU > 60% sustained — we have no headroom for traffic
  spikes during a viral moment (a Caliste pentakill clip going to 1 M
  views in 2 hours).

At that point: add a 2nd replica behind a read-only DNS round-robin,
direct **all** non-real-time reads to replicas, keep the primary for
write-after-read consistency cases (rate a kill → need to see your own
rating immediately).

### `assets_manifest` JSONB concern

The original `kills.assets_manifest` JSONB was already split out into
`kill_assets` (good architectural call by whoever did migration 026).
At 1.2 M historical kills × 4 asset rows each = 4.8 M `kill_assets` rows.
That table needs:
- `CREATE INDEX idx_kill_assets_lookup_current ON kill_assets(kill_id, type) WHERE is_current = true;`
- Periodic VACUUM (the worker constantly flips `is_current` on regen, so
  dead tuples accumulate fast). Set autovacuum_vacuum_scale_factor=0.05
  on this table.
- Consider partitioning by `kill_id` hash buckets at 10 M+ rows.

---

## 4. Egress optimisation (urgent before Phase 1)

The CLAUDE.md cost model assumes ~3.8 GB / mois for 3000 page loads / day.
At 100 K page loads / day we're at **126 GB / mois** — over the Pro tier's
generous 250 GB ceiling. Three levers, all worth applying:

### Lever 1 — CDN-cache the scroll feed RPC

The /scroll endpoint calls `fn_get_feed_kills(p_limit, p_cursor)`. The
result is the same for every user when `p_cursor` is null (the "first
page"). Cache that response at the Vercel edge:

```ts
// app/api/feed/route.ts
export const revalidate = 30; // 30s edge cache
export async function GET(req: Request) {
  // ...calls fn_get_feed_kills, returns JSON
}
```

**Impact**: first-page load egress drops by ~95%. The math: at 100 K
loads/day, the first page is fetched 100 K times today; with a 30 s edge
cache it's fetched ~2 880 times (one per CDN POP per 30 s window across
~120 POPs). That's a 35x reduction on the single hottest endpoint.

### Lever 2 — trim the per-kill payload

Today `fn_get_feed_kills` returns 17 columns per kill, ~2 KB each. The
TikTok-style scroll only needs 8 columns to render the *first paint*:
`id, killer_champion, victim_champion, clip_url_vertical, clip_url_vertical_low, thumbnail_url, ai_description, multi_kill`.

Move the rest behind a deferred `fn_get_kill_detail(p_id)` RPC that's
called when a user actually opens the comment section or rating sheet.

**Impact**: per-kill payload drops from ~2 KB to ~700 B = ~65% per kill.

### Lever 3 — pagination batch tuning

100 kills/page is too aggressive. The Intersection Observer in /scroll
prefetches the next page when the user is at item N-3. With page size 20:
- p50 user scrolls 5 kills before bouncing → only 1 page loaded → 14 KB
- p99 power user scrolls 200 kills → 10 pages loaded → 140 KB

Combined with Lever 2 (700 B/kill): p99 power user = 140 KB. Today
(100/page × 2 KB): p99 = 200 KB. ~30% reduction on top of Lever 2.

### Combined egress impact at 100 K loads/day

| Lever | Egress / mois |
|---|---|
| Today (no optimisations) | ~600 GB |
| + Lever 1 (edge cache) | ~120 GB |
| + Lever 2 (trim payload) | ~45 GB |
| + Lever 3 (smaller pages) | ~30 GB |

Result: a **20x reduction**, meaning we don't even need to upgrade to
Pro for egress reasons until ~700 K loads / day.

---

## 5. Per-phase migration calendar (forward-looking)

| When | Trigger | Action | Cost delta |
|---|---|---|---|
| Today (Apr 2026) | n/a | Apply egress levers 1+2+3 NOW (Vercel edge cache, trim payload, smaller pages). Free tier covers us indefinitely at current scale. | $0 |
| Q3 2026 (est.) | first 5 K MAU OR public launch | Upgrade Supabase Pro. Add the 3 missing indexes (ai_annotations, pipeline_jobs, kill_assets). Practice the dump-restore drill once. | +$25/mo |
| Q1 2027 (est.) | 50 K MAU OR DB > 4 GB | Migrate to Neon Scale. Dual-write for 7 days. Swap Auth to Clerk OR self-host Supabase Auth. | +$60/mo net (Pro retired) |
| Q3 2027 (est.) | 200 K MAU OR DB > 50 GB | Introduce hot/warm tier on the same Neon DB. Cron job at 03:00 UTC moves rows between is_hot flags. Single DB, two query paths. | $0 incremental |
| Q1 2028 (est.) | 1 M MAU OR cold tier > 1 M rows | Add TimescaleDB cold tier (or S3 Parquet for analytics). Move > 2-year-old kills out of primary Postgres. | +$30/mo (TimescaleDB Cloud Lite) |

---

## 6. Baseline queries to monitor (run weekly)

These are the queries the worker + web app hit most often. Capture
`EXPLAIN ANALYZE` plans for each into a Git-tracked file so we detect
plan regressions before they hit users.

1. **Scroll feed first page** — `SELECT * FROM fn_get_feed_kills(20, NULL);`
   Today: ~5 ms. Watch for full sequential scans on `kills` if the
   `idx_kills_published` partial index gets bypassed (e.g. by a planner
   stat skew after a big backfill).
2. **Player profile** — `SELECT * FROM kills WHERE killer_player_id = $1 ORDER BY created_at DESC LIMIT 50;`
   Today: ~8 ms. Watch the `idx_kills_killer` index health.
3. **Top kills by rating** — `SELECT * FROM kills WHERE status = 'published' AND avg_rating IS NOT NULL ORDER BY avg_rating DESC LIMIT 100;`
   Today: ~30 ms. The full B-tree on a float scales poorly; consider
   bounded buckets (`avg_rating_bucket = ROUND(avg_rating * 2)`) past 100K
   rows so the index becomes a clustered range scan.
4. **Pipeline queue claim** — `SELECT * FROM pipeline_jobs WHERE status = 'pending' AND scheduled_at <= now() AND type = $1 ORDER BY priority DESC, scheduled_at ASC LIMIT $2 FOR UPDATE SKIP LOCKED;`
   Today: ~3 ms. The `FOR UPDATE SKIP LOCKED` is correct; just make sure
   `idx_pipeline_jobs_claim` (planned in Phase 1) lands.
5. **AI annotation lookup** — `SELECT * FROM ai_annotations WHERE kill_id = $1 AND is_current = true;`
   Today: ~2 ms. The trigger `fn_sync_ai_annotation_to_kill` runs on every
   ai_annotations insert; if this query slows, the trigger compounds.

---

## 7. What we are NOT doing (and why)

| Decision | Why not |
|---|---|
| Sharding by user ID | We don't have user-partitioned data — kills are global |
| Multi-master replication | LoLTok is read-heavy (1000:1 read:write). Async replicas are sufficient. |
| Moving clips into Postgres | Already on R2, zero egress fees. Never undo this. |
| Dropping the relational model for a NoSQL store | We use 6+ joins per scroll-feed RPC. NoSQL would force denormalisation that hurts the AI re-analysis flow (we re-compute scores monthly across all kills). |
| Self-hosting Postgres on Hetzner | Tempting at $20/mo for 8 vCPU but the ops cost (PITR, replicas, pgbouncer, monitoring) eats 4 hours/month. Worth it past 1 M MAU; not before. |

---

*This plan is reviewed at every quarterly retro. If a trigger fires before
its quarter, we ship the migration immediately — pre-staging is the whole
point.*
