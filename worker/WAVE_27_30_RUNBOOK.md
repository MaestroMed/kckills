# Wave 27.27 → 27.31 — recovery runbook

Last updated : 2026-05-11 morning. **Steps 1-4 are DONE.** Steps 5+
are operator follow-ups.

## What actually happened on 2026-05-11

* Daemon restarted → Wave 27.30 loaded → harvester started inserting
  kills with NULL player_id for non-KC opponents. **+149 kills**
  ingested across 6 of the 10 reset games (the other 4 need another
  harvester cycle).
* QC resume launched → 30 clips QC'd before hitting Gemini FILE
  STORAGE 20 GB quota (different from RPM). Cleanup script deleted
  ~540 old files, QC resumed → at the time of this update, the
  remaining ~387 clips are flowing through cleanly at ~10/min.
* **NEW BUG FOUND : sentinel was clobbering vod_youtube_id every 5 min.**
  promote_misaligned set vod_youtube_id = alt_vod (KC Replay), but
  sentinel's safe_upsert blindly re-applied the LEC vod_youtube_id from
  getEventDetails on the next cycle. Wave 27.31 (commit f6cb1ee) makes
  sentinel preserve a row's existing vod_youtube_id. The 6 misaligned
  games promoted yesterday are now STABLE on KC Replay.
* Per-kill yt-dlp 300s timeout was too tight for KC Replay's deep
  timestamps (100-200s in the locate phase alone). Bumped to 600s
  (commit 563ca1e).

This is the operator's sequence to recover the pipeline after Wave 27.30
(critical FK regression fix). Run these in order tomorrow morning, after
the Gemini daily quota resets at **07:00 UTC** (09:00 Paris).

---

## 1. Restart the worker daemon

The daemon at PID 17444/8532 was started 2026-05-10 18:04 — BEFORE the
Wave 27.30 fix landed. It still has the broken `_player_uuid_from_ign`
loaded in memory, so every kill it tries to ingest gets rejected by
`kills_killer_player_id_fkey`.

Stop the daemon (Ctrl-C in its terminal), then re-launch :
```
cd C:/Users/Matter1/Kckills/worker
.venv/Scripts/python.exe main.py
```

Verify on startup the harvester logs `player_uuid_cache_loaded n=317`
(or similar) once on first harvester cycle — that confirms Wave 27.30
is active.

## 2. Resume the QC pass

The Wave 27.27 pass got 304/687 clips QC'd before hitting the Gemini
daily quota at ~clip 510. The remaining 383 will run cleanly on the
fresh quota.

```
cd C:/Users/Matter1/Kckills/worker
.venv/Scripts/python.exe qc_global.py --resume
```

ETA ~30 minutes. Resume mode skips the 304 entries already in
`deep_qc/qc_global_results_*.json` and processes only the new ones.

Once done :
```
.venv/Scripts/python.exe analyze_qc_results.py
```
This prints the full verdict / quality / issue / eligibility breakdown
on the complete 687-clip pass.

## 3. Calibrate the 6 promoted games

`promote_misaligned.py` flipped `vod_youtube_id ← alt_vod_youtube_id` on
6 LEC games and nulled `vod_offset_seconds`. Tomorrow's first
`vod_offset_finder_v2` cycle (default 3600 s) will pick them up. To
accelerate :

```
.venv/Scripts/python.exe -m modules.vod_offset_finder_v2
```

ETA ~5 minutes per game (Gemini reads the in-game timer to find the
offset). After this, those games' offsets are KC Replay-relative and
ready for `reclip_from_kc_replay.py` to consume.

## 4. Re-harvest the 10 empty Feb 2026 games

`retry_empty_harvest.py --apply` already reset `kills_extracted=FALSE`
on 10 KC LEC Versus Feb 2026 matches where the original harvest had
zero kills (caused by Wave 27.19 regression now fixed). After the
daemon restart in step 1, its next harvester cycle (default 600 s)
will re-extract these — typically yielding 14-42 kills per game.

To force the cycle :
```
.venv/Scripts/python.exe -c "import asyncio; from modules.harvester import run; asyncio.run(run())"
```

ETA ~5-10 minutes per game.

## 4b. Known issue : yt-dlp merge step hangs on large casts (Windows)

The smoke pass of `reclip_from_kc_replay.py --game 115548668059523726
--limit 3` consistently failed in the VOD pre-download phase :

* AV1 (Wave 27.29 fix shifted to H.264 to dodge a ffmpeg+NVENC segfault)
* H.264 separate video + audio merge produced an audio-only output once
* H.264 merge with HLS-prefer selector stalled with 0 bytes written
  for 10+ seconds while ffmpeg.exe held the temp.mp4 handle

The root cause is yt-dlp / ffmpeg on Windows handling 3.5 GB merges
unreliably. Workarounds to try tomorrow morning :

1. Pre-download VODs with `--no-part` to avoid `.temp.mp4` rename
   contention.
2. Try `-f 301` (HLS muxed format) explicitly per game — bypasses the
   merge step entirely.
3. Split the VOD into chunks via `--download-sections` for ONLY the
   game's [offset, offset+game_duration] range — typically 30-50 min,
   ~1 GB, no merge needed. Trades simplicity for less re-use across
   the game's 30-50 kills.
4. Run `reclip_from_kc_replay.py` under WSL2 / Linux container where
   ffmpeg merge is more reliable, mount D:/kckills_worker as a volume.

For tonight, the reclip pipeline is INSTALLED but NOT VALIDATED. The
fix for the actual offset miscalibration (the root cause of the QC
BAD verdicts) is still pending the smoke test landing.

## 5. Reclip eligible BAD kills

Once steps 2 + 3 + 4 are done, `reclip_from_kc_replay.py` becomes the
main tool. Eligibility recomputes on every invocation, so the script
auto-discovers the freshly-calibrated games.

```
# Dry-run first to see what's eligible :
.venv/Scripts/python.exe reclip_from_kc_replay.py --dry-run

# Smoke test on one game :
.venv/Scripts/python.exe reclip_from_kc_replay.py --game <ext_id> --limit 5

# Full pass when smoke succeeds :
.venv/Scripts/python.exe reclip_from_kc_replay.py
```

Expected scale (post-step-2 final QC analysis) :
* ~50-60 immediately re-clippable BAD kills (aligned games)
* +~70 more after step 3's vof2 calibration on the 6 promoted games
* Total : ~120-130 BAD kills recoverable

Each game requires a full VOD pre-download (~10-15 min for 1080p H.264
KC Replay casts at 3-4 GB) BEFORE the per-kill ffmpeg extracts (~5 s
each from the local cache). Plan : ~3-4 hours total for the full
reclip pass, distinct from the QC pass cost.

## 6. Re-QC the re-clipped kills

The reclip script sets `kill_visible = NULL` and `needs_reclip = FALSE`
on every successfully re-clipped row. Re-running the global QC over
JUST these (filter by `kill_visible IS NULL`) will validate the new
clips.

Quick filter for the qc_global selection :
```python
# In qc_global.py fetch_published_kills(), add :
"kill_visible": "is.null",
```
... then run `qc_global.py --resume --limit 200`. Expect dramatically
better GOOD/ACCEPTABLE rates than the legacy LEC-source pass.

## 7. Investigate remaining BAD-stuck kills

After steps 1-6, the residual BAD kills (~120 in our 304-clip QC
sample) have NO KC Replay coverage. These are :
* Pre-LFL-pivot games (LFL coverage with no Kameto cast)
* KCB / KCBS games (deferred per user directive)
* Older LEC games that Kameto didn't re-stream

Options for these (user decision) :
a. Leave them on the feed with the legacy LEC clip (current state)
b. Hide them from the feed (mark `status = 'manual_review'`)
c. Find alternate sources (Eto live, other replay channels — out of
   scope for the Kameto-only pivot)

The QC results JSON has the full per-kill verdict + reason — a future
batch can sort these by `clip_quality DESC` and surface the top-N for
manual triage.

---

## File reference

| Script | Purpose |
|--------|---------|
| `qc_global.py` | Gemini deep QC on every published clip |
| `analyze_qc_results.py` | Verdict / quality / eligibility breakdown |
| `reclip_from_kc_replay.py` | Re-clip needs_reclip kills from KC Replay |
| `promote_misaligned.py` | Flip vod_youtube_id to alt_vod for games where they differ |
| `retry_empty_harvest.py` | Reset kills_extracted on games where harvester found 0 kills |

## Critical commits

| Commit | What |
|--------|------|
| ec226dc | Wave 27.27 — qc_global.py (smoke) |
| f2dcbc0 | Wave 27.28 — parallel QC + reclip + VOD pre-download |
| 8e311e0 | Wave 27.29 — promote_misaligned |
| eded704 | clipper VOD timeout 600→1800s |
| 7d2003e | clipper prefer H.264 over AV1 |
| 6414242 | Wave 27.29 — retry_empty_harvest |
| **c8713ff** | **Wave 27.30 — FIX harvester FK regression (REQUIRES DAEMON RESTART)** |
