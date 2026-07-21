// Regression tests for xtrm-bjbdf: pre-push semgrep must never move the
// invoking worktree's HEAD.
//
// Root cause: git exports GIT_DIR into the hook environment. semgrep's
// --baseline-commit materializes the baseline in a throwaway `git worktree` and
// runs `git checkout <base>` inside it; with GIT_DIR inherited that checkout
// retargets the INVOKING worktree, detaching HEAD at the baseline and unwinding
// the commit being pushed into unstaged changes.
//
// semgrep itself is stubbed so these tests are hermetic and offline. The stub is
// proven faithful by `stub reproduces the failure`, which runs it with GIT_DIR
// set and asserts the exact damage from the bug report.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

const SCRIPT = new URL("../semgrep-diff.sh", import.meta.url).pathname;

// Emulates semgrep's baseline handling: temp `git worktree add --no-checkout`,
// `git checkout <base>` from inside it, then `git worktree remove` + rmtree.
// Every git call inherits the caller's environment, as semgrep's do.
const FAITHFUL_STUB = `#!/usr/bin/env bash
base=""
for a in "$@"; do case "$a" in --baseline-commit=*) base="\${a#*=}";; esac; done
[ -n "$base" ] || exit 0
here=$(pwd)
tmp=$(mktemp -d)
git worktree add --no-checkout "$tmp" "$base" >/dev/null 2>&1
cd "$tmp" && git checkout "$base" >/dev/null 2>&1
cd "$here"
git worktree remove "$tmp" >/dev/null 2>&1 || true
rm -rf "$tmp"
exit 0
`;

// Moves HEAD the way the bug does — detached at the baseline with the index
// following, working tree left alone — but unconditionally, ignoring the
// environment. Stands in for any future scanner variant that damages HEAD
// some other way, and exercises the guard rather than the env strip.
const HOSTILE_STUB = `#!/usr/bin/env bash
base=""
for a in "$@"; do case "$a" in --baseline-commit=*) base="\${a#*=}";; esac; done
[ -n "$base" ] || exit 0
git update-ref --no-deref HEAD "$base"
git read-tree "$base"
exit 0
`;

function git(cwd, ...args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
  }).trim();
}

/** Repo shaped like an xt session: linked worktree, a commit to push, untracked files. */
function makeFixture(stub) {
  const root = mkdtempSync(join(tmpdir(), "semgrep-diff-"));
  const main = join(root, "main-repo");
  const wt = join(root, "wt");
  const bin = join(root, "bin");

  mkdirSync(main);
  git(main, "init", "-q", "-b", "main");
  git(main, "config", "user.email", "t@t.t");
  git(main, "config", "user.name", "t");
  writeFileSync(join(main, "a.py"), "print('a')\n");
  git(main, "add", "-A");
  git(main, "commit", "-qm", "base");
  git(main, "worktree", "add", "-q", wt, "-b", "feat");

  // The commit being pushed must MODIFY a tracked file: semgrep only
  // materializes the baseline when a changed file has a baseline version.
  writeFileSync(join(wt, "a.py"), "print('a')\nprint('modified')\n");
  git(wt, "add", "-A");
  git(wt, "commit", "-qm", "feat");

  // The untracked file this repo always carries (.specialists/user/*). It makes
  // semgrep pick the worktree strategy over its `git reset --hard` fast path.
  mkdirSync(join(wt, ".specialists", "user"), { recursive: true });
  writeFileSync(join(wt, ".specialists", "user", "x.specialist.json"), "{}\n");

  mkdirSync(bin);
  writeFileSync(join(bin, "semgrep"), stub, { mode: 0o755 });

  return { root, wt, bin, head: git(wt, "rev-parse", "HEAD") };
}

/** Runs a command in the worktree with the git env a pre-push hook inherits. */
function runInHookEnv(fx, file, args) {
  const res = execFileSync(file, args, {
    cwd: fx.wt,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${fx.bin}:${process.env.PATH}`,
      GIT_DIR: git(fx.wt, "rev-parse", "--absolute-git-dir"),
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
    },
    stdio: "pipe",
  });
  return res;
}

test("stub reproduces the failure: bare semgrep + inherited GIT_DIR detaches the worktree", () => {
  const fx = makeFixture(FAITHFUL_STUB);
  try {
    const base = git(fx.wt, "merge-base", "HEAD", "main");
    runInHookEnv(fx, join(fx.bin, "semgrep"), ["scan", `--baseline-commit=${base}`]);

    assert.equal(git(fx.wt, "rev-parse", "--abbrev-ref", "HEAD"), "HEAD", "expected detached HEAD");
    assert.equal(git(fx.wt, "rev-parse", "HEAD"), base, "expected HEAD at the baseline commit");
    assert.match(git(fx.wt, "status", "--short"), /^ ?M a\.py$/m, "expected the commit unwound");
    assert.match(git(fx.wt, "worktree", "list"), /prunable/, "expected a leaked temp worktree");
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("semgrep-diff.sh strips the inherited git env, so the worktree survives", () => {
  const fx = makeFixture(FAITHFUL_STUB);
  try {
    runInHookEnv(fx, SCRIPT, []);

    assert.equal(git(fx.wt, "rev-parse", "--abbrev-ref", "HEAD"), "feat");
    assert.equal(git(fx.wt, "rev-parse", "HEAD"), fx.head);
    assert.equal(git(fx.wt, "status", "--short"), "?? .specialists/");
    assert.doesNotMatch(git(fx.wt, "worktree", "list"), /prunable/);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("semgrep-diff.sh restores HEAD and aborts when the scanner moves it anyway", () => {
  const fx = makeFixture(HOSTILE_STUB);
  try {
    assert.throws(
      () => runInHookEnv(fx, SCRIPT, []),
      (err) => {
        assert.equal(err.status, 1, "expected the push to be aborted");
        assert.match(err.stderr, /moved HEAD/);
        return true;
      },
    );

    assert.equal(git(fx.wt, "rev-parse", "--abbrev-ref", "HEAD"), "feat");
    assert.equal(git(fx.wt, "rev-parse", "HEAD"), fx.head);
    assert.equal(git(fx.wt, "status", "--short"), "?? .specialists/");
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});
