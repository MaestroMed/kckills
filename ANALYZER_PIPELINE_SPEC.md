# ANALYZER PIPELINE OVERLAP SPEC — Download N+1 || Analyze N

**Date** : 2026-04-23
**Status** : Designed (not yet implemented). Reference for PR10.

---

## 1. Architecture

```
                    safe_select(status='clipped')
                              |
                              v
                   +-----------------------+
                   |   asyncio.Queue(8)    |  <-- backpressure cap
                   |   bounded buffer       |
                   +-----------------------+
                          ^         |
                          |         |
       N download workers |         | single Gemini consumer
       (4-6 concurrent)   |         | (serialised via scheduler)
                          |         v
       +--------------+   |   +------------------------+
       | _download_   |---+   | analyze_kill_row       |
       | clip_async   |       |   -> validate_desc     |
       | (R2 GET)     |       |   -> safe_update DB    |
       | ~7s avg      |       |   -> tick_qc           |
       +--------------+       |   -> os.remove(clip)   |
                              | ~5s call + 4s rate     |
                              +------------------------+

                         SHUTDOWN:
   producers finish -> push N sentinels -> consumer drains -> return
```

Producers and consumer share one `asyncio.Queue` of size ~8. The queue acts as backpressure: if Gemini stalls, downloaders block on `queue.put()` instead of filling disk. The Gemini consumer remains single-threaded — `scheduler.wait_for("gemini")` already serialises but a single coroutine is clearer for ordering and quota accounting.

## 2. Code Skeleton

```python
import asyncio

QUEUE_MAX = 8
DOWNLOAD_WORKERS = 5
SENTINEL = None

async def _download_clip_async(kill: dict) -> tuple[dict, str | None]:
    """Run blocking httpx.stream in a thread, return (kill, path_or_None)."""
    clip_url = kill.get("clip_url_vertical") or kill.get("clip_url_horizontal")
    if not clip_url:
        return kill, None
    clip_path = os.path.join(config.CLIPS_DIR, f"qc_{kill['id'][:8]}.mp4")
    try:
        await asyncio.to_thread(_blocking_download, clip_url, clip_path)
        return kill, clip_path
    except Exception as e:
        log.warn("analyzer_clip_download_failed",
                 kill_id=kill["id"][:8], error=str(e)[:60])
        return kill, None

async def _download_worker(in_q: asyncio.Queue, out_q: asyncio.Queue):
    while True:
        kill = await in_q.get()
        if kill is SENTINEL:
            in_q.task_done()
            break
        kill, path = await _download_clip_async(kill)
        await out_q.put((kill, path))
        in_q.task_done()

async def _gemini_consumer(out_q: asyncio.Queue, n_producers: int) -> tuple[int, int]:
    analysed, rejected, sentinels_seen = 0, 0, 0
    while sentinels_seen < n_producers:
        item = await out_q.get()
        if item is SENTINEL:
            sentinels_seen += 1
            out_q.task_done()
            continue
        kill, clip_path = item
        try:
            remaining = scheduler.get_remaining("gemini")
            if remaining is not None and remaining <= 0:
                log.warn("analyzer_daily_quota_reached")
                _cleanup(clip_path)
                out_q.task_done()
                continue
            result = await analyze_kill_row(kill, clip_path=clip_path)
            _cleanup(clip_path)
            if not result:
                continue
            ok, reason = validate_description(result.get("description_fr"))
            if not ok:
                _bump_retry(kill, reason); rejected += 1; continue
            _commit_success(kill, result); analysed += 1
        finally:
            out_q.task_done()
    return analysed, rejected

async def run() -> int:
    kills = safe_select("kills", "...", status="clipped")
    if not kills:
        return 0
    in_q  = asyncio.Queue(maxsize=QUEUE_MAX)
    out_q = asyncio.Queue(maxsize=QUEUE_MAX)

    producers = [asyncio.create_task(_download_worker(in_q, out_q))
                 for _ in range(DOWNLOAD_WORKERS)]
    consumer  = asyncio.create_task(_gemini_consumer(out_q, DOWNLOAD_WORKERS))

    for k in kills:
        await in_q.put(k)
    for _ in range(DOWNLOAD_WORKERS):
        await in_q.put(SENTINEL)

    await asyncio.gather(*producers)
    for _ in range(DOWNLOAD_WORKERS):
        await out_q.put(SENTINEL)
    analysed, rejected = await consumer
    log.info("analyzer_scan_done", analysed=analysed, rejected=rejected)
    return analysed
```

## 3. Edge Cases

1. **Download fails** — `_download_clip_async` returns `(kill, None)`. Still enqueue: `analyze_kill` already supports text-only mode (path-less). Logged at WARN, no retry bump.
2. **Gemini rate-limited / 429** — `analyze_kill` returns `None`, loop `continue`s. Row stays in `clipped`, retried next scan. Downloads keep flowing into `out_q` and block on the bound when Gemini stalls.
3. **Daily quota hit mid-batch** — consumer checks `scheduler.get_remaining("gemini")` per item. On exhaustion drains remaining queue items (deleting downloaded clips, no DB write).
4. **Daemon crash mid-batch** — Already idempotent: `clipped` rows that didn't get `safe_update` simply re-enter the next scan. Add a startup sweep `glob("qc_*.mp4")` older than 1h to GC.
5. **Memory / disk pressure** — `Queue(maxsize=8)` caps in-flight clips. With 8 × 100 MB = 800 MB peak, well under D:/ headroom.
6. **Consumer ordering** — Items are processed in completion order. Acceptable: each row is independent.
7. **scheduler.wait_for("r2")** — `_blocking_download` should still call the R2 scheduler so we don't trample the 0.5s delay across 5 concurrent workers.

## 4. Throughput Estimate

Constants: 4s Gemini delay floor + 5s Gemini call + 7s avg download.

- **Today (serial)** : 7 + max(5, 4) = 12s/clip → **5 clips/min**.
- **Pipelined** : consumer cadence = max(7/5, 9) = 9s/clip → **6.6 clips/min**.
- **Speedup : ~1.3-2.0x** depending on download variance. The Gemini floor (5s call + 4s wait) is the new bottleneck — exactly the goal.

## 5. Migration Plan

- **Phase 0 (flag)** : Add `config.ANALYZER_PIPELINED: bool = False`. Wrap new `run()` in `if config.ANALYZER_PIPELINED: return await _run_pipelined()` else legacy serial path.
- **Phase 1 (canary)** : Set the flag `True` in dev for one daemon iteration. Verify: queue depth metrics, no orphaned `qc_*.mp4` files, `analysed + rejected == len(kills)`.
- **Phase 2 (A/B)** : Run pipelined for 24h alongside serial metrics. Compare `clips/min`, `gemini_quota_consumed_per_hour`, rejection rate.
- **Phase 3 (commit)** : Flip default to `True`. Remove flag + serial path after one week stability.
- **Rollback** : flip env var. No DB / R2 / scheduler changes.
