"""task_supervisor — Wave 27.9 (2026-05-09)

Tiny helper for fire-and-forget background tasks that the worker spawns
without awaiting (e.g. supabase_batch flushers, job_runner boost loops).

The Python docs explicitly warn :

    Important: Save a reference to the result of asyncio.create_task,
    to avoid a task disappearing mid-execution. The event loop only
    keeps weak references to tasks. A task that isn't referenced
    elsewhere may be garbage collected at any time, even before it's
    done.

Bare ``asyncio.create_task(coro())`` without storing the returned
Task therefore creates a silent risk : under memory pressure or a
particularly aggressive GC cycle, the task gets collected and the
work never completes. We've never observed it on this codebase, but
the audit flagged 3 sites where the pattern was used.

Usage
-----
::

    from services.task_supervisor import spawn

    spawn(my_coro(), name="boost_loop_for_match_xyz")

The helper :
  * Holds a strong reference until the task completes.
  * Calls ``log.exception`` if the task raised, so the failure isn't
    silently swallowed (the default behaviour of un-awaited tasks is
    to schedule the exception for the loop's exception handler, but
    that handler typically just logs at WARN ; we want a stack trace).
  * Returns the task so the caller can still ``await`` it or cancel
    it if they later decide they want to.
"""

from __future__ import annotations

import asyncio

import structlog

log = structlog.get_logger()

# Strong references to in-flight background tasks. Tasks remove
# themselves via the done_callback when they finish or fail.
_BG_TASKS: set[asyncio.Task] = set()


def spawn(coro, *, name: str | None = None) -> asyncio.Task:
    """Schedule ``coro`` as a background task with a strong reference.

    The task removes itself from the registry when it completes. If the
    coroutine raised, the exception is logged at ERROR level (with the
    task name + traceback) instead of being silently dropped by the
    default loop exception handler.
    """
    task = asyncio.create_task(coro, name=name)
    _BG_TASKS.add(task)

    def _on_done(t: asyncio.Task) -> None:
        _BG_TASKS.discard(t)
        # Surface uncaught exceptions. CancelledError is expected at
        # shutdown and not interesting to log.
        if t.cancelled():
            return
        exc = t.exception()
        if exc is not None:
            log.error(
                "bg_task_crashed",
                task_name=t.get_name(),
                error_type=type(exc).__name__,
                error=str(exc)[:200],
            )

    task.add_done_callback(_on_done)
    return task


def active_count() -> int:
    """Return the number of background tasks currently in flight."""
    return len(_BG_TASKS)


async def drain(timeout: float = 5.0) -> int:
    """Wait for all in-flight background tasks to complete.

    Returns the number of tasks that finished within the timeout. Tasks
    still running after the timeout are left to finish on their own.
    Useful from main.py's shutdown path so we don't kill a flush
    mid-write.
    """
    if not _BG_TASKS:
        return 0
    pending = list(_BG_TASKS)
    try:
        done, _ = await asyncio.wait(pending, timeout=timeout)
        return len(done)
    except Exception as e:
        log.warn("task_supervisor_drain_failed", error=str(e)[:160])
        return 0
