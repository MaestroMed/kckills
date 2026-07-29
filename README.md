# KCKILLS

> A cinematic, TikTok-style feed of League of Legends esports highlights dedicated to **Karmine Corp** — every notable moment clipped, scored, and shipped automatically.

**Live:** [kckills.com](https://kckills.com)

Not a stats site, not a wiki, not a generic aggregator. A fully automated pipeline that watches for KC matches, cuts the moments that matter, and publishes them in a vertical feed built for the KC Army.

---

## How it works

A supervised Python worker runs 24/7 on a dedicated host and drives five stages:

| Stage | Job |
|---|---|
| **Sentinel** | Watches the LoL Esports API for KC matches going live |
| **Harvester** | Detects kill events by diffing livestats frames |
| **Clipper** | Cuts each moment with ffmpeg into three formats (horizontal, vertical, low-bitrate vertical) using NVENC hardware encoding |
| **Analyzer** | Scores and describes clips with Gemini 2.5 Flash-Lite |
| **Publisher** | Generates OG images, moderates comments with Claude Haiku, pushes to Supabase + Cloudflare R2 |

The Next.js frontend deploys to Vercel from `main`; the worker runs separately and survives crashes through an asyncio supervisor that restarts individual modules without taking down the process.

## Stack

**Frontend** — Next.js, TypeScript, deployed on Vercel
**Worker** — Python 3.14, asyncio supervisor, Docker
**Data** — Supabase (Postgres), Cloudflare R2, local SQLite fallback cache
**Media** — ffmpeg 8.1 with NVENC (AV1 / H.264 / HEVC), yt-dlp
**AI** — Gemini 2.5 Flash-Lite (clip analysis), Claude Haiku (comment moderation)

### Notable decisions

- **Three data sources, cross-checked.** The LoL Esports API alone is unreliable for historical data, so Oracle's Elixir CSV exports and the Leaguepedia Cargo API are wired in as fallbacks (`modules/data_fallback.py`).
- **Centralised rate limiter.** Every outbound call goes through one scheduler with per-source delays and daily quotas — no module can burn the budget on its own.
- **Hardware encoding is not optional.** Cutting three formats per clip at software speed does not keep up with a live match; NVENC does.
- **The livestats feed gives KDA snapshots, not kill events.** Individual kills have to be reconstructed by diffing consecutive frames — this is the hard part of the pipeline.

## Quick start

```bash
git clone https://github.com/MaestroMed/kckills.git && cd kckills
pnpm install                      # frontend
cp worker/.env.example worker/.env  # fill in API keys
pnpm dev                          # frontend on :3000
```

Worker operations (Windows host):

```powershell
.\start-kc.ps1    # start supervised worker
.\status-kc.ps1   # process state, GPU, disk, recent logs
.\stop-kc.ps1     # clean shutdown
```

## Status

**Beta — the frontend and data layer run in production; parts of the worker pipeline are written but not yet fully exercised.**

Working today: match and player data ingestion (111 games across 83 matches), the asyncio worker architecture, the rate limiter, the local cache, the frontend feed.

Not yet proven end-to-end: individual kill-event backfill, the frame-diff harvester, the triple-format clipper, and the Gemini analyzer. `FEATURES.md` tracks the exact state of every component and is kept honest.

## Documentation

The repository carries its own design record: `VISION.md` (product intent and audience), `FEATURES.md` (component-level status), `ANALYZER_PIPELINE_SPEC.md`, `EVENT_MAP_SPEC.md`, `MONITORING.md`, and `STATION_README.md` (operator manual for the 24/7 host).

## Legal

Unofficial fan project. Not affiliated with, endorsed by, or sponsored by Karmine Corp or Riot Games. League of Legends and all related assets are trademarks of Riot Games, Inc.

## License

See [LICENSE](LICENSE).
