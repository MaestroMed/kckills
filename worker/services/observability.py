"""
OBSERVABILITY — Per-module run accounting against pipeline_runs.

Provides @run_logged() — a decorator wrapping a module's async run() so
each invocation produces ONE row in the pipeline_runs table :

    started_at      → INSERT row, status='running'
    on success      → UPDATE status='succeeded', items_*, duration_ms
    on exception    → UPDATE status='failed', error_summary

Plus :
    note(...)              call from inside the wrapped function to
                           accumulate items_scanned / items_processed
                           etc. before the decorator writes them out.
    record_metric(...)     in-memory counter (per module, per name)
                           flushed every 60s into pipeline_runs.metadata
                           on the next module run.

DESIGN RULES
============
1. EVERY observability call is wrapped in try/except. If Supabase is
   down / the row insert fails / the contextvar isn't set — the
   decorator still runs the wrapped function to completion. Workers
   MUST NOT die because the dashboard is broken.

2. No psycopg2. Talks to PostgREST via httpx.Client (already a worker
   dep — see services/supabase_client.py).

3. Console-safe. Workers run on Windows with cp1252 stdout.
   No emoji ; markers like [OK] / [WARN] / [ERROR] only.

4. Worker_id format : `orchestrator-{role}-PID{pid}`.
   Role is taken from --role argv or the KCKILLS_WORKER_ROLE env var
   set by orchestrator.py when it spawns children. Falls back to 'solo'.
"""

from __future__ import annotations

import asyncio
import functools
import os
import sys
import time
from contextvars import ContextVar
from datetime import datetime, timezone
from threading import Lock
from typing import Any, Callable, Optional

import structlog

log = structlog.get_logger()


# ─── Context — the currently-active run id, per asyncio task ──────────
# A ContextVar is the right primitive : it isolates concurrent runs in
# different asyncio tasks (e.g. the orchestrator runs ~6 modules in
# parallel inside one process). Each task sees its own row id when it
# calls observability.note(...).
_current_run_id: ContextVar[Optional[str]] = ContextVar(
    "kckills_current_run_id", default=None
)
_current_module: ContextVar[Optional[str]] = ContextVar(
    "kckills_current_module", default=None
)

# Per-task counters accumulated by note() before the decorator flushes.
_run_counters: ContextVar[Optional[dict]] = ContextVar(
    "kckills_run_counters", default=None
)


# ─── Worker identity ──────────────────────────────────────────────────
def _detect_role() -> str:
    """Return the orchestrator role for this process.

    Resolution order :
        1. KCKILLS_WORKER_ROLE env var (set by orchestrator children)
        2. --role argv flag
        3. 'solo' (fallback for ad-hoc scripts / main.py)
    """
    role = os.environ.get("KCKILLS_WORKER_ROLE")
    if role:
        return role
    try:
        argv = sys.argv
        if "--role" in argv:
            i = argv.index("--role")
            if i + 1 < len(argv):
                return argv[i + 1]
    except Exception:
        pass
    return "solo"


def worker_id() -> str:
    """Worker_id used in pipeline_runs.worker_id and pipeline_jobs.locked_by."""
    return f"orchestrator-{_detect_role()}-PID{os.getpid()}"


# ─── In-memory metric counters (flushed every 60s) ────────────────────
class _MetricBuffer:
    """Tiny per-process aggregator. NOT shared across processes — each
    role has its own buffer, which is fine for the dashboard's use case.

    Keys: (module_name, metric_name, frozenset(tag_items)) → float
    """

    __slots__ = ("_lock", "_data", "_last_flush_at")

    def __init__(self) -> None:
        self._lock = Lock()
        self._data: dict[tuple, float] = {}
        self._last_flush_at: float = time.monotonic()

    def add(self, module: str, name: str, value: float, tags: dict | None) -> None:
        key = (module, name, frozenset((tags or {}).items()))
        with self._lock:
            self._data[key] = self._data.get(key, 0.0) + float(value)

    def flush_for_module(self, module: str) -> dict[str, Any]:
        """Return + reset the metric snapshot for one module.

        Output shape :
            {
              "metrics": {
                "<name>": <total_value>,
                "<name>:tag=val": <total_value>,
                ...
              }
            }
        """
        out: dict[str, float] = {}
        with self._lock:
            for (mod, name, tag_set), value in list(self._data.items()):
                if mod != module:
                    continue
                key = name
                if tag_set:
                    tag_str = ",".join(f"{k}={v}" for k, v in sorted(tag_set))
                    key = f"{name}[{tag_str}]"
                out[key] = round(value, 4)
                # Reset by removing the bucket — next add() recreates it.
                del self._data[(mod, name, tag_set)]
            self._last_flush_at = time.monotonic()
        return {"metrics": out} if out else {}


_metrics = _MetricBuffer()


def record_metric(
    module_name: str,
    metric_name: str,
    value: float,
    tags: dict | None = None,
) -> None:
    """Bump an in-memory counter that will be flushed on the next module
    run into pipeline_runs.metadata.

    Safe to call from anywhere ; never raises.
    """
    try:
        _metrics.add(module_name, metric_name, value, tags)
    except Exception as e:
        log.warn("observability_metric_failed", error=str(e)[:120])


# ─── note() — accumulator called from inside wrapped functions ────────
def note(
    items_scanned: int = 0,
    items_processed: int = 0,
    items_failed: int = 0,
    items_skipped: int = 0,
    **extra: Any,
) -> None:
    """Accumulate items_* counters for the current run.

    Called from inside a @run_logged-wrapped function :

        async def run():
            ...
            observability.note(items_scanned=42, items_processed=39)

    Multiple calls accumulate. If the wrapped function ALSO returns a
    dict, the dict values OVERRIDE these accumulators (return wins).

    Safe outside a wrapped run — silently no-ops.
    """
    try:
        bag = _run_counters.get()
        if bag is None:
            return
        bag["items_scanned"] = bag.get("items_scanned", 0) + int(items_scanned or 0)
        bag["items_processed"] = bag.get("items_processed", 0) + int(items_processed or 0)
        bag["items_failed"] = bag.get("items_failed", 0) + int(items_failed or 0)
        bag["items_skipped"] = bag.get("items_skipped", 0) + int(items_skipped or 0)
        if extra:
            md = bag.setdefault("metadata", {})
            for k, v in extra.items():
                md[k] = v
    except Exception as e:
        log.warn("observability_note_failed", error=str(e)[:120])


# ─── DB helpers — silent-fail wrappers around supabase_client ─────────
def _try_insert_run(module_name: str) -> Optional[str]:
    """INSERT a fresh pipeline_runs row, return its id, or None on failure."""
    try:
        from services.supabase_client import safe_insert
        row = safe_insert(
            "pipeline_runs",
            {
                "module_name": module_name,
                "worker_id": worker_id(),
                "started_at": datetime.now(timezone.utc).isoformat(),
                "status": "running",
            },
        )
        if row and row.get("id"):
            return row["id"]
    except Exception as e:
        log.warn(
            "observability_insert_run_failed",
            module=module_name,
            error=str(e)[:160],
        )
    return None


def _try_update_run(
    run_id: str,
    *,
    status: str,
    counters: dict,
    error_summary: Optional[str] = None,
    extra_metadata: Optional[dict] = None,
) -> None:
    """UPDATE the pipeline_runs row with the final accounting."""
    try:
        from services.supabase_client import safe_update

        metadata = dict(counters.get("metadata") or {})
        if extra_metadata:
            metadata.update(extra_metadata)

        patch: dict[str, Any] = {
            "status": status,
            "ended_at": datetime.now(timezone.utc).isoformat(),
            "items_scanned": int(counters.get("items_scanned", 0) or 0),
            "items_processed": int(counters.get("items_processed", 0) or 0),
            "items_failed": int(counters.get("items_failed", 0) or 0),
            "items_skipped": int(counters.get("items_skipped", 0) or 0),
        }
        if error_summary is not None:
            patch["error_summary"] = error_summary[:500]
        if metadata:
            patch["metadata"] = metadata

        safe_update("pipeline_runs", patch, "id", run_id)
    except Exception as e:
        log.warn(
            "observability_update_run_failed",
            run_id=run_id[:8] if run_id else "?",
            error=str(e)[:160],
        )


# ─── Counter resolution — merge return value into accumulator ─────────
def _merge_return(counters: dict, return_value: Any) -> dict:
    """If the wrapped function returned a dict, treat its keys as
    overrides on the accumulator (return wins).

    If it returned an int (legacy run() -> int signature), assume that's
    items_processed and DON'T touch the other counters — note() may have
    already filled them in.
    """
    if isinstance(return_value, dict):
        for key in (
            "items_scanned",
            "items_processed",
            "items_failed",
            "items_skipped",
        ):
            if key in return_value:
                try:
                    counters[key] = int(return_value[key])
                except (TypeError, ValueError):
                    pass
        # Anything else from the dict goes into metadata
        meta = counters.setdefault("metadata", {})
        for k, v in return_value.items():
            if k.startswith("items_") or k in ("status", "error_summary"):
                continue
            try:
                # Keep the metadata JSON small — only scalars / short lists.
                if isinstance(v, (int, float, bool, str)):
                    meta[k] = v
                elif isinstance(v, (list, tuple)) and len(v) < 20:
                    meta[k] = list(v)[:20]
            except Exception:
                pass
    elif isinstance(return_value, int):
        # Legacy convention : run() -> int returns the count of items
        # processed. Only override if note() didn't already set it.
        if counters.get("items_processed", 0) == 0:
            counters["items_processed"] = int(return_value)
    # None / other types → keep whatever note() / defaults wrote.
    return counters


# ─── @run_logged — the decorator ──────────────────────────────────────
def run_logged(module_name: str | None = None) -> Callable:
    """Decorate an async run() so each invocation logs to pipeline_runs.

    Usage :

        from services.observability import run_logged

        @run_logged()
        async def run() -> int:
            ...

    Or with explicit module_name :

        @run_logged(module_name="clipper")
        async def run() -> int:
            ...

    Auto-detects module_name from the wrapped function's __module__
    when not provided (e.g. 'modules.clipper' → 'clipper').
    """

    def decorator(func: Callable) -> Callable:
        # Resolve the module name once at decoration time.
        resolved_name = module_name
        if not resolved_name:
            mod = getattr(func, "__module__", "") or ""
            # 'modules.clipper' → 'clipper'  ; 'sentinel' stays 'sentinel'
            resolved_name = mod.rsplit(".", 1)[-1] if "." in mod else mod
        if not resolved_name:
            resolved_name = "unknown"

        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            # 1. Open a fresh counter bag and INSERT the row. If insert
            #    fails (Supabase down), we still set the contextvar so
            #    note()/record_metric() don't blow up — they just won't
            #    be persisted this cycle.
            counters: dict = {
                "items_scanned": 0,
                "items_processed": 0,
                "items_failed": 0,
                "items_skipped": 0,
                "metadata": {},
            }
            run_id = _try_insert_run(resolved_name)

            tok_id = _current_run_id.set(run_id)
            tok_mod = _current_module.set(resolved_name)
            tok_bag = _run_counters.set(counters)

            t0 = time.monotonic()
            error_summary: Optional[str] = None
            status = "succeeded"
            return_value: Any = None

            try:
                return_value = await func(*args, **kwargs)
                _merge_return(counters, return_value)
            except asyncio.CancelledError:
                # Clean shutdown — don't mark as failed.
                status = "cancelled"
                raise
            except Exception as e:
                status = "failed"
                error_summary = f"{type(e).__name__}: {e}"
                # Don't swallow — re-raise after the finally block so
                # the supervised_task wrapper sees the crash and can
                # log + restart as usual.
                raise
            finally:
                _run_counters.reset(tok_bag)
                _current_module.reset(tok_mod)
                _current_run_id.reset(tok_id)

                # Drain the metric buffer for this module into metadata.
                try:
                    extra = _metrics.flush_for_module(resolved_name)
                except Exception:
                    extra = {}

                duration_ms = int((time.monotonic() - t0) * 1000)
                extra.setdefault("metrics", {})
                # Keep a duration echo even if v_pipeline_health derives
                # it — handy for ad-hoc queries on individual rows.
                meta_with_duration = dict(extra)
                meta_with_duration["duration_ms"] = duration_ms

                if run_id:
                    _try_update_run(
                        run_id,
                        status=status,
                        counters=counters,
                        error_summary=error_summary,
                        extra_metadata=meta_with_duration,
                    )
                # If run_id was None (insert failed), still log so we
                # have at least a stdout trail.
                if status == "failed":
                    log.warn(
                        "[WARN] pipeline_run_failed",
                        module=resolved_name,
                        duration_ms=duration_ms,
                        error=(error_summary or "")[:160],
                    )

            return return_value

        # Expose the resolved module name for introspection.
        wrapper.__observability_module__ = resolved_name  # type: ignore[attr-defined]
        return wrapper

    return decorator


# ─── Public re-exports ────────────────────────────────────────────────
__all__ = [
    "run_logged",
    "note",
    "record_metric",
    "worker_id",
]
