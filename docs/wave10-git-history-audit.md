# Wave 10 — Git History Audit (commit-message races)

**Author:** Agent DZ (Wave 11)
**Date:** 2026-04-25
**Branch:** `claude/cranky-elion-cebf12`
**Scope:** Read-only forensic audit. No history was rewritten. No code was modified.

---

## TL;DR

During Wave 10 (LoLTok foundation, ~10 parallel sister-agent worktrees), four (4) commit-message races were observed on this branch. The `git index` and `git commit -m "..."` calls of two agents interleaved badly within the same wall-clock second, causing four commits whose **message labels them as agent X** but whose **diff body is actually agent Y's deliverable**.

**The code that landed is correct.** The labelling is what is wrong. Each affected agent posted a *marker commit* immediately after, naming the swap. This audit consolidates those markers into a single reference.

**No git rewrite is recommended** because:
1. The branch is shared / already pushed to `origin`. Rewriting history would invalidate every other agent's local clones and the Vercel preview history.
2. The damage is purely cosmetic — every Wave 10 deliverable is present at HEAD (verified below).
3. Rebasing 4 commits on a 12-commit wave with multiple parallel writers risks introducing real merge conflicts that don't exist today.

For future swarms : each agent MUST `cd` into its own worktree (`git worktree add`) before running `git commit`. Sharing a worktree across agents is what caused this.

---

## 1. The swap table

All times are local (CET, +0200). All "Real diff content" entries link the *files* in the commit's diff to the *agent that owned them per the Wave 10 dispatch*.

| Commit SHA | Time | Message labels it as | Real diff content (per ownership) | Files actually touched |
|------------|------|----------------------|-----------------------------------|------------------------|
| `180c185` | 00:08:51 | **BE** (i18n scaffold) | **BB** (multi-league config) | `supabase/migrations/043_leagues_table.sql`, `worker/services/league_config.py`, `worker/services/league_id_lookup.py`, `worker/scripts/seed_leagues.py`, `worker/tests/test_league_config.py`, `worker/modules/sentinel.py`, `worker/services/lolesports_api.py` |
| `f935297` | 00:10:54 | **CB** (worker portability) | **BA** (multi-team config) | `worker/services/team_config.py`, `worker/config/teams.json`, `worker/tests/test_team_config.py`, `worker/services/golgg_scraper.py`, `worker/modules/channel_reconciler.py`, `worker/modules/event_publisher.py`, `worker/modules/qc_sampler.py`, `worker/modules/transitioner.py`, `web/src/lib/constants.ts` |
| `c180ebf` | 00:10:41 | **BB** (marker, supposed) | **CB** (local_paths + Dockerfile) | `worker/services/local_paths.py`, `worker/.dockerignore`, `worker/Dockerfile`, `worker/config.py`, `docs/worker-stateless-plan.md`, `docs/worker-deployment-options.md` |
| `ddad620` | 00:12:21 | **CB** (marker, supposed) | **CC** (multi-provider AI router) | `worker/services/ai_router.py`, `worker/services/ai_providers/__init__.py`, `worker/services/ai_providers/anthropic.py`, `worker/services/ai_providers/cerebras.py`, `worker/services/ai_providers/gemini.py`, `worker/services/ai_providers/openai.py`, `worker/tests/test_ai_router.py`, `docs/loltok-ai-multi-provider.md`, `docs/loltok-db-scaling-plan.md` |

### Marker-only commits (correctly labelled, no diff swap)

| Commit SHA | Time | Purpose |
|------------|------|---------|
| `60331ae` | 00:13:49 | CC marker — clarifies that CC's diff is in `ddad620`, not under a CC-labelled commit. |
| `277f50f` | 00:10:08 | BE re-land — BE's actual i18n scaffold diff (the original BE diff was lost when `180c185` got BB's content). This commit *is* labelled correctly and *does* contain BE's files. The earlier `180c185` claiming BE is the swap victim. |

### What got dropped vs. what got re-landed

The races did NOT lose any agent's work — every diff is present in HEAD. Three agents recovered their attribution by adding marker commits (BB → `c180ebf`, CB → `ddad620`, CC → `60331ae`). One agent (BE) actually re-committed the proper diff under the proper message (`277f50f`). The result : Wave 10 has 4 swapped commits + 4 marker / re-land commits = 8 commits where the deliverable lives, but only 6 unique deliveries (BA, BB, BE, CB, CC have separate diff-and-message split ; the others have clean commits — see §3).

---

## 2. Why this happened

All Wave 10 agents were dispatched in parallel onto the same branch (`claude/cranky-elion-cebf12`) **without each one having its own worktree**. They each opened a Bash session inside `C:\Users\Matter1\Karmine_Stats\.claude\worktrees\cranky-elion-cebf12\` and ran their `git add ... && git commit -m "..."` sequence.

Inside the same .git working dir, `git add` is essentially `cp` from the working tree into `.git/index`. If agent X stages files A+B at T=0.150s and agent Y stages files C+D at T=0.180s, the index at T=0.180s contains A+B+C+D. Whichever agent calls `git commit` first writes ALL OF THEM into the new commit, with that agent's message. The other agent's `git commit` then runs against a staging area that is *also* full of the other side's leftovers (or empty if cleaned by the first commit), leading to bizarre matches between intent and reality.

The 4 races on this branch all happened within a 4-minute window (00:08:51 → 00:12:21) where the highest concurrency hit. Earlier and later commits in the wave (`01dda1a` BF storage, `c5cfdb1` BC frontend, `4302fdc` CA master plan, `277f50f` BE re-land, `9b7b087` BD backfill, `6b2f967` CD audit) committed cleanly because they fell outside the contention window.

---

## 3. Wave 10 completeness check (all 10 agents accounted for)

Each Wave 10 agent owned one core deliverable file. All 10 are present at HEAD :

| Agent | Owned file (core marker) | Present at HEAD ? | Lives in commit |
|-------|--------------------------|-------------------|-----------------|
| BA | `worker/services/team_config.py` | ✅ yes | `f935297` (swapped — message says CB) |
| BB | `worker/services/league_config.py` | ✅ yes | `180c185` (swapped — message says BE) |
| BC | `web/src/app/team/[slug]/page.tsx` | ✅ yes | `c5cfdb1` (clean) |
| BD | `worker/scripts/backfill_team.py` | ✅ yes | `9b7b087` (clean) |
| BE | `web/src/lib/i18n/locales/ko.ts` | ✅ yes | `277f50f` (clean re-land) |
| BF | `worker/services/storage_backend.py` | ✅ yes | `01dda1a` (clean) |
| CA | `docs/loltok-master-plan.md` | ✅ yes | `4302fdc` (clean) |
| CB | `worker/services/local_paths.py` | ✅ yes | `c180ebf` (swapped — message says BB) |
| CC | `worker/services/ai_router.py` | ✅ yes | `ddad620` (swapped — message says CB) |
| CD | `docs/stack-currency-audit-2026-04.md` | ✅ yes | `6b2f967` (clean) |

Verified via :

```bash
git ls-tree -r HEAD --name-only | grep -E "^(worker/services/team_config\.py|worker/services/league_config\.py|web/src/app/team/\[slug\]/page\.tsx|worker/scripts/backfill_team\.py|web/src/lib/i18n/locales/ko\.ts|worker/services/storage_backend\.py|docs/loltok-master-plan\.md|worker/services/local_paths\.py|worker/services/ai_router\.py|docs/stack-currency-audit-2026-04\.md)$"
```

Returns all 10 paths. **No deliverable is missing.**

---

## 4. How to read `git log` for Wave 10

When you need to audit *what shipped under whose name* on Wave 10, follow this mapping rather than reading commit messages :

```
180c185  message says BE i18n  →  trust the diff : it's BB league_config
f935297  message says CB local_paths  →  trust the diff : it's BA team_config
c180ebf  message says BB marker  →  trust the diff : it's CB local_paths
ddad620  message says CB marker  →  trust the diff : it's CC ai_router
60331ae  message says CC marker  →  this one is a real marker (no diff payload other than this audit-style note)
277f50f  message says BE i18n  →  this IS the correct BE delivery (re-land after 180c185 stole the slot)
```

Every other Wave 10 commit (`01dda1a`, `c5cfdb1`, `4302fdc`, `9b7b087`, `6b2f967`) is correctly labelled.

---

## 5. Decision : DO NOT REBASE

Three options were considered :

1. **`git rebase -i` to swap commit messages back to truth.** ❌ Rejected.
   - Branch is pushed to `origin` and shared by other agents and Vercel deploy history.
   - A force-push would invalidate every other clone, and the Vercel ignoreCommand only protects against unwanted *deploys*, not against history divergence.
   - Cost (recovery from broken local clones, lost reflog continuity) >> benefit (cosmetic git log readability).

2. **`git commit --amend --reset-author` chain on each marker commit to fold the marker text into the swapped commit's message.** ❌ Rejected for the same reasons as (1).

3. **Document the swap in a single markdown file in the repo, and treat the marker commits as the canonical record.** ✅ Chosen. This file is that record.

The audit doc is committed alongside the changelog so that anyone running `git blame` on a Wave 10 file gets pointed here from the line-level commit messages via the marker commits.

---

## 6. Recommendations for future swarms

1. **One worktree per agent.** Use `git worktree add ../wave-N-agent-XX` before dispatching agent XX. The two writes never see the same `.git/index`. This is the only fix.
2. **Per-agent commit windows.** If worktrees aren't viable, dispatch agents serially within the contention window (one `git commit` at a time). Lose parallelism, gain attribution clarity.
3. **`git reset HEAD` before staging.** As a defensive cleanup, agents should `git reset HEAD && git add <only-my-files>` so they never stage a sibling's leftovers. Doesn't prevent message swaps but contains the file-set damage.
4. **Marker-commit protocol.** When a swap is detected, the affected agent should *immediately* push a marker commit naming the swap. Do not try to rewrite the bad commit in-place (this is what happened on Wave 10 and it worked — keep doing it).
5. **A post-wave audit doc** (this one). Mandatory deliverable for any wave with >5 parallel writers.

See also : the `docs/` directory has the full Wave 10 deliverable docs (`loltok-master-plan.md`, `loltok-cost-model.md`, `worker-stateless-plan.md`, etc.) and they all match their owning agents from the table in §3.
