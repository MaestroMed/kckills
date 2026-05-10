# Wave 27.27 → 27.30 — recovery runbook

Last updated : 2026-05-10 evening.

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
