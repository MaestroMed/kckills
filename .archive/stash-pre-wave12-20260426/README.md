# Stash archive — pre Wave 12 merge

**Created** : 2026-04-26 by Claude during the Wave-12-merge / Wave-11-DA-rescue session.

## What's here

Two git stashes that existed on the local `main` worktree BEFORE the
big Wave 12 merge into main were exported as patch files instead of
being lost or applied blindly :

### `stash1-tracked-modifications.patch`

3618 lines of in-progress modifications across 22+ worker files :
* `worker/modules/analyzer.py` — +788 lines
* `worker/modules/clipper.py` — +744 lines
* `worker/services/ffmpeg_ops.py` — +200 lines
* `worker/modules/hls_packager.py` — +198 lines
* `worker/modules/job_runner.py` — +173 lines
* `worker/modules/og_generator.py` — +148 lines
* `worker/modules/sentinel.py` — +143 lines
* `worker/services/supabase_client.py` — +117 lines
* `worker/config.py` — +92 lines
* … plus smaller deltas on local_cache.py, main.py, scheduler.py, etc.

The base commit was `46f2db8` (the pre-pull main HEAD on this machine,
which was ~30 commits behind origin/main at the time). After pulling
origin/main and merging Wave 12 + Wave 11 DA-rescue, applying this
patch directly would conflict heavily with the up-to-date code.

### `stash0-untracked-files.patch`

Empty (0 lines) — the round-2 stash captured untracked files that
were already covered by the `.quarantine-pre-wave12-20260426-...` dir
which has since been dropped after the file-by-file comparison
confirmed origin/main contained the more polished versions everywhere
(the LocalPaths refactor in PR-loltok DH supersedes the inline
`_data_root()` helpers in the local copies).

## How to use

If the user discovers later that some of the WIP modifications in
`stash1-tracked-modifications.patch` contained unique work not yet
shipped to main :

```bash
# Inspect what's in the patch
less .archive/stash-pre-wave12-20260426/stash1-tracked-modifications.patch

# Pull out a single file's modifications
filterdiff -i 'worker/modules/analyzer.py' \
    .archive/stash-pre-wave12-20260426/stash1-tracked-modifications.patch \
    > /tmp/analyzer-wip.patch

# Manual merge (3-way) — apply rejects go to .rej files
git apply --3way /tmp/analyzer-wip.patch
```

The path-aware reconciliation should be done file-by-file because
the base differs by ~30 commits.

## Why we didn't apply directly

The user was actively gaming when the merge work happened, which
ruled out the time-consuming file-by-file 3-way merge with manual
conflict resolution. The patch is preserved here as a recovery
escape hatch ; meanwhile the Wave 12 + DA-rescue merges shipped
the production version.
