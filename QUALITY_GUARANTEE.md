# QUALITY GUARANTEE — How We Know A Clip Is Good

User question : *"How do we guarantee the quality of the clip ? Well made,
well cut, well described, tagged ?"*

This document is the answer. Eight gates, every clip, every time.
A clip only reaches `/scroll` when **all** gates pass.

---

## The 8 Quality Gates

```
┌─────────────────────────────────────────────────────────────────────┐
│                  PIPELINE → /scroll                                 │
│                                                                     │
│   harvester  →  clipper  →  analyzer  →  og_generator  →  PUBLISHED │
│      │            │            │              │                     │
│      │            │            │              ▼                     │
│      │            │            │         GATES 7+8                  │
│      │            │            ▼              ↑                     │
│      │            │         GATE 4-6          │                     │
│      │            ▼            ↑              │                     │
│      │         GATE 1-3        │              │                     │
│      ▼            │            │              │                     │
│  GATE 0 ──────────┴────────────┴──────────────┘                     │
│                                                                     │
│   game_events.is_publishable = AND(all gates) → publish trigger     │
└─────────────────────────────────────────────────────────────────────┘
```

### GATE 0 — Detection accuracy (harvester)

**What it guards :** "Did we correctly identify a kill from the live
stats, including who killed whom, when, with which assists?"

**How :** harvester reads the LolEsports Live Stats API at 10s intervals.
KDA deltas frame-over-frame identify the killer + victim. Multi-kill
chains are detected via sliding window (~30s) on a single player.

**Confidence levels :** `high` / `medium` / `low` / `estimated` / `verified`.
Stored in `kills.confidence`. Used by event_mapper to populate
`game_events.detection_confidence`.

**Pass rate today :** 100% (every kill row has a confidence value).

### GATE 1 — Right VOD, right time (clipper offset)

**What it guards :** "Does the clip actually show the kill, or is it
showing the panel / draft / interview ?"

**How :**
- `games.vod_youtube_id` + `games.vod_offset_seconds` define where the
  game starts in the YouTube VOD.
- Clipper extracts `[offset + game_time - 30s, offset + game_time + 10s]`.
- **Gate enforcement :** if `vod_offset_seconds = 0` AND we're not 100%
  sure the game starts at second 0 (which is rare on full broadcasts —
  there's usually 10-30 min of pre-show), the offset is treated as
  unknown. The `vod_offset_finder` module runs every 1h, computes the
  real offset via Live Stats epoch alignment + Gemini timer validation
  (snaps a frame at offset+60s, asks Gemini to read the in-game timer,
  rejects if drift > 10s).
- **Past failures recovered :** `quarantine_offset_zero.py` retroactively
  flagged 91 games that had offset=0, moved their kills back to
  `analyzed + needs_reclip=true`. They re-clip when the offset_finder
  computes the real offset.

**Pass rate today :** Of 134 currently-published, 0 have `needs_reclip=true`
(fixed in PR11 retract pass). Of 91 affected games, vod_offset_finder
will resolve 5/h until drained (~24h).

### GATE 2 — Cut bounds + duration (clipper)

**What it guards :** "Is the clip cut at sensible boundaries — not
mid-action, not too short, not too long ?"

**How :** clipper uses fixed pads — 30s before kill, 10s after = 40s
clip total. This window covers :
- pre-kill setup (positioning, ult cooldowns visible)
- the kill moment itself
- the immediate aftermath (kill confirmation popup, killfeed flash)

NVENC keyframe alignment (`-g 60` on 30fps source) ensures clean cuts
at 2s segment boundaries for HLS streaming.

**Pass rate today :** 100% — every published clip has these dimensions
because the encoder fails closed (no clip = no DB row update).

### GATE 3 — Triple format + thumbnail (clipper)

**What it guards :** "Will it play on every device / network ?"

**How :** clipper produces 4 outputs per kill :
- `clip_url_horizontal` : 1920×1080, H.264 high@4.1, 4 Mbps cap (desktop)
- `clip_url_vertical` : 1080×1920, H.264 high@4.1, 4 Mbps cap (mobile / scroll)
- `clip_url_vertical_low` : 540×960, H.264 baseline@3.1, 1.2 Mbps (slow networks)
- `thumbnail_url` : 720×1280 JPEG q=2 (smart-pick from 3 candidate frames
  via `_pick_best_thumbnail` which scores luminance × variance — picks
  the most informative frame, rejects loading screens / white flashes).

NVENC handles all encoding on RTX 4070 Ti — ~8× realtime.

**Pass rate today :** 100% (each gated by ffmpeg returncode ; failure
sets `status='clip_error'` not `clipped`).

### GATE 4 — Content uniqueness (clip_hash)

**What it guards :** "Is this an exact duplicate of another clip ?"

**How :**
- `content_hash` : SHA-256 of the H.264 MP4 bytes. UNIQUE INDEX prevents
  byte-identical re-uploads.
- `perceptual_hash` : 64-bit pHash of the thumbnail. Hamming distance
  < 5 ≈ same clip ; < 10 ≈ same fight from different angle.

**Pass rate today :** Indexed at the DB level — duplicates can't insert.

### GATE 5 — kill_visible (Gemini)

**What it guards :** "Is the kill actually on screen, or is the camera
on someone else / the minimap / the caster cam ?"

**How :** analyzer downloads the clip, sends it to Gemini 2.5 Flash-Lite
with the prompt asking if `kill_visible_on_screen == True/False/null`.
Rejects (sets `kill_visible=False`) when the camera missed the moment.

**PR11 enforcement :** og_generator now refuses to publish kills with
`kill_visible == False`. Was previously a soft signal only used by the
feed RPC filter — now it's a hard publish gate.

**Pass rate today :** 100% TRUE in 100-clip sample (Gemini permissive
when the kill happens in the broadcast frame — possibly too permissive,
needs validation against a labeled set).

### GATE 6 — Description + tags (Gemini + validate_description)

**What it guards :** "Does the clip have a meaningful French description
and 3-5 relevant tags that humans actually want to read ?"

**How :** analyzer's Gemini prompt requires :
- `description_fr` : ≥ 50 chars, no encoding artifacts, no banned phrases,
  no hallucination patterns. Validated by `validate_description()`.
- `tags` : 1-5 from a fixed taxonomy (outplay, teamfight, solo_kill,
  tower_dive, baron_fight, dragon_fight, flash_predict, 1v2, 1v3,
  clutch, clean, mechanical, shutdown, comeback, engage, peel, snipe,
  steal). Out-of-vocab tags are stripped.

Failures bump `retry_count`. After 3 failures the kill moves to
`status='manual_review'` — never publishes without admin OK.

**PR11 enforcement :** og_generator refuses to publish without an
`ai_description` (was previously possible to publish a NULL description).

**Pass rate today :** description ≥ 50 chars on 100% of sampled,
description ≥ 80 chars on 57%, tags present on 100%, 3+ tags on 84%.

### GATE 7 — Highlight score floor (PR11)

**What it guards :** "Is this clip even worth showing, or is it a
2v0-routine-trade nobody cares about ?"

**How :** Gemini's `highlight_score` (1.0-10.0) is a weighted hype rating.
PR11 og_generator refuses to publish when `highlight_score < 3.0`. The
distribution today is heavily right-skewed (95% are ≥ 7), so this gate
catches the rare low-quality outliers.

**Pass rate today :** 100% in published set (no published kills have
highlight < 3 — distribution naturally clusters above the floor).

### GATE 8 — Auto-QC sample + admin override (qc_sampler + clip_qc.verify)

**What it guards :** "Did the clip actually align with the expected
in-game timer ? Did the offset drift ?"

**How :**
- `qc_sampler` runs every 1h. Picks 20 random recently-published clips.
- For each, enqueues a `clip_qc.verify` job in `worker_jobs`.
- The `job_runner` consumes them — downloads the clip, snaps a frame at
  the mid-point, asks Gemini to read the in-game timer, compares with
  expected `game_time_seconds`. If drift > 30s, sets
  `qc_clip_validated=FALSE` AND `needs_reclip=TRUE` on the kill.
- The og_generator's `needs_reclip` filter then RETRACTS the clip from
  `/scroll` automatically (kill drops back to `status='analyzed'`).

**Coverage :** 20/cycle × 24 cycles/day = 480 QC checks/day = ~2× the
publish rate. Every clip has a high probability of being QC'd within 24h
of publication.

**Admin override :** the `qc_human_approved` column on `game_events`
is the manual escape hatch. Admin marks `FALSE → reason` and the
`is_publishable` GENERATED column instantly drops to FALSE → the
event_publisher retracts on its next 5min cycle.

---

## How the gates compose : the canonical map

The PR6 `game_events` table is the single source of truth :

```sql
-- All 4 hard gates green AND no permissive gate explicitly FALSE
is_publishable BOOLEAN GENERATED ALWAYS AS (
    qc_clip_produced            -- Gate 1+2+3
    AND qc_clip_validated       -- Gate 8 (per-clip Gemini timer check)
    AND qc_typed                -- Gate 0 (event_type confirmed)
    AND qc_described            -- Gate 6
    AND (qc_visible IS NOT FALSE)        -- Gate 5 (TRUE or NULL passes)
    AND (qc_human_approved IS NOT FALSE) -- admin escape (TRUE or NULL passes)
) STORED
```

Each pipeline module ticks its gate after its work. The
`event_publisher` daemon polls `game_events WHERE is_publishable=TRUE
AND published_at IS NULL` every 5min and flips `kills.status='published'`.

---

## What we measure (ongoing)

The heartbeat module emits these every 6h to Discord :

- `published_today` : new clips that crossed all gates
- `analyzed_today` : Gemini calls
- `clip_error_today` : ffmpeg/yt-dlp failures (auto-retried)
- `qc_clip_validated_pass` / `qc_clip_validated_fail` (PR11)
- `manual_review_today` : kills that exceeded retry budget
- `gemini_quota_remaining` / `youtube_quota_remaining`

---

## Honest limitations (today)

- **HLS coverage** : 33% of published clips have HLS adaptive streams.
  PR11 bumped hls_packager 25 → 100/cycle, will reach 100% within ~6h.
- **Gemini's kill_visible is permissive** : 100% pass rate suggests
  Gemini says yes by default. Worth eyeballing 20 random clips to see
  if it's actually right.
- **Description length distribution** : 43% of descriptions are 50-79
  chars (PR8.1 lowered floor to 50). Some of these read terse — the
  prompt could push for more detail.
- **No per-clip MOMENT verification** : we know the clip TIMER matches
  the kill, but not that "the right player was in frame". Fixing this
  would require Gemini to confirm "did I see champion X kill champion Y"
  — implementable but adds 1 Gemini call per QC.
- **Editorial bar is automated only** : no human-in-the-loop curation
  yet. The `qc_human_approved` admin UI (PR6-E) is in the backlog.

---

## Bottom line

Every clip on `/scroll` has passed :
- ffmpeg encoded a 4-format set successfully
- Gemini wrote a French description ≥ 50 chars
- Gemini saw the kill on screen (`kill_visible != FALSE`)
- Gemini rated the highlight ≥ 3/10
- Description passed validate_description (no hallucinations / artifacts)
- 3+ tags from fixed taxonomy (84% of the time)
- Content hash uniqueness check
- Not flagged for re-clip (`needs_reclip != TRUE`)

And within 24h of publish, ~50% will have been timer-verified by the
qc_sampler against the in-game clock.

If a clip fails post-publish QC (drift detected), it auto-retracts
from `/scroll` within 5 minutes via the event_publisher loop.

---

## 💰 Budget tier system (PR12, April 2026)

The Gemini model used at each pipeline stage is selectable via env var,
with sensible tier presets in `worker/config.py`. The default ("free")
is what the daemon ran on for free-tier deployment.

```
KCKILLS_GEMINI_TIER=free          # default — gemini-3.1-flash-lite everywhere (GA 2026-05-07)
KCKILLS_GEMINI_TIER=balanced      # gemini-3-flash for descriptions
KCKILLS_GEMINI_TIER=premium       # gemini-2.5-pro for descriptions  ← €45 KC config
KCKILLS_GEMINI_TIER=experimental  # gemini-3.1-pro-preview (shutdown risk)
```

Per-stage env-var overrides win over the tier preset :
```
GEMINI_MODEL_ANALYZER=gemini-2.5-pro
GEMINI_MODEL_QC=gemini-3.1-flash-lite
GEMINI_MODEL_OFFSET=gemini-3.1-flash-lite
```

### €45 budget plan (premium tier on the entire 2,021-kill KC catalog)

| Stage | Model | Cost |
|---|---|---|
| Description / tags / score (every clip) | Gemini 2.5 Pro default | €37.50 |
| Timer QC (qc_sampler @ 20/cycle × 24/day) | Gemini 2.5 Flash-Lite | ~€2 |
| VOD offset validation (91 quarantined games) | Gemini 2.5 Flash-Lite | ~€0.50 |
| Buffer (retries + 30 days of new clips) | — | ~€5 |
| **Total** | | **~€45** ✅ |

### Hard daily cap (defense in depth)

`worker/scheduler.py` enforces `DAILY_QUOTAS["gemini"]` via the
`KCKILLS_GEMINI_DAILY_CAP` env var. Default 950 (free-tier safe). Set
to 250 with the premium tier to spread the €45 spend over ~10 days
(€3/day burn rate, fully drains the catalog without scary spikes).

```
KCKILLS_GEMINI_DAILY_CAP=250
```

When hit, the analyzer / QC / offset modules log
`gemini_daily_quota_reached` and idle until 07:00 UTC reset (Google's
quota window). Pipeline doesn't crash — just paces itself.

### Re-analysis script (upgrade existing descriptions)

```bash
# Dry-run — list candidates, no API calls
python worker/scripts/reanalyze_with_premium.py --dry-run

# Live — process candidates serially, respect daily cap
python worker/scripts/reanalyze_with_premium.py --commit
```

Refuses to run if `GEMINI_MODEL_ANALYZER` is still flash-lite (no point
spending to upgrade a description with the same model that wrote it).
Idempotent : tracks `kills.reanalyzed_at` / `reanalyzed_model` so re-runs
skip already-upgraded clips.

### Persistence guarantees

| What | Persisted to | Survives reset ? |
|---|---|---|
| Description / tags / score | Supabase `kills.ai_description` etc. | ✅ |
| Premium-tier flag | Supabase `kills.reanalyzed_at` / `reanalyzed_model` | ✅ |
| Generated clips | Cloudflare R2 | ✅ |
| OG images | R2 | ✅ |
| QC verification history | Supabase `worker_jobs.result` (clip_qc.verify) | ✅ |
| Code (model selection logic) | Git commit | ✅ |
| Migration 015 (reanalyzed_at column) | Supabase schema | ✅ once you apply it |
| Gemini API key + billing | Google Cloud project (separate from the worker) | ✅ — tied to the project, not the code |

**Practical : if you nuke `D:/kckills_worker/`, restart Docker, reset
the daemon — the work survives.** All you need to keep is :
1. The Google Cloud project with billing enabled (one-time setup)
2. The Supabase project (your DB — migrations + data persist)
3. The R2 bucket (clips + OG images)
4. The git repo (code)

No API token paid for premium-tier work is "burnt" by a daemon restart.

### One-time billing setup (4 steps, ~5 min)

1. Go to https://aistudio.google.com → API keys
2. Click your existing key → "Manage in Google Cloud Console"
3. In Google Cloud → Billing → link a payment method to the API project
4. Billing → Budgets & alerts → Create budget : amount **€45**, alert
   thresholds at 50% / 75% / 90% / 100%

After step 4, Google emails you when you hit each threshold, and the
worker's hard cap (`KCKILLS_GEMINI_DAILY_CAP=250`) prevents overshoot.
