"""Coherence lock between orchestrator ROLE_MODULES and main.DAEMON_MODULES.

Audit 2026-07-02 — this is the SECOND time the two lists drifted apart,
and the failure mode is brutal because it is silent :

* a module present in DAEMON_MODULES but in no role never runs in
  orchestrator mode (= production). That's how embedder /
  quote_extractor / translator / achievement_evaluator /
  discord_autopost / admin_job_runner / queue_health / dlq_drainer sat
  dead for weeks — the entire recommendation engine was built but
  starved of embeddings.
* a module referenced by a role but missing from DAEMON_MODULES is
  dropped by the intersection filter in orchestrator._module_specs_for_role
  (only a warning log). That's how kill_of_the_week + push_notifier
  never ran.

These tests make any future drift a hard CI failure instead.
"""

from __future__ import annotations

import os
import sys
from itertools import chain

# Add worker root to sys.path before importing (standard test pattern).
_WORKER_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _WORKER_ROOT)

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "test-service-key")

from main import DAEMON_MODULES  # noqa: E402
from orchestrator import ROLE_MODULES  # noqa: E402


def _daemon_names() -> set[str]:
    return {name for (name, _interval, _dotted) in DAEMON_MODULES}


def _role_names() -> set[str]:
    return set(chain.from_iterable(ROLE_MODULES.values()))


def test_every_daemon_module_is_assigned_to_a_role():
    """A DAEMON_MODULES entry with no role NEVER runs in production."""
    unassigned = _daemon_names() - _role_names()
    assert not unassigned, (
        f"Modules in DAEMON_MODULES but in no orchestrator role — they "
        f"will never run in orchestrator mode (= prod): {sorted(unassigned)}. "
        f"Add them to a role in orchestrator.ROLE_MODULES."
    )


def test_every_role_module_exists_in_daemon_modules():
    """A role entry absent from DAEMON_MODULES is silently dropped."""
    phantom = _role_names() - _daemon_names()
    assert not phantom, (
        f"Modules referenced by ROLE_MODULES but absent from "
        f"main.DAEMON_MODULES — the intersection filter drops them "
        f"silently: {sorted(phantom)}. Add them to DAEMON_MODULES."
    )


def test_no_module_is_assigned_to_two_roles():
    """Two processes running the same daemon = duplicated side effects."""
    seen: dict[str, str] = {}
    dupes: list[str] = []
    for role, names in ROLE_MODULES.items():
        for n in names:
            if n in seen:
                dupes.append(f"{n} ({seen[n]} + {role})")
            seen[n] = role
    assert not dupes, f"Modules assigned to multiple roles: {dupes}"


def test_daemon_module_import_paths_resolve():
    """Every dotted path must at least be importable as a module file."""
    for name, _interval, dotted in DAEMON_MODULES:
        rel = dotted.replace(".", os.sep) + ".py"
        path = os.path.join(_WORKER_ROOT, rel)
        assert os.path.exists(path), (
            f"DAEMON_MODULES entry '{name}' points at '{dotted}' but "
            f"{rel} does not exist"
        )
