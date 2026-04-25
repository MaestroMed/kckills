# Worker Stateless / Containerization Plan

> **Status (this PR):** prep work landed. The worker is portable in
> *configuration* (paths abstracted via `LocalPaths`, Dockerfile builds
> a runnable image), but several subsystems still assume a long-lived
> filesystem on the host. Fully stateless = ~3 days of focused work
> after this. Below is the inventory + sequencing.

---

## 1. Why move at all?

The worker today runs as a Python process on Mehdi's Windows desktop:

- **Pros that worked for the KC pilot:**
  - Free compute, free electricity-that-was-going-to-burn-anyway
  - RTX-class GPU → NVENC encoding (8× faster than libx264)
  - Local D:/ NVMe with ~975GB free for clips/VODs
  - Firefox-on-the-host stores YouTube cookies indefinitely

- **Cons that block Phase 1 (multi-team) and beyond:**
  - Single point of failure: PC reboots, power outages, Windows
    Update auto-restarts → pipeline stops, hours of catch-up
  - No 24/7 SLO: when Mehdi is travelling the worker dies and KC
    matches go un-clipped
  - Hard-coded paths (`D:/kckills_worker/...`) wired into modules
  - Firefox profile + DPAPI cookies scoped to one Windows user
  - Scaling out (LFL, EUM, MSI, Worlds) means more compute, and one
    desktop tops out around 4-6 concurrent matches before the GPU
    queue saturates
  - No isolated dev/staging environment — every change ships live

For the **KC pilot only**, none of those is a deal-breaker.
For **Phase 1 multi-team**, all of them are.

---

## 2. Inventory of local-FS assumptions

Every spot in the worker that touches a local file. Reviewed by `grep`
across all modules; this table is the input to the migration.

| # | Subsystem | What it writes / reads | Current path (Mehdi) | Target (container) | Status |
|---|-----------|------------------------|----------------------|---------------------|--------|
| 1 | yt-dlp VOD cache | Cached MP4 segments, ~80MB/match | `D:/kckills_worker/vods/` | `/cache/vods/` (mounted volume) | ✅ Now goes through `LocalPaths.vods_dir()` |
| 2 | clipper output | 4 artefacts/kill (h, v, v_low, thumb), ~25MB/kill | `D:/kckills_worker/clips/` + `thumbnails/` | `/cache/clips/` + `/cache/thumbnails/` | ✅ `LocalPaths.clips_dir()` / `thumbnails_dir()` |
| 3 | HLS packager temp | `.m3u8` + `.ts` segments before R2 upload, 40-80MB/clip | `D:/kckills_worker/hls_temp/` | `/cache/hls_temp/` | ✅ `LocalPaths.hls_temp_dir()` |
| 4 | SQLite local cache | Supabase write buffer (~10MB) | `worker/local_cache.db` | `/cache/local_cache.db` (or Redis backend) | ⚠️ Partially: env override possible, but `local_cache.py` defaults still inside source tree. OK for now. |
| 5 | Schedule + golgg cache | JSON snapshots, ~5MB total | `worker/cache/*.json` | `/cache/scratch/` | ⚠️ Path abstracted via `LocalPaths.cache_dir()` but several modules still build their own subpaths inside `worker/cache/`. Cosmetic. |
| 6 | YouTube cookies file | Netscape cookies.txt, ~2KB | `worker/.youtube_cookies.txt` | Secret-mounted at `/run/secrets/yt_cookies.txt` OR Firefox profile volume | ✅ Path abstracted, **but** see §3 — the source-of-truth is Firefox-on-the-host |
| 7 | Firefox profile | `cookies.sqlite`, key4.db, etc. | `%APPDATA%/Mozilla/Firefox/Profiles/<id>` | `/home/kckills/.mozilla/firefox/<profile>` (volume mount) | ❌ **Big risk** — see §3 |
| 8 | Orchestrator status JSON | `orchestrator_status.json`, atomically written every 1s | `D:/kckills_worker/orchestrator_status.json` | `/cache/orchestrator_status.json` | ✅ Already env-overridable, now also via `LocalPaths.status_file()` |
| 9 | Per-role child logs | Rotating log files | `D:/kckills_worker/logs/` | `/cache/logs/` (or stdout → docker logs) | ⚠️ Better: route to stdout/stderr in container, `docker logs` handles rotation. Current code writes files. |
| 10 | OG image cache | Generated PNGs before R2 upload | `worker/cache/og/` | `/cache/og/` | ⚠️ Inside `worker/cache/`, follows §5 |
| 11 | Hardcoded `D:/kckills_worker` | Module-level fallbacks in `manager.py` + `orchestrator.py` data_root probe | Windows-only `if os.path.isdir("D:/")` | should defer to `LocalPaths.data_root()` | ⚠️ Will not break (D:/ check returns False on Linux) but we should refactor for clarity |
| 12 | Service-tier secrets | `.env` file with API keys | `worker/.env` | Docker `--env-file` or Hetzner secret store | ✅ Already env-driven, no path changes |

### Legend
- ✅ Done in this PR — works on Mehdi's box AND inside the container.
- ⚠️ Partially done — abstraction landed but a few modules still hand-build paths inside it. Low-risk follow-up.
- ❌ Blocker — needs design work before we can fully cut over.

---

## 3. The big risk: Firefox cookies

`youtube_cookies.py` supports three sources, in priority order:

1. **Firefox profile** (`KCKILLS_YT_COOKIES_FIREFOX_PROFILE=<name>`)
   yt-dlp reads `cookies.sqlite` from a named Firefox profile.
   No DPAPI, no Chrome ABE — works forever as long as the YouTube
   session stays valid (months for inactive profiles).
   **This is what Mehdi uses today** (commit `10bbe6f`).

2. **Netscape cookies.txt file** (`KCKILLS_YT_COOKIES_FILE=<path>`)
   User exports via the "Get cookies.txt LOCALLY" Chrome extension,
   re-export every ~2-4 weeks when the YouTube `__Secure-3PAPISID`
   token rotates and yt-dlp returns "Sign in to confirm".

3. **Chrome profile** (`KCKILLS_YT_COOKIES_CHROME_PROFILE=<name>`)
   **DEAD on Chrome 127+ due to App-Bound Encryption.** Kept for
   legacy reference only.

### The container problem

In a Docker container, none of these three paths cleanly applies:

- **Firefox profile mode** requires Firefox to exist in the image
  and a profile to be pre-baked or volume-mounted. We CAN bake
  `firefox-esr` into the image (the Dockerfile does this). The
  profile dir lives at `/home/kckills/.mozilla/firefox/<profile>`
  and the operator can volume-mount it from the host. **But:** the
  cookies in that profile expire (YouTube auth tokens rotate every
  ~2-6 months). When they do, the operator has to:
  1. SSH into the host
  2. Run a sidecar Firefox container with X11 forwarded back to
     their workstation, OR copy the profile out, log into YouTube
     on their laptop's Firefox, copy the profile back
  3. Restart the worker container

  Painful. Not a blocker for monthly maintenance, but it's a manual
  toil step the operator MUST own.

- **cookies.txt mode** is simpler operationally — operator exports
  on their workstation, scp's the file to the host's secret mount,
  the worker picks it up via `KCKILLS_COOKIES_FILE`. Same monthly
  toil but no GUI Firefox needed inside the container.

### Three solutions, ranked

| Option | Cost | Toil | Reliability | Verdict |
|--------|------|------|-------------|---------|
| **A. Firefox profile in volume mount** | $0 | Manual reauth ~q3mo | High once set up | **Recommended for 0→1 migration** |
| **B. cookies.txt mounted as Docker secret** | $0 | Manual reauth ~q1mo | Medium (file rotation more frequent) | Fallback if A is too painful |
| **C. Browserless.io paid headless service** | ~$50/mo | Zero | Highest | Overkill for our scale (1-2 reauths/month aren't worth $600/yr) |
| **D. Residential proxy + plain HTTP cookies** | ~$30/mo | Some (proxy auth) | Medium | Worth revisiting if YouTube tightens further |

→ **For Phase 1, ship Option A.** Document the reauth procedure in
the runbook, set a calendar reminder for q2 and q4. Reconsider C/D
when we're at >5 teams and the toil becomes weekly.

---

## 4. Migration sequencing

### Done in this PR (Wave: portability prep)

- [x] `worker/services/local_paths.py` — central path resolver
- [x] `worker/config.py` — every `*_DIR` / `CACHE_DB` is now a
  `@property` delegating to `LocalPaths`
- [x] `worker/Dockerfile` — multi-stage build, ffmpeg + Firefox-ESR
  + deno installed, non-root user, healthcheck
- [x] `worker/.dockerignore` — keeps the build context small,
  excludes secrets and clip/vod caches
- [x] No behavior change on Mehdi's box (verified: every path
  resolves identically to pre-refactor)

### Wave: invasive path refactor (~½ day)

- [ ] Replace `_data_root()` in `worker/manager.py` and
  `worker/orchestrator.py` with `LocalPaths.data_root()`. They
  currently re-implement the D:/ check inline.
- [ ] Replace `LOLTOK_VODS_DIR` env in `worker/modules/clipper.py`
  (line ~94) with `LocalPaths.vods_dir()`. Currently the clipper
  reads its own env var instead of delegating.
- [ ] Audit `modules/og_generator.py` and any other consumer that
  builds paths from `os.path.dirname(__file__)` — they should call
  `LocalPaths.cache_dir()` instead.
- [ ] Stop writing per-role logs to disk; route to stdout/stderr
  and let `docker logs` rotate. Keeps the host's disk free of GB
  of log files in long-running prod.

### Wave: stateless write paths (~1 day)

- [ ] **Local SQLite buffer → Redis-only in container mode.** The
  worker already supports Redis (`KCKILLS_USE_REDIS=1`,
  `local_cache_redis.py`) — make it the *default* in the container
  so cache survives container restarts. Add a `redis` service to
  `worker/docker-compose.redis.yml` and link it.
- [ ] **Move per-game scratch state into Supabase or R2.** The
  golgg HTML snapshots in `worker/cache/golgg/` are useful for
  debugging but the worker doesn't depend on them between runs.
  Make them opt-in via `KCKILLS_DEBUG_SNAPSHOTS=1`.
- [ ] **Schedule cache → Supabase.** `worker/cache/schedule.json`
  could just live in a `cached_schedules` table — one row,
  refreshed by sentinel.

### Wave: deployment (~1 day)

- [ ] Spin up Hetzner CCX13 (or Fly.io, see comparison doc).
- [ ] Provision SSD volume, mount at `/srv/kckills/cache`.
- [ ] One-time : install Firefox on a sidecar, log into YouTube
  with the dedicated `kckills-scraper` account, scp the profile
  dir into `/srv/kckills/firefox`.
- [ ] `docker run` the image with the volume + env-file.
- [ ] Run for 7 days in shadow mode (worker writes to a separate
  Supabase project), compare output diffs against the prod worker
  on Mehdi's PC.
- [ ] Cut over: prod worker on container, Mehdi's PC on standby
  for 7 more days, then decommission.

### Wave: ongoing (after cutover)

- [ ] Quarterly Firefox profile reauth (calendar reminder set on
  cutover day).
- [ ] Add `worker/scripts/reauth_youtube.md` runbook.
- [ ] Add a Discord webhook alert when yt-dlp starts returning
  "Sign in to confirm" en masse — the auto-signal that reauth is
  needed.

---

## 5. Why we are NOT cutting over for the KC pilot

The migration above is ~3 days of focused work + ~$15-25/mo
operating cost. For the KC pilot specifically, this is a bad
trade because:

1. **NVENC.** Mehdi's RTX 4070 Ti encodes a 1080p clip in ~5s.
   A Hetzner CCX13 (no GPU) runs libx264 at ~30s for the same
   clip. At KC's volume (~14 kills/match × ~3 matches/week = 42
   clips/week) it's a wash. At Phase 1 multi-team volume (5-8
   teams, 10× the clips), libx264 would saturate.
2. **Cookies are stable on Mehdi's Firefox** — last manual reauth
   was Apr 25 (commit `10bbe6f`). It Just Works.
3. **The KC pilot is a known short-horizon thing.** EtoStark
   showcase, validate the product, then rebuild the data layer for
   multi-team. We'd be migrating an architecture we're going to
   throw away anyway.
4. **Mehdi can SSH in 24/7** and the Discord watchdog catches
   crashes within 1 hour. Not Phase-1 grade SLO but acceptable for
   a single-team pilot.

→ **Decision:** keep the worker on Mehdi's PC for KC. Do the
container migration BEFORE onboarding team #2 (LFL or international).
This PR is the prep work — landing it now makes the eventual
cutover a 3-day project instead of a 2-week one.

---

## 6. Open questions

- **Should we have a "burst capacity" mode** where the local
  worker handles steady state and the container spins up only for
  Worlds / MSI peak weeks? Probably yes, eventually — but let's
  not optimize for it before we've even cut over once.
- **GPU-on-cloud:** Hetzner GEX44 ships RTX 4000 SFF Ada at €184/mo.
  At Phase 1 volume that pays for itself vs running 2× CPU boxes.
  Defer the call until we have real Phase 1 throughput numbers.
- **Multi-region:** the worker is single-leader by design (Supabase
  job_queue serializes work). No need for multi-region until we hit
  Supabase write contention, which is months out.

---

*Last updated: 2026-04-25 (Wave: portability prep / Agent CB)*
*Owner: Mehdi (Numelite). Migration target: pre-Phase-1 (Q3 2026).*
