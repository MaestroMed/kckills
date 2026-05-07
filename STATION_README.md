# KCKills 24/7 Station — operator manual

This machine (`%COMPUTERNAME%`) is the production worker host for
[kckills.com](https://kckills.com). The frontend deploys to Vercel from
`main` automatically; this machine runs the **Python worker** that
detects matches, downloads VODs, clips kills, analyses them with Gemini,
moderates comments with Claude Haiku, generates OG images, and pushes
to Supabase + Cloudflare R2.

## Daily flow

```powershell
# Start the worker (foreground, supervised, auto-restarts modules on crash)
.\start-kc.ps1

# Quick health peek — process state, GPU, disk, recent log tail
.\status-kc.ps1

# Stop cleanly
.\stop-kc.ps1
```

Worker logs land in `worker\logs\worker-<timestamp>.log`. Old logs are
not auto-rotated — purge manually if disk pressure rises.

## What's installed (2026-05-07 setup)

| Component | Version | Where |
|---|---|---|
| Python | 3.14.4 | `C:\Users\Matter1\AppData\Local\Programs\Python\Python314\` |
| Worker venv | 3.14.4 | `worker\.venv\` |
| Node.js | 24.15.0 LTS | `C:\Program Files\nodejs\` |
| pnpm | 11.x | `%APPDATA%\npm\pnpm.cmd` |
| ffmpeg | 8.1.1 (gyan full) | winget package |
| NVENC | av1 + h264 + hevc | RTX 3060 12 GB driver 591.86 / CUDA 13.1 |
| yt-dlp | 2026.03.17 | winget package |
| gh CLI | 2.92.0 | `C:\Program Files\GitHub CLI\` |
| Firefox | latest | yt-dlp cookie source |

## Power policy

Sleep / hibernate / disk-spindown are **disabled on AC** so the worker
keeps running while you're afk. To verify or restore :

```powershell
powercfg /q SCHEME_CURRENT SUB_SLEEP STANDBYIDLE
powercfg /change standby-timeout-ac 0  # disable
```

The screen can still go dark — only the system can't enter S3. Manual
shutdown / restart still works as expected.

## Secrets

`worker\.env` and `web\.env.local` hold every secret. **Never committed.**

If you need to rebuild them from scratch:

- `web\.env.local` — `pnpm dlx vercel link && pnpm dlx vercel env pull`
  pulls everything Vercel knows.
- `worker\.env` — copy from the previous machine; otherwise reissue
  tokens from Supabase, Cloudflare R2, Google AI Studio, YouTube Data
  API, Discord webhooks, Riot dev portal. The `.env.example` file
  documents every var with a link to its source.

The `KCKILLS_*` performance knobs (parallelism, intervals, batch size)
are commented out in `.env.example`. They have sensible defaults; only
override if you hit a quota or want low-power mode (`KCKILLS_LOW_POWER=1`).

## YouTube cookies (required for clipper)

YouTube's anti-bot returns "Sign in to confirm" on every yt-dlp call
from a fresh IP. The clipper extracts cookies from a dedicated Firefox
profile :

```powershell
# One-time setup
& "C:\Program Files\Mozilla Firefox\firefox.exe" -CreateProfile "kckills-scraper"
& "C:\Program Files\Mozilla Firefox\firefox.exe" -P "kckills-scraper" https://youtube.com
# → sign in once, close. Don't reuse this profile for browsing.

# Then in worker\.env
KCKILLS_YT_COOKIES_FIREFOX_PROFILE=kckills-scraper
```

Why Firefox not Chrome : Chrome 127+ App-Bound Encryption blocks every
programmatic cookie extraction (browser_cookie3, --cookies-from-browser,
DPAPI). Firefox stores cookies in a plain SQLite that yt-dlp reads.

## Disk hygiene

VOD downloads + local clip mirror eat disk fast. The worker's clipper
deletes its source VOD after upload, but if a crash mid-pipeline leaves
orphan MP4s :

```powershell
# Inspect
Get-ChildItem worker\clips, worker\vods -Recurse -File |
    Measure-Object -Property Length -Sum |
    ForEach-Object { '{0:N1} GB' -f ($_.Sum / 1GB) }

# Manual cleanup (safe — everything is on R2)
Remove-Item worker\clips\* -Recurse -Force
Remove-Item worker\vods\* -Recurse -Force
```

A scheduled cleanup task can be added later via Task Scheduler if disk
pressure becomes recurring.

## Worker entry points

```powershell
.\start-kc.ps1                         # supervised daemon (default)
.\start-kc.ps1 sentinel                # one cycle of sentinel only
.\start-kc.ps1 harvester               # one cycle of harvester
.\start-kc.ps1 clipper                 # one cycle of clipper
.\start-kc.ps1 analyzer                # one cycle of analyzer
.\start-kc.ps1 pipeline <match_ext_id> # end-to-end on one match (debug)
.\start-kc.ps1 backfill --limit 50     # backfill from kc_matches.json
```

## When something breaks

1. **Worker won't start** — check `worker\.env` exists and `SUPABASE_URL` is set.
   Run `.\worker\.venv\Scripts\python.exe -c "import config; print(config)"`
   to surface the first missing var.
2. **No clips coming out** — check `KCKILLS_YT_COOKIES_FIREFOX_PROFILE`
   is set and the Firefox profile actually has YouTube cookies. Tail
   `worker\logs\worker-*.log` for "Sign in to confirm" patterns.
3. **Gemini quota exhausted** — quota resets at 07:00 UTC. Set
   `KCKILLS_GEMINI_TIER=balanced` to switch to gemini-3-flash (paid tier
   with prompt caching) if you need to keep going.
4. **Disk full** — see Disk hygiene above.
5. **Crash loop** — the supervisor (in `worker\main.py`) restarts modules
   individually. If the parent supervisor dies, just rerun `.\start-kc.ps1`.

## Frontend dev (optional — RAM-tight on this machine)

```powershell
cd web
& "$env:APPDATA\npm\pnpm.cmd" dev
```

Prefer running frontend dev on a different machine — this one is sized
for the worker. 16 GB RAM is fine for either, but not both at full tilt.

## Deploy

Push to `origin main`. Vercel auto-deploys. There is no separate web
deploy on this machine.
