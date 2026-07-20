// Shared harness for the cross-repository installed-artifact integration suite
// (audit §P2-01). Big-brother of scripts/install-update-ux-smoke.mjs: every
// artifact is exercised from a PACKED tarball inside a fully isolated HOME and
// XDG_STATE_HOME, and no fixture secret is ever allowed to leak into output.
//
// This module is deliberately dependency-free (node builtins only) so the suite
// runs against a bare `node` with nothing installed but the packed tarballs.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const SECRET = 'p201-fixture-secret-should-not-leak';

// ponytail: one timeout ceiling for every child. install/pack are the slow ones;
// bump per-call via opts.timeout if a step legitimately needs longer.
const DEFAULT_TIMEOUT_MS = 180_000;

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    input: options.input,
    encoding: 'utf8',
    timeout: options.timeout ?? DEFAULT_TIMEOUT_MS,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    signal: result.signal ?? null,
    error: result.error,
  };
}

export function combined(result) {
  return `${result.stdout}\n${result.stderr}`;
}

export function redacted(value) {
  return String(value).replaceAll(SECRET, '[REDACTED]');
}

export function assertNoSecret(label, result) {
  assert.doesNotMatch(combined(result), new RegExp(SECRET), `${label} leaked fixture content`);
}

export function assertSuccess(label, result) {
  assert.equal(
    result.status,
    0,
    `${label} failed (status=${result.status} signal=${result.signal}): ${redacted(combined(result).slice(-1_500))}`,
  );
  assertNoSecret(label, result);
}

// Isolated sandbox: never touches the operator's real ~ or the 300MB shared
// observability.db. HOME, XDG_STATE_HOME, PI_AGENT_DIR and the tmux socket dir
// all live under one throwaway tree.
export function makeSandbox(prefix = 'xtrm-p201-') {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  const home = path.join(root, 'home');
  const project = path.join(root, 'project');
  const installPrefix = path.join(root, 'install');
  const state = path.join(home, '.local', 'state');
  const piAgentDir = path.join(home, '.pi', 'agent');
  const tmuxTmp = path.join(root, 'tmux');
  for (const d of [home, project, installPrefix, state, piAgentDir, tmuxTmp]) {
    mkdirSync(d, { recursive: true });
  }
  const env = {
    ...process.env,
    HOME: home,
    XDG_STATE_HOME: state,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_DATA_HOME: path.join(home, '.local', 'share'),
    PI_AGENT_DIR: piAgentDir,
    TMUX_TMPDIR: tmuxTmp,
    XTRM_SMOKE_SECRET: SECRET,
  };
  // Never inherit the parent's live tmux/session identity into the sandbox.
  // (Deleting, not setting to undefined — undefined stringifies to "undefined".)
  delete env.TMUX;
  delete env.TMUX_PANE;
  return {
    root,
    home,
    project,
    installPrefix,
    state,
    piAgentDir,
    tmuxTmp,
    env,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

// Minimal step reporter so each suite prints a uniform PASS/FAIL/SKIP ledger the
// orchestrator can scrape from CI logs.
export function reporter(suiteName) {
  const steps = [];
  return {
    ok(step, detail = '') {
      steps.push({ step, outcome: 'PASS', detail });
      console.log(`  [PASS] ${step}${detail ? ` — ${detail}` : ''}`);
    },
    skip(step, reason) {
      steps.push({ step, outcome: 'SKIP', detail: reason });
      console.log(`  [SKIP] ${step} — ${reason}`);
    },
    blocked(step, blocker) {
      steps.push({ step, outcome: 'BLOCKED', detail: blocker });
      console.log(`  [BLOCKED] ${step} — ${blocker}`);
    },
    summary() {
      const by = (o) => steps.filter((s) => s.outcome === o).length;
      const line = `${suiteName}: ${by('PASS')} PASS, ${by('SKIP')} SKIP, ${by('BLOCKED')} BLOCKED`;
      console.log(line);
      return { suiteName, steps, pass: by('PASS'), skip: by('SKIP'), blocked: by('BLOCKED') };
    },
  };
}
