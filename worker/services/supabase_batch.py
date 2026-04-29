"""
BatchedSupabaseWriter — async write-batching layer over PostgREST.

Drop-in replacement for safe_update / safe_insert in HOT paths only
(clipper, og_generator, event_mapper, analyzer fanout). Buckets writes
in-memory and flushes them as a single PATCH/POST per (table, shape)
group, cutting HTTP RTT by 10-50x on cycles that produce hundreds of
rows.

Design rules:
  * INSERTS bucket by `table` -> single POST with JSON-array body.
  * UPDATES bucket by (table, frozenset(data.keys())). Same-shape rows
    collapse to a single PATCH with `id=in.(uuid1,uuid2,...)`. Different
    shapes go through a parallel httpx.AsyncClient pool (concurrency 10).
  * On 4xx / 5xx for a batched call, fall back to per-row retry so one
    bad row never poisons the batch.
  * On terminal failure (network down, 5xx after retry), spill to the
    same SQLite local_cache the sync layer uses, so flush_cache() drains
    them later. Nothing is silently dropped.
  * Prefer: return=minimal on every PATCH/POST — no row payloads come
    back, saves bandwidth on 200-row flushes.
  * Background flusher fires every FLUSH_INTERVAL_SEC OR when any single
    table's buffer reaches FLUSH_SIZE_THRESHOLD.
  * Graceful shutdown via writer.stop() / await writer.flush_now().

NOT for: anything that needs the inserted/updated row back (auth,
comments-with-id, ratings). Those keep using the sync safe_insert path.
"""

from __future__ import annotations

import asyncio
import time
from collections import defaultdict
from typing import Any

import httpx
import structlog

from config import config
from local_cache import cache

log = structlog.get_logger()

# ─── Tunables ────────────────────────────────────────────────────────

FLUSH_INTERVAL_SEC = 2.0          # background flusher cadence
FLUSH_SIZE_THRESHOLD = 50         # flush a table early once its buffer hits this
MAX_CONCURRENT_HTTP = 15          # connection pool size to Supabase
PER_REQUEST_TIMEOUT = 30.0
PER_ROW_RETRY_TIMEOUT = 15.0
BATCH_RETRY_BACKOFF_SEC = 0.5     # tiny pause before per-row fallback


# ─── Internal types ──────────────────────────────────────────────────

class _PendingUpdate:
    """One queued update. Slim to keep memory low at scale."""
    __slots__ = ("table", "data", "match_col", "match_val", "shape")

    def __init__(self, table: str, data: dict, match_col: str, match_val: str):
        self.table = table
        self.data = data
        self.match_col = match_col
        self.match_val = match_val
        # frozenset of keys is the bucket key for "same-shape" collapse.
        self.shape = frozenset(data.keys())


class _PendingInsert:
    __slots__ = ("table", "data")

    def __init__(self, table: str, data: dict):
        self.table = table
        self.data = data


# ─── Main writer ─────────────────────────────────────────────────────

class BatchedSupabaseWriter:
    """Buffer-then-flush PostgREST writer.

    Thread-safety: single asyncio loop only. Use one global instance per
    worker process (the module-level _writer below).
    """

    def __init__(
        self,
        url: str | None = None,
        service_key: str | None = None,
        flush_interval: float = FLUSH_INTERVAL_SEC,
        flush_threshold: int = FLUSH_SIZE_THRESHOLD,
        max_concurrent: int = MAX_CONCURRENT_HTTP,
    ):
        self._url = (url or config.SUPABASE_URL or "").rstrip("/") + "/rest/v1"
        self._key = service_key or config.SUPABASE_SERVICE_KEY
        self._enabled = bool(self._url.startswith("http") and self._key)

        # Common headers. Each request overrides Prefer to return=minimal.
        self._headers = {
            "apikey": self._key,
            "Authorization": f"Bearer {self._key}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        }

        # Buffers, guarded by a single asyncio Lock.
        self._lock = asyncio.Lock()
        self._update_buf: list[_PendingUpdate] = []
        self._insert_buf: list[_PendingInsert] = []

        self._flush_interval = flush_interval
        self._flush_threshold = flush_threshold

        # Lazy-built — needs a running loop.
        self._client: httpx.AsyncClient | None = None
        self._sem = asyncio.Semaphore(max_concurrent)

        self._bg_task: asyncio.Task | None = None
        self._stopping = False

        # Observability.
        self._stats = {
            "queued_updates": 0,
            "queued_inserts": 0,
            "flushes": 0,
            "rows_written": 0,
            "rows_failed": 0,
            "rows_spilled_to_cache": 0,
        }

    # ─── Lifecycle ────────────────────────────────────────────────────

    def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            limits = httpx.Limits(
                max_connections=MAX_CONCURRENT_HTTP,
                max_keepalive_connections=MAX_CONCURRENT_HTTP,
            )
            self._client = httpx.AsyncClient(
                headers=self._headers,
                timeout=PER_REQUEST_TIMEOUT,
                limits=limits,
            )
        return self._client

    async def start_background_flusher(self) -> None:
        """Launch the periodic flusher. Idempotent."""
        if self._bg_task is not None and not self._bg_task.done():
            return
        self._stopping = False
        self._bg_task = asyncio.create_task(
            self._bg_loop(), name="supabase_batch_flusher"
        )
        log.info("supabase_batch_started", interval=self._flush_interval, threshold=self._flush_threshold)

    async def stop(self) -> None:
        """Stop the background flusher AND drain pending writes.

        Call this from your shutdown handler before exiting the daemon.
        """
        self._stopping = True
        await self.flush_now()
        if self._bg_task is not None:
            self._bg_task.cancel()
            try:
                await self._bg_task
            except (asyncio.CancelledError, Exception):
                pass
            self._bg_task = None
        if self._client is not None:
            try:
                await self._client.aclose()
            except Exception:
                pass
            self._client = None
        log.info("supabase_batch_stopped", **self._stats)

    async def _bg_loop(self) -> None:
        while not self._stopping:
            try:
                await asyncio.sleep(self._flush_interval)
                await self.flush_now()
            except asyncio.CancelledError:
                break
            except Exception as e:
                log.warn("batch_bg_loop_error", error=str(e)[:200])

    # ─── Public queue API ─────────────────────────────────────────────

    async def queue_update(
        self, table: str, data: dict, match_col: str, match_val: str
    ) -> None:
        if not self._enabled:
            cache.buffer_write(
                table, "update", {**data, "_match": {match_col: match_val}}
            )
            return
        data = {k: v for k, v in data.items() if not k.startswith("_")}
        if not data:
            return
        size_after = 0
        async with self._lock:
            self._update_buf.append(_PendingUpdate(table, data, match_col, match_val))
            self._stats["queued_updates"] += 1
            size_after = sum(
                1 for p in self._update_buf if p.table == table
            )
        if size_after >= self._flush_threshold:
            asyncio.create_task(self.flush_now())

    async def queue_insert(self, table: str, data: dict) -> None:
        if not self._enabled:
            cache.buffer_write(table, "insert", data)
            return
        data = {k: v for k, v in data.items() if not k.startswith("_")}
        if not data:
            return
        size_after = 0
        async with self._lock:
            self._insert_buf.append(_PendingInsert(table, data))
            self._stats["queued_inserts"] += 1
            size_after = sum(1 for p in self._insert_buf if p.table == table)
        if size_after >= self._flush_threshold:
            asyncio.create_task(self.flush_now())

    # ─── Flush ────────────────────────────────────────────────────────

    async def flush_now(self) -> None:
        """Drain all buffers in one pass."""
        async with self._lock:
            updates, self._update_buf = self._update_buf, []
            inserts, self._insert_buf = self._insert_buf, []

        if not updates and not inserts:
            return

        ins_by_table: dict[str, list[dict]] = defaultdict(list)
        for p in inserts:
            ins_by_table[p.table].append(p.data)

        upd_by_bucket: dict[tuple[str, frozenset], list[_PendingUpdate]] = defaultdict(list)
        for p in updates:
            upd_by_bucket[(p.table, p.shape)].append(p)

        # Wave 13f: TaskGroup with best-effort semantics — a flush failure
        # for table A must not cancel the in-flight flush for table B (each
        # table is an independent unit of work and the per-flush methods
        # already swallow exceptions internally + spill to local cache). We
        # catch the ExceptionGroup and log so any unexpected propagation is
        # at least visible without breaking the writer's drain semantics.
        if ins_by_table or upd_by_bucket:
            try:
                async with asyncio.TaskGroup() as tg:
                    for table, rows in ins_by_table.items():
                        tg.create_task(self._flush_inserts(table, rows))
                    for (table, _shape), rows in upd_by_bucket.items():
                        tg.create_task(self._flush_updates(table, rows))
            except* Exception as eg:
                for err in eg.exceptions:
                    log.warn("batch_flush_task_unexpected_error",
                             error=str(err)[:200])
        self._stats["flushes"] += 1

    # ─── Insert flush ─────────────────────────────────────────────────

    async def _flush_inserts(self, table: str, rows: list[dict]) -> None:
        if not rows:
            return
        t0 = time.monotonic()
        ok = 0
        fail = 0
        client = self._get_client()
        url = f"{self._url}/{table}"
        try:
            async with self._sem:
                r = await client.post(url, json=rows)
            if 200 <= r.status_code < 300:
                ok = len(rows)
            else:
                log.warn(
                    "batch_insert_batch_failed_falling_back",
                    table=table, status=r.status_code,
                    body=r.text[:200], rows=len(rows),
                )
                ok, fail = await self._per_row_insert(table, rows)
        except Exception as e:
            log.warn("batch_insert_threw_falling_back",
                     table=table, error=str(e)[:200], rows=len(rows))
            ok, fail = await self._per_row_insert(table, rows)

        self._stats["rows_written"] += ok
        self._stats["rows_failed"] += fail
        ms = int((time.monotonic() - t0) * 1000)
        log.info(
            "batch_flush",
            table=table, op="insert",
            batched=len(rows), successful=ok, failed=fail, ms=ms,
        )

    async def _per_row_insert(
        self, table: str, rows: list[dict]
    ) -> tuple[int, int]:
        client = self._get_client()
        url = f"{self._url}/{table}"
        ok = 0
        fail = 0

        async def _one(row: dict) -> bool:
            try:
                async with self._sem:
                    r = await client.post(
                        url, json=row, timeout=PER_ROW_RETRY_TIMEOUT,
                    )
                if 200 <= r.status_code < 300:
                    return True
                cache.buffer_write(table, "insert", row)
                self._stats["rows_spilled_to_cache"] += 1
                log.warn("batch_insert_row_failed_spilled",
                         table=table, status=r.status_code, body=r.text[:160])
                return False
            except Exception as e:
                cache.buffer_write(table, "insert", row)
                self._stats["rows_spilled_to_cache"] += 1
                log.warn("batch_insert_row_threw_spilled",
                         table=table, error=str(e)[:160])
                return False

        await asyncio.sleep(BATCH_RETRY_BACKOFF_SEC)
        # Wave 13f: NOT migrated to TaskGroup — _one() catches all exceptions
        # internally and returns bool, so gather/TaskGroup behave identically.
        # Migrating would add EG-handling boilerplate for an unreachable branch.
        results = await asyncio.gather(*[_one(r) for r in rows], return_exceptions=False)
        for r in results:
            if r:
                ok += 1
            else:
                fail += 1
        return ok, fail

    # ─── Update flush ─────────────────────────────────────────────────

    async def _flush_updates(
        self, table: str, rows: list[_PendingUpdate]
    ) -> None:
        if not rows:
            return
        t0 = time.monotonic()
        ok = 0
        fail = 0

        by_match_col: dict[str, list[_PendingUpdate]] = defaultdict(list)
        for p in rows:
            by_match_col[p.match_col].append(p)

        for match_col, group in by_match_col.items():
            if self._all_same_data(group):
                got_ok, got_fail = await self._patch_in_clause(
                    table, match_col, group,
                )
            else:
                got_ok, got_fail = await self._patch_per_row_pool(
                    table, group,
                )
            ok += got_ok
            fail += got_fail

        self._stats["rows_written"] += ok
        self._stats["rows_failed"] += fail
        ms = int((time.monotonic() - t0) * 1000)
        log.info(
            "batch_flush",
            table=table, op="update",
            batched=len(rows), successful=ok, failed=fail, ms=ms,
        )

    @staticmethod
    def _all_same_data(group: list[_PendingUpdate]) -> bool:
        if len(group) <= 1:
            return True
        first = group[0].data
        first_sig = sorted(first.items(), key=lambda kv: kv[0])
        for p in group[1:]:
            if sorted(p.data.items(), key=lambda kv: kv[0]) != first_sig:
                return False
        return True

    async def _patch_in_clause(
        self, table: str, match_col: str, group: list[_PendingUpdate]
    ) -> tuple[int, int]:
        """One PATCH for many rows. Used when ALL rows share the same
        data dict (e.g. status flips: {"status": "published"} for 50 ids)."""
        client = self._get_client()
        vals = ",".join(f'"{p.match_val}"' for p in group)
        params = {match_col: f"in.({vals})"}
        url = f"{self._url}/{table}"
        body = group[0].data
        try:
            async with self._sem:
                r = await client.patch(url, json=body, params=params)
            if 200 <= r.status_code < 300:
                return len(group), 0
            log.warn(
                "batch_update_in_clause_failed_falling_back",
                table=table, status=r.status_code,
                body=r.text[:200], rows=len(group),
            )
            return await self._patch_per_row_pool(table, group)
        except Exception as e:
            log.warn("batch_update_in_clause_threw_falling_back",
                     table=table, error=str(e)[:200], rows=len(group))
            return await self._patch_per_row_pool(table, group)

    async def _patch_per_row_pool(
        self, table: str, group: list[_PendingUpdate]
    ) -> tuple[int, int]:
        """Fall back to N parallel PATCHes through the connection pool."""
        client = self._get_client()
        url = f"{self._url}/{table}"

        async def _one(p: _PendingUpdate) -> bool:
            params = {p.match_col: f"eq.{p.match_val}"}
            try:
                async with self._sem:
                    r = await client.patch(
                        url, json=p.data, params=params,
                        timeout=PER_ROW_RETRY_TIMEOUT,
                    )
                if 200 <= r.status_code < 300:
                    return True
                cache.buffer_write(
                    table, "update",
                    {**p.data, "_match": {p.match_col: p.match_val}},
                )
                self._stats["rows_spilled_to_cache"] += 1
                log.warn("batch_update_row_failed_spilled",
                         table=table, status=r.status_code, body=r.text[:160])
                return False
            except Exception as e:
                cache.buffer_write(
                    table, "update",
                    {**p.data, "_match": {p.match_col: p.match_val}},
                )
                self._stats["rows_spilled_to_cache"] += 1
                log.warn("batch_update_row_threw_spilled",
                         table=table, error=str(e)[:160])
                return False

        await asyncio.sleep(BATCH_RETRY_BACKOFF_SEC)
        # Wave 13f: NOT migrated to TaskGroup — _one() catches all exceptions
        # internally and returns bool, so gather/TaskGroup behave identically.
        # Migrating would add EG-handling boilerplate for an unreachable branch.
        results = await asyncio.gather(*[_one(p) for p in group], return_exceptions=False)
        ok = sum(1 for r in results if r)
        fail = len(results) - ok
        return ok, fail

    # ─── Diagnostics ──────────────────────────────────────────────────

    def stats(self) -> dict[str, Any]:
        return dict(self._stats)


# ─── Module-level singleton + backward-compat shims ──────────────────

_writer: BatchedSupabaseWriter | None = None


def get_writer() -> BatchedSupabaseWriter:
    """Return (and lazily create) the process-wide writer instance."""
    global _writer
    if _writer is None:
        _writer = BatchedSupabaseWriter()
    return _writer


async def batched_safe_update(
    table: str, data: dict, match_col: str, match_val: str
) -> bool:
    """Drop-in replacement for safe_update (async)."""
    await get_writer().queue_update(table, data, match_col, match_val)
    return True


async def batched_safe_insert(table: str, data: dict) -> None:
    """Drop-in replacement for safe_insert (async, returns None)."""
    await get_writer().queue_insert(table, data)
    return None


async def shutdown_writer() -> None:
    """Hook for the daemon's graceful-shutdown handler.

    Drains all buffered writes and closes the AsyncClient.
    """
    global _writer
    if _writer is not None:
        await _writer.stop()
        _writer = None
