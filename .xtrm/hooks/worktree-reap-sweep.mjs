#!/usr/bin/env node
// Claude Code SessionStart hook — kick an out-of-band worktree reap for this repo.
//
// Worktrees accumulate because every removal mechanism is coupled to a happy path that
// does not run when a session is killed. This hook is the opportunistic half of the
// answer; the systemd timer (`xt worktree install-timer`) is the reliable half.
//
// The sweep is detached and never awaited: a full scan takes far longer than the hook
// timeout, and session start must not block on disk work. Exit 0 in all paths.

import { spawn } from 'node:child_process';
import { readFileSync, existsSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const MIN_INTERVAL_MS = 6 * 60 * 60 * 1000;

let input;
try {
  input = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  process.exit(0);
}

const cwd = input.cwd ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const stampPath = path.join(cwd, '.xtrm', '.last-reap-sweep');

// Rate limit: a session restart loop must not turn into a scan loop.
try {
  if (existsSync(stampPath) && Date.now() - statSync(stampPath).mtimeMs < MIN_INTERVAL_MS) {
    process.exit(0);
  }
} catch {
  // unreadable stamp — fall through and sweep
}

try {
  mkdirSync(path.dirname(stampPath), { recursive: true });
  writeFileSync(stampPath, new Date().toISOString(), 'utf8');
} catch {
  process.exit(0);
}

try {
  const child = spawn(
    'xt',
    ['worktree', 'reap', '--artifacts-older-than', '7d', '--worktrees-older-than', '14d', '--apply', '--yes'],
    { cwd, detached: true, stdio: 'ignore' },
  );
  child.unref();
} catch {
  // xt not on PATH in this environment — the timer still covers the host
}

process.exit(0);
