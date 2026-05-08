# worker/scripts/_archive/ — Retired scripts

Scripts moved here are no longer expected to be run. They sit in
git history for reproducibility (point-in-time data fixes that
could matter for forensic analysis) but the operator workflow does
not invoke them.

**Lifecycle policy** : keep one cycle (~6 months) here ; if no
operator has resurrected a script in that window, delete it
permanently. Re-running an archived script is fine if you understand
the data state it expects — just run from this path :

```powershell
.venv\Scripts\python.exe worker\scripts\_archive\<name>.py
```

## Why each one was retired

| Script | Retired | Replacement |
|---|---|---|
| `fix_qc_described_threshold.py` | 2026-05-08 (Wave 19.7 cleanup) | Logic absorbed into `auto_fix_loop.py::_fix_qc_described` running every 4 h. |
| `force_publish_stuck.py` | 2026-05-08 | Logic absorbed into `auto_fix_loop.py::_force_publish_stuck`. |
| `quarantine_offset_zero.py` | 2026-05-08 | Root cause fixed in `sentinel.py` (PR7-A) — new ingests already filter `vod_offset=0`. The one-shot historical fix completed before this archive. |
| `recompute_champion_class.py` | 2026-05-08 | Champion class is now derived from a static Riot map at insert-time in the analyser pipeline. No need to recompute server-side. |
| `recompute_fight_type.py` | 2026-05-08 | `fight_type` / `matchup_lane` / `lane_phase` are deterministically derived in the analyser post-Gemini step. Re-running the script no longer produces useful changes. |
| `regen_audit_targets.py` | 2026-05-08 | Targeted 45 specific audit clips identified once during the Opus 4.7 audit. The clips were regenerated ; no new use case. |
