# Quality Control modules — when + how to use

Two QC modules ship with the worker. **Neither is wired into the
default daemon loop** because each Gemini call costs ~1 RPD and the
backlog is too big to QC every clip automatically. Use them surgically.

## qc.py — Pre-clip VOD offset calibration

**What** : reads the in-game timer from a probe clip via Gemini, then
returns a corrected offset for the *whole game* (not per-kill).

**When to run** : new game ingested, you suspect the VOD offset is
wrong (clips show analyst desk instead of gameplay).

**How** :
```python
from modules.qc import calibrate_game_offset
result = await calibrate_game_offset(
    youtube_id="XXX", initial_offset=0, expected_first_kill_at=120,
)
# result.suggested_offset -> save to games.vod_offset_seconds
```

**Cost** : 1-3 Gemini calls per game (1 if first probe lands on
gameplay, 2-3 if it scans forward through analyst desk).

## clip_qc.py — Post-clip drift verification + auto re-clip

**What** : after a clip is produced, reads the in-game timer at the
clip's mid-point. If the timer doesn't match the expected
`game_time_seconds`, computes drift + re-clips with corrected offset.
Up to 3 retries.

**When to run** :
  - When a NEW game is first being clipped — calibrate the entire
    game's offset off the first kill, then accept the rest.
  - On a kill flagged by user feedback as "wrong moment".
  - NEVER on the daemon's bulk loop — would burn 500-1000 Gemini
    calls per pass.

**How** :
```python
from modules.clip_qc import clip_with_qc_loop
from modules.clipper import clip_kill
result = await clip_with_qc_loop(
    clip_func=clip_kill,
    clip_kwargs={
        "kill_id": "...", "youtube_id": "XXX",
        "vod_offset_seconds": 0,
        "game_time_seconds": 1234,
    },
    game_time_seconds=1234,
    game_id="...",
)
```

**Cost** : 1 Gemini call per QC attempt × max 3 retries = up to
3 calls per clip. With 1000 RPD quota and 340 clips, naive auto-wire
would exhaust quota in 1 day. Use `--limit` flags or the admin
backoffice "QC this clip" button (TODO).

## Roadmap

When the catalog stabilises (Kameto pivot done, ~12k clips backfilled),
introduce a sampling QC strategy :
  1. New game arrives → calibrate offset on first kill via clip_qc
  2. Apply the corrected offset to all subsequent kills of that game
  3. QC sampling : 1 in 50 clips runs through clip_qc to catch drift
  4. Flagged clips (drift > 30s) go to /admin/clips for manual review

That gets us auto-correction at ~2% Gemini overhead instead of 100%.
