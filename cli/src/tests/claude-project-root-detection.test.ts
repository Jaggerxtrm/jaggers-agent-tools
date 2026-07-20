import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// xtrm-9635h: xt claude {install,status,reload,doctor} must resolve the
// current project via resolveMainProjectRoot(cwd), NOT findRepoRoot() —
// findRepoRoot returns the xtrm-tools source-bundle root (~/dev/core when
// the installed CLI is reachable from there), which caused every subcommand
// to target the wrong .claude/settings.json.

vi.mock('../core/claude-runtime-sync.js', () => ({
  runClaudeRuntimeSyncPhase: vi.fn(async () => undefined),
}));

vi.mock('../utils/confirmation.js', () => ({
  confirmDestructiveAction: vi.fn(async () => true),
}));

import { createClaudeCommand } from '../commands/claude.js';
import { runClaudeRuntimeSyncPhase } from '../core/claude-runtime-sync.js';

let tmpProject = '';
let previousCwd = '';

beforeEach(() => {
  previousCwd = process.cwd();
  tmpProject = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xtrm-9635h-')));
  execSync('git init -q -b main', { cwd: tmpProject, stdio: 'pipe' });
  execSync('git config user.email test@test', { cwd: tmpProject, stdio: 'pipe' });
  execSync('git config user.name test', { cwd: tmpProject, stdio: 'pipe' });
  process.chdir(tmpProject);
});

afterEach(() => {
  process.chdir(previousCwd);
  fs.removeSync(tmpProject);
  vi.clearAllMocks();
});

describe('xt claude project-root detection (xtrm-9635h)', () => {
  it('xt claude install passes cwd project root to runClaudeRuntimeSyncPhase, not the source bundle', async () => {
    const cmd = createClaudeCommand();
    await cmd.parseAsync(['install', '--yes'], { from: 'user' });

    expect(runClaudeRuntimeSyncPhase).toHaveBeenCalledTimes(1);
    const { repoRoot } = (runClaudeRuntimeSyncPhase as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(repoRoot).toBe(tmpProject);
  });

  it('xt claude install --dry-run also targets the cwd project root', async () => {
    const cmd = createClaudeCommand();
    await cmd.parseAsync(['install', '--dry-run'], { from: 'user' });

    const { repoRoot } = (runClaudeRuntimeSyncPhase as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(repoRoot).toBe(tmpProject);
  });
});
