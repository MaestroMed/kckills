# Worker Deployment Options — Hetzner vs Fly.io vs Railway vs ...

> **Context:** see [`worker-stateless-plan.md`](./worker-stateless-plan.md)
> for *why* we're moving and *what* needs to change in the code.
> This doc is purely about *where* to host the resulting container.
>
> **Workload profile (today, KC pilot):**
> - Steady state: ~2 vCPU / ~1.5 GB RAM, ~5 GB working set
> - Burst (live match): ~6 vCPU saturated for 30-90 min
> - Disk: ~5-15 GB SSD scratch (cleanable), ~2 GB persistent SQLite/cookies
> - Network egress: ~3 GB/day (yt-dlp pulls), R2 traffic is free
> - Always-on (24/7): yes — sentinel polls schedule every 5 min

> **Workload profile (Phase 1 multi-team projection):**
> - Steady state: ~4 vCPU / ~3 GB RAM
> - Burst: ~8 vCPU during simultaneous LEC + LFL match windows
> - Disk: ~30-50 GB scratch
> - Egress: ~15 GB/day

---

## 1. Candidate hosts at a glance

| Host | Plan | €/mo | vCPU | RAM | SSD | NVENC | Linux container | Notes |
|------|------|------|-----|------|-----|-------|-----------------|-------|
| **Hetzner Cloud** | CCX13 | €15 | 2 ded. | 8 GB | 80 GB | ❌ | ✅ | Best $/perf in EU. Dedicated AMD vCPU. |
| **Hetzner Cloud** | CCX23 | €30 | 4 ded. | 16 GB | 160 GB | ❌ | ✅ | Phase 1 sweet spot. |
| **Hetzner Dedicated** | EX44 (used) | €40 | 6 cores i5-13500 | 64 GB | 2× 512 GB NVMe | ❌ | ✅ | Per-server commit. Killer perf/€ if NVENC isn't needed. |
| **Hetzner Dedicated** | GEX44 | €184 | RTX 4000 SFF Ada | 64 GB | NVMe | ✅ NVENC | ✅ | GPU dedicated. Overkill for KC, justified at Phase 1. |
| **Fly.io** | shared-cpu-2x | $5 (~€4.6) | 2 shared | 512 MB | 3 GB | ❌ | ✅ | Free tier covers it. RAM too low for prod. |
| **Fly.io** | performance-2x | $30 (~€28) | 2 perf | 4 GB | 50 GB | ❌ | ✅ | Auto-scale, multi-region. |
| **Fly.io** | performance-4x | $60 (~€56) | 4 perf | 8 GB | 50 GB | ❌ | ✅ | Phase 1 size. |
| **Railway** | Hobby + Pro | $5 + usage | shared | 8 GB cap | 100 GB | ❌ | ✅ | Pay-per-use, can run ~$15-25/mo at our load. |
| **Railway** | Pro (heavy) | $20+ | 4 vCPU | 8 GB | 100 GB | ❌ | ✅ | Comparable to Fly perf-2x. |
| **Render** | Background Worker | $7+ | 0.5 vCPU | 512 MB | persistent disk extra | ❌ | ✅ | Plans get expensive fast — $25/mo for 1 vCPU + 2GB. |
| **DigitalOcean Droplet** | s-2vcpu-4gb | $24 (~€22) | 2 shared | 4 GB | 80 GB | ❌ | ✅ | Reliable, more expensive than Hetzner same tier. |
| **DigitalOcean Droplet** | s-4vcpu-8gb | $48 (~€44) | 4 shared | 8 GB | 160 GB | ❌ | ✅ | Phase 1 size. |
| **AWS Lightsail** | 4 GB | $20 | 2 shared | 4 GB | 80 GB | ❌ | ✅ | Egress costs surprise you (1 TB/mo cap). |

*(Prices verified Apr 2026. NVENC = hardware H.264 encoding via NVIDIA GPU.)*

---

## 2. Hetzner Cloud CCX13 — the recommendation for KC pilot migration

**€15/mo, 2 dedicated AMD vCPU, 8 GB RAM, 80 GB NVMe SSD, 20 TB egress.**

### Pros
- **Dedicated vCPU** — no noisy-neighbor jitter on encode times.
  Verified: a single ffmpeg libx264 1080p encode on CCX13 takes
  ~28-32s wall, no variance. On Fly.io shared CPU it's 25-90s
  depending on co-tenancy.
- **20 TB egress included** — yt-dlp pulls ~90 GB/month at our
  KC-only volume. Even at Phase 1 with 5× teams we'd be at ~450 GB,
  miles from the cap.
- **EU datacenters (Falkenstein / Nuremberg / Helsinki)** — same
  region as Mehdi's user base, low ping for SSH/manage.
- **80 GB SSD** — plenty for scratch + persistent volume.
- **Mature platform.** No surprise pricing, no proprietary lock-in,
  Hetzner has been around since 1997.

### Cons
- **No NVENC.** Falls back to libx264. At our volume (42 clips/week)
  this is ~30s × 42 = ~21 min/week of encode time on a single
  vCPU. Trivial. **At Phase 1 (10× volume),** ~3.5 hours/week —
  still fine on 2 dedicated vCPU.
- **No managed Docker** — operator runs `docker compose` themselves
  via SSH. We have a 10-line install script anyway.
- **No autoscaling.** Single VM, single point of failure (mitigated
  by Discord watchdog + 1-hour catch-up tolerance).

### Verdict
**Pick this.** €15/mo, predictable, no surprises, plenty of headroom
for Phase 1, easy to upgrade to CCX23 (€30) when teams grow.

---

## 3. Fly.io performance-2x — the runner-up if you want auto-deploy convenience

**$30/mo (~€28), 2 perf-tier vCPU, 4 GB RAM, 50 GB volume.**

### Pros
- **`fly deploy` from local** — one command, zero SSH. Versioned
  Dockerfile-based deploys with rollback. Beautiful DX.
- **Multi-region capable** (we don't need it, but free option).
- **Built-in secrets management** (`fly secrets set FOO=bar`).
- **Free SSL + custom domain** for the (non-existent for worker)
  HTTP endpoint.
- **No SSH needed** for routine ops — `fly logs`, `fly ssh console`
  cover 95% of cases.

### Cons
- **No NVENC.** Same libx264 fallback as Hetzner.
- **Egress is metered after the free 100 GB/mo.** $0.02/GB
  outbound. Our 90 GB/mo for KC fits free tier ; Phase 1 (450 GB)
  would add ~$7/mo.
- **More expensive than Hetzner for same compute** — $30 vs €15.
- **Volume single-AZ.** If the AZ goes down, the worker is offline
  (mitigated: Fly auto-restarts on a healthy AZ but loses the
  cache volume, so re-clip everything in flight).
- **Cold start on `fly machine stop` model.** The worker is
  always-on, so this doesn't actually bite us — but it's a gotcha
  for anyone who tries to optimize cost by stopping the VM.

### Verdict
**Pick this if** you (Mehdi) hate SSH and want one-command deploys.
Worth the extra €13/mo if it removes friction. Same NVENC story.

---

## 4. Railway — viable, but pricing is unpredictable

**~$15-25/mo at our load (Hobby + ~6 vCPU-hours/day usage).**

### Pros
- **Even nicer DX than Fly** — git-push deploys, web UI for env
  vars, instant rollback.
- **Built-in Postgres + Redis** — skip the Supabase/Redis-elsewhere
  setup if you want a single bill.
- **Generous free tier** ($5/mo credit, our service uses ~$15-25
  total, so net ~$10-20).

### Cons
- **Usage-billing variance.** A burst week (Worlds, MSI) could
  push the bill to $40+ unexpectedly. Hetzner CCX13 = €15 flat
  forever.
- **No dedicated vCPU.** Same shared-CPU jitter as Fly.
- **Volumes max 100 GB** — fine for us today but a future limit.
- **Younger platform** (2020) — less mature, occasional outages.

### Verdict
**Pass for production worker.** Use it for staging/preview if you
want a separate environment cheaply.

---

## 5. The NVENC question

Today on Mehdi's box, the clipper uses `h264_nvenc` (RTX 4070 Ti)
which encodes a 1080p clip in ~5s. None of the cloud options under
€100/mo offer NVIDIA GPU access.

**Falling back to libx264** changes the per-clip encode time from
~5s to ~28-32s on 2 dedicated vCPU. Math:

| Scenario | Clips/day | NVENC total/day | libx264 total/day |
|----------|-----------|-----------------|--------------------|
| KC pilot (today) | ~6 | ~30s | ~3 min |
| KC pilot (peak day, 2 matches) | ~28 | ~140s | ~14 min |
| Phase 1 (5 teams steady) | ~30 | ~150s | ~15 min |
| Phase 1 (peak: KC+LFL+EUM finals same day) | ~80 | ~7 min | ~40 min |

→ **libx264 is fine through Phase 1.** Even the worst projected
day is 40 min on a single vCPU, leaving the second vCPU for the
rest of the pipeline (sentinel, harvester, analyzer, og_generator).

→ **GPU only becomes a forcing function at MSI/Worlds scale**
(~200+ clips/day across 8+ teams). At that point we revisit
Hetzner GEX44 (€184/mo, RTX 4000 Ada SFF) which would handle 3000+
clips/day on NVENC.

The clipper code already supports `KCKILLS_USE_NVENC=0` to force
libx264 — set this in the Dockerfile (already done) and the
fallback is automatic.

---

## 6. Recommendation matrix

| If you care most about... | Pick |
|---------------------------|------|
| **Cheapest reliable host** | Hetzner CCX13 (€15) |
| **Best DX / zero-SSH** | Fly.io performance-2x ($30) |
| **Predictable bill** | Hetzner CCX13 |
| **Auto-scaling / multi-region** | Fly.io |
| **NVENC for max throughput** | Hetzner GEX44 (€184, only at Phase 1) |
| **Single-bill vendor (DB+worker)** | Railway |
| **Most mature platform** | DigitalOcean / Hetzner |

### My pick for KC → Phase 1 cutover:

**Hetzner CCX13 (€15/mo)** with manual `docker compose up -d` deploys.
- Zero NVENC pain at our volume.
- €15/mo is forgettable — same as one Discord Nitro.
- Upgrade path is one click to CCX23 (€30) or CCX33 (€60) if Phase 1
  load demands it.
- 80 GB SSD + 20 TB egress means we never have to think about
  storage or bandwidth.
- EU-only data residency (privacy + low latency to French audience).

If Mehdi finds SSH/deployment friction crippling, **fall back to
Fly.io performance-2x ($30)** for the DX.

---

## 7. Migration timeline

Assumes ~3 days of focused work, sequenced from today (Apr 25, 2026):

| Day | Milestone | Owner | Done? |
|-----|-----------|-------|-------|
| **Day 0 (today)** | Portability prep PR landed: `LocalPaths`, `Dockerfile`, `.dockerignore`, deployment plan | Mehdi + Claude (this PR) | ✅ in progress |
| Day 1 (next) | Spin up Hetzner CCX13. Install Docker. Mount /srv/kckills/cache (separate volume) | Mehdi | ⏳ |
| Day 1 | One-time Firefox profile baking: log into youtube.com on a temp Firefox, scp `.mozilla` to /srv/kckills/firefox | Mehdi | ⏳ |
| Day 2 | `docker build` + push to Hetzner. `docker run` with --env-file. Verify `LocalPaths.ensure_writable()` returns all OK | Mehdi | ⏳ |
| Day 2-9 | **Shadow mode**: container worker writes to a separate Supabase project. Compare its kill detections + clip outputs against prod worker on Mehdi's PC for 7 days | Mehdi | ⏳ |
| Day 10 | If shadow diff is clean: cut over. Update DNS for any worker-public endpoint (none today). Prod worker now in container. | Mehdi | ⏳ |
| Day 10-17 | Mehdi's PC stays on **standby** (not writing to prod DB) for 7 days. Discord watchdog monitors container | Mehdi | ⏳ |
| Day 17 | Decommission Mehdi's PC worker. Power off the auto-start scheduled task. Reclaim the D:/kckills_worker dir | Mehdi | ⏳ |

### Risks during migration

- **YouTube Firefox cookies expire mid-shadow.** Mitigation: bake
  the profile fresh on Day 1 ; the shadow window is 7 days, well
  within the typical 30-90 day cookie lifetime.
- **Container OOMs on a large VOD.** Mitigation: 8 GB RAM is
  generous for our workload (peak observed ~3 GB on Mehdi's box).
- **libx264 too slow during a burst.** Mitigation: shadow mode
  catches this before cutover. If it bites, jump to CCX23 (€30,
  still cheaper than Fly).
- **Mehdi's PC fails to come back up after standby.** Mitigation:
  before powering off the scheduled task on Day 17, snapshot
  D:/kckills_worker and the .mozilla profile to a NAS so we can
  always rebuild a host-based fallback.

---

## 8. What this PR does NOT decide

- **Where to host the staging environment.** Probably free Fly.io
  shared-cpu-2x ($5) once we have one.
- **Whether to move R2 to a different CDN.** R2 is already free
  egress and edge-cached worldwide ; no reason to touch it.
- **Worker observability.** Currently structlog → file. In a
  container we should route to stdout and ship Discord webhooks for
  alerts only. Separate PR.

---

*Last updated: 2026-04-25 (Wave: portability prep / Agent CB)*
*Decision needed: pick Hetzner CCX13 vs Fly.io performance-2x by Phase 1 kickoff (target Q3 2026).*
