#!/usr/bin/env bash
# Run semgrep against the diff between HEAD and origin/main.
# Used by pre-push hook so pre-existing debt doesn't block unrelated pushes.
# CI's full scan remains the source of truth for absolute findings.

set -euo pipefail

if ! command -v semgrep >/dev/null; then
    echo "semgrep not installed — skipping (CI covers it)"
    exit 0
fi

# Git exports GIT_DIR (and friends) into the hook environment. semgrep's
# --baseline-commit materializes the baseline in a throwaway `git worktree` and
# runs `git checkout` inside it — with GIT_DIR inherited, that checkout retargets
# the INVOKING worktree instead: HEAD detaches at the baseline and the commit
# being pushed unwinds into unstaged changes (xtrm-bjbdf). Drop the inherited
# vars so every git call resolves the repo from cwd. No-op when unset, and
# skipped if the repo isn't discoverable without them.
GIT_HOOK_ENV="GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_PREFIX GIT_QUARANTINE_PATH"
# shellcheck disable=SC2086
if (unset $GIT_HOOK_ENV; git rev-parse --show-toplevel >/dev/null 2>&1); then
    # shellcheck disable=SC2086
    unset $GIT_HOOK_ENV
fi

# Derive base ref dynamically. Order:
#   1. branch's tracked upstream ('@{u}') — most reliable
#   2. common default branches if their *remote* version exists (origin/*)
#   3. local default branches IF different from current branch
# We refuse to use the current branch as its own baseline because then
# merge-base resolves to HEAD and --baseline-commit=HEAD silently scans
# nothing on every push.
HEAD_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)
HEAD_SHA=$(git rev-parse HEAD)
HEAD_REF=$(git symbolic-ref --quiet HEAD 2>/dev/null || true)

upstream=$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)
BASE_REF=""
if [ -n "$upstream" ]; then
    BASE_REF="$upstream"
else
    for cand in origin/main origin/master main master; do
        git rev-parse --verify "$cand" >/dev/null 2>&1 || continue
        # Skip a local-branch candidate that IS the current branch
        [ "$cand" = "$HEAD_BRANCH" ] && continue
        BASE_REF="$cand"
        break
    done
fi

[ -n "$BASE_REF" ] && git fetch "${BASE_REF%%/*}" "${BASE_REF#*/}" --quiet 2>/dev/null || true

SEMGREP_BASELINE_ARGS=()
if [ -n "$BASE_REF" ]; then
    BASE=$(git merge-base HEAD "$BASE_REF" 2>/dev/null || true)
    # merge-base==HEAD here means branch is at upstream tip — legitimate empty
    # diff. Pass --baseline-commit so semgrep produces an empty result rather
    # than falling back to a full scan.
    [ -n "$BASE" ] && SEMGREP_BASELINE_ARGS=(--baseline-commit="$BASE")
fi
# Last-resort: no upstream resolved at all. rev-list can equal HEAD on single
# -commit histories; reject and full-scan in that case.
if [ ${#SEMGREP_BASELINE_ARGS[@]} -eq 0 ]; then
    BASE=$(git rev-list HEAD --max-count=50 | tail -1)
    if [ -n "$BASE" ] && [ "$BASE" != "$HEAD_SHA" ]; then
        SEMGREP_BASELINE_ARGS=(--baseline-commit="$BASE")
    else
        echo "[semgrep-diff] no usable baseline (no upstream, single-commit branch, or pushing default branch directly) — running full scan"
    fi
fi

rc=0
semgrep scan \
    --config=p/default \
    --config=p/security-audit \
    --config=p/secrets \
    --config=p/python \
    --config=p/dockerfile \
    --config=p/github-actions \
    "${SEMGREP_BASELINE_ARGS[@]}" \
    --error \
    --quiet \
    --skip-unknown-extensions || rc=$?

# A scan must never move the invoking worktree's HEAD. If it does anyway,
# reattach non-destructively (working tree is left alone, so genuine unstaged
# edits survive) and fail loudly instead of leaving a silently detached worktree.
HEAD_REF_AFTER=$(git symbolic-ref --quiet HEAD 2>/dev/null || true)
HEAD_SHA_AFTER=$(git rev-parse HEAD)
if [ "$HEAD_REF_AFTER" != "$HEAD_REF" ] || [ "$HEAD_SHA_AFTER" != "$HEAD_SHA" ]; then
    echo "[semgrep-diff] semgrep moved HEAD (${HEAD_REF:-detached}@${HEAD_SHA} -> ${HEAD_REF_AFTER:-detached}@${HEAD_SHA_AFTER}) — restoring" >&2
    if [ -n "$HEAD_REF" ]; then
        git symbolic-ref HEAD "$HEAD_REF"
    else
        git update-ref --no-deref HEAD "$HEAD_SHA"
    fi
    if [ "$HEAD_SHA_AFTER" != "$HEAD_SHA" ]; then
        git reset --quiet --mixed
    fi
    git worktree prune >/dev/null 2>&1 || true
    echo "[semgrep-diff] HEAD restored to ${HEAD_REF:-$HEAD_SHA}; working tree untouched. Aborting push." >&2
    exit 1
fi

exit $rc
