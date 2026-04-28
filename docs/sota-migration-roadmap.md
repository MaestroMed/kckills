# SOTA Migration Roadmap — KCKills (snapshot 2026-04-28)

This doc tracks the remaining "state of the art" stack migrations identified
during the Wave 13 audit. Not every item needs to ship immediately ; this
document is the living checklist so we don't lose track between sessions.

User rule (CLAUDE.md global memory) :
> "State of the Art" = TOUJOURS la stack technologique LA PLUS RÉCENTE
> possible à la date du jour.

---

## ✅ Done in Wave 13 (commits fcabf58 + a9cd019)

- **Next.js 15.5 → 16.2.4** (Turbopack default in dev + build)
- **React 19** + **React Compiler** (auto-memoization, baseline ON)
- **View Transitions API** (`experimental.viewTransition`)
- **Inline critical CSS** (`experimental.inlineCss`)
- **Recharts → custom SVG** for player charts (~95 KB bundle saving on `/player/[slug]`)
- **Tailwind v4 native Container Queries** on `ClipReel` (first reusable component migrated)
- **Player page case-insensitivity** (`/player/Kyeahoo` no longer 404s)

---

## 🟡 PPR (renamed `cacheComponents` in Next 16)

**Status** : DISABLED. Feature flag commented out in `web/next.config.ts`
because 109 routes use `export const dynamic = "force-dynamic"`, which is
incompatible with `cacheComponents: true`.

**Migration plan** :
1. Audit each `force-dynamic` route — most are admin pages or API endpoints
   that can stay dynamic. The flag is incompatible only because PPR demands
   each route either commit to static-shell + Suspense streamed dynamic
   slots, OR be fully dynamic.
2. For ROUTES we want PPR on (homepage, scroll, player, match, kill detail) :
   - Remove `export const dynamic = "force-dynamic"`
   - Wrap any data-fetching child in `<Suspense fallback={<Skeleton />}>`
   - Verify the page renders the static shell on first request, then
     streams the dynamic slots in.
3. Re-enable `cacheComponents: true`.

**Estimated effort** : 1 dedicated day. Big perf win on first-paint latency
(static shell paints in <100 ms while data fetches take 500-1000 ms).

---

## 🟡 Server Actions migration (26 routes candidates)

**Status** : 0 Server Actions in the codebase today. 100 % of mutations go
through `fetch('/api/...')` calls. Next 16 + React 19 makes Server Actions
the canonical pattern for client → server mutations.

**Top 3 batches by impact** (per Server Actions audit, 2026-04-28) :

### Batch 1 — User interactions (highest user-visible payoff)
Routes :
- `/api/kills/[id]/rate` (POST)
- `/api/kills/[id]/comment` (POST)
- `/api/kills/[id]/like` (POST)
- `/api/comments/[id]/vote` (POST)
- `/api/comments/[id]/report` (POST)
- `/api/report` (POST)

Client files affected (7) : `interactions.tsx`, `CommentPanel.tsx`,
`CommentSheetV2.tsx`, `CommentVote.tsx`, `LikeButton.tsx`, `ReportButton.tsx`,
`ScrollFeed.tsx`.

Wins : type-safe contract, `useOptimistic` becomes idiomatic, automatic
`revalidatePath('/kill/[id]')` on success.

### Batch 2 — Admin pipeline (admin-only, lower risk)
Routes : ~10 routes under `/api/admin/pipeline/*` POST (jobs/retry, jobs/cancel,
jobs/bulk, dlq/*, dlq/bulk).

Client files : `JobsBulkActions.tsx`, `job-row-actions.tsx`, `trigger-form.tsx`,
`dlq/row-actions.tsx`, `dlq/bulk-drain.tsx`.

Wins : type-safe job IDs, no JSON wire contract drift.

### Batch 3 — Admin editorial / curation
Routes : `/api/admin/editorial/{feature,hide}`, `/api/admin/featured/[date]`,
`/api/admin/moderation/*`, `/api/admin/clips/[id]/*`, `/api/admin/players/[id]`,
`/api/admin/playlists`, `/api/admin/lab/vote`, `/api/admin/audit/[id]/replay`,
`/api/admin/login`, `/api/admin/push/broadcast`, `/api/admin/hero-videos` (CRUD),
`/api/bgm` PUT, `/api/kills/[id]/edit`.

Wins : automatic `revalidatePath('/scroll')` after editorial actions = no
manual `router.refresh()` plumbing.

### What stays as API routes (legitimately external)
- `/api/healthz` (UptimeRobot)
- `/api/cron/*` (Vercel cron requires HTTP)
- `/api/v1/*` (versioned public API contract)
- `/api/og/[id]` (Discord/Twitter/Slack OG scrapers)
- `/api/track`, `/api/admin/perf/vitals` ingest (`navigator.sendBeacon`)
- `/api/push/subscribe` (called from `public/sw.js`, outside React tree)
- `/api/admin/hero-videos/upload` (multipart binary)
- `/api/auth/riot/{start,callback}` (OAuth redirect)
- All public GET routes (`/api/live`, `/api/next-match`, search/facets, …)

**Estimated effort** : Batch 1 = half a day. Batches 2 + 3 = 1 day each.

---

## 🟡 Bun runtime (Vercel officially supports Bun for Next.js)

**Status** : Currently on Node.js + pnpm. Vercel added Bun runtime support
for Next.js (`bunVersion: "1.x"` in `vercel.json`) earlier in 2026.

**Migration plan** (per Bun feasibility audit) :
1. Local : `bun install` in `web/` (generates `bun.lock`). Keep `pnpm-lock.yaml`
   for one week as rollback.
2. `package.json` scripts → `"dev": "bun run --bun next dev"`,
   `"build": "bun run --bun next build"`, `"start": "bun run --bun next start"`.
3. `vercel.json` → add `"bunVersion": "1.x"`.
4. Test on a feature branch first ; verify Vercel preview build succeeds.
5. Merge to `main` once preview is green.

**Risks** :
- `sharp` (Next 16 image opt, transitive) : Bun handles `.node` via napi-rs ;
  reputed OK since Bun 1.1, but verify the first Vercel build downloads the
  right `linux-x64` binary.
- `@sentry/nextjs` : Vercel docs note "automatic source maps disabled with
  Bun runtime". Stack traces less precise but acceptable.
- `web-push` : uses `crypto` + `http2` ; Bun-compatible since 2024.
- All client-side libs (Three.js, @react-three/fiber, matter-js, hls.js,
  recharts) : zero impact, they don't run on the server.

**Wins** :
- `bun install` 3-5× faster than `pnpm install` on cold cache (CI / new clones).
- Cold-start ~30 % faster.
- HMR steady-state ~equivalent (Turbopack already native Rust).

**Estimated effort** : 2 hours (config + 1 verified preview build).

---

## 🟡 Postgres 17 (Supabase upgrade — USER ACTION)

**Status** : Supabase project still on Postgres 15 (default at project
creation). PG 17 GA support landed in Supabase late 2025.

**Why upgrade** :
- Faster `VACUUM` (streaming I/O) → less DB downtime under load.
- `EXPLAIN (ANALYZE, MEMORY)` for diagnosing the worker's slowest queries.
- Better B-tree dedup for the `kills.search_vector` GIN index.
- Logical replication improvements (future read-replica option for the worker).

**Steps (USER ACTION on Supabase dashboard)** :
1. Visit Supabase project → Settings → Infrastructure → Postgres version.
2. Click "Upgrade to 17.x". Schedule for off-hours (worker idle window,
   typically 04:00-09:00 UTC).
3. Expected downtime : 5-15 minutes. Worker auto-reconnects via the
   SQLite local cache buffer (already implemented in `worker/local_cache.py`).
4. After upgrade : verify migrations 001-049 still apply cleanly (no SQL
   syntax breaking change between 15 and 17).

**Estimated effort** : 30 min user action + automated downtime.

---

## Summary table

| Migration | Effort | Risk | Sequence | Owner |
|-----------|--------|------|----------|-------|
| PPR (cacheComponents) | 1 day | Low (well-understood) | Next | Claude |
| Server Actions Batch 1 (rate/comment/like) | 0.5 day | Low | After PPR | Claude |
| Server Actions Batch 2 (admin pipeline) | 1 day | Low | When time allows | Claude |
| Server Actions Batch 3 (admin editorial) | 1 day | Low | When time allows | Claude |
| Bun runtime | 2 h | Medium (sharp, Sentry source maps) | Feature branch first | Claude |
| Postgres 17 upgrade | 30 min | Low | Off-hours, USER ACTION | Mehdi |

Total to fully SOTA : ~4 days of dev + 30 min user action.

---

*Updated 2026-04-28 by Wave 13 audit. Next review : after the user signs off
on the next migration batch.*
