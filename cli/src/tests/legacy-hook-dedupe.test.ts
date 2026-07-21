import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { planLegacyHookDedupe } from '../core/legacy-hook-dedupe.js';

// xtrm-v1yck: the removal proof that replaced the provenance-marker predicate.
// Taxonomy under test: docs/legacy-hook-duplication.md — only
// `duplicate-of-global` is ever removed; drift, uncovered and foreign are kept.

let home = '';
let repoRoot = '';

function projectCommand(file: string): string {
  return `node "${path.join(repoRoot, '.xtrm', 'hooks', file)}"`;
}

function globalCommand(file: string): string {
  return `node "${path.join(home, '.xtrm', 'hooks', file)}"`;
}

/** Seed ~/.claude/settings.json with the given (event -> wrappers) registrations. */
function writeGlobalSettings(hooks: Record<string, unknown[]>): void {
  fs.outputJsonSync(path.join(home, '.claude', 'settings.json'), { hooks });
}

function writeHookFile(root: string, file: string, contents: string): void {
  fs.outputFileSync(path.join(root, '.xtrm', 'hooks', file), contents);
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'xtrm-dedupe-home-'));
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xtrm-dedupe-repo-'));
  fs.ensureDirSync(path.join(home, '.xtrm', 'hooks'));
  fs.ensureDirSync(path.join(repoRoot, '.xtrm', 'hooks'));
});

afterEach(() => {
  fs.removeSync(home);
  fs.removeSync(repoRoot);
});

describe('planLegacyHookDedupe', () => {
  it('removes a registration covered globally whose hook file is byte-identical', async () => {
    writeHookFile(repoRoot, 'gate.mjs', 'console.log(1)\n');
    writeHookFile(home, 'gate.mjs', 'console.log(1)\n');
    writeGlobalSettings({ Stop: [{ matcher: '', hooks: [{ type: 'command', command: globalCommand('gate.mjs') }] }] });

    const hooks = { Stop: [{ matcher: '', hooks: [{ type: 'command', command: projectCommand('gate.mjs') }] }] };
    const plan = await planLegacyHookDedupe(repoRoot, hooks, { home });

    expect(plan.skipped).toBeUndefined();
    expect(plan.planned).toHaveLength(1);
    expect(plan.planned[0].classification).toBe('duplicate-of-global');
    // Event dropped entirely once its only registration is removed.
    expect(plan.hooks.Stop).toBeUndefined();
  });

  it('preserves a hook whose project file drifted from the global copy', async () => {
    writeHookFile(repoRoot, 'gate.mjs', 'console.log("patched locally")\n');
    writeHookFile(home, 'gate.mjs', 'console.log(1)\n');
    writeGlobalSettings({ Stop: [{ matcher: '', hooks: [{ type: 'command', command: globalCommand('gate.mjs') }] }] });

    const hooks = { Stop: [{ matcher: '', hooks: [{ type: 'command', command: projectCommand('gate.mjs') }] }] };
    const plan = await planLegacyHookDedupe(repoRoot, hooks, { home });

    expect(plan.planned).toHaveLength(0);
    expect(plan.preserved[0].classification).toBe('xt-owned-drift');
    expect(plan.hooks).toEqual(hooks);
  });

  it('preserves a modified command line even when the file matches (not covered globally)', async () => {
    writeHookFile(repoRoot, 'gate.mjs', 'console.log(1)\n');
    writeHookFile(home, 'gate.mjs', 'console.log(1)\n');
    writeGlobalSettings({ Stop: [{ matcher: '', hooks: [{ type: 'command', command: globalCommand('gate.mjs') }] }] });

    const hooks = {
      Stop: [{ matcher: '', hooks: [{ type: 'command', command: `${projectCommand('gate.mjs')} --verbose` }] }],
    };
    const plan = await planLegacyHookDedupe(repoRoot, hooks, { home });

    expect(plan.planned).toHaveLength(0);
    expect(plan.preserved[0].classification).toBe('xt-owned-uncovered');
    expect(plan.hooks).toEqual(hooks);
  });

  it('preserves a hook referencing a file the global install does not have', async () => {
    writeHookFile(repoRoot, 'legacy-only.mjs', 'console.log(1)\n');
    writeGlobalSettings({ Stop: [{ matcher: '', hooks: [{ type: 'command', command: globalCommand('gate.mjs') }] }] });

    const hooks = { Stop: [{ matcher: '', hooks: [{ type: 'command', command: projectCommand('legacy-only.mjs') }] }] };
    const plan = await planLegacyHookDedupe(repoRoot, hooks, { home });

    expect(plan.planned).toHaveLength(0);
    expect(plan.preserved[0].classification).toBe('xt-owned-uncovered');
    expect(plan.hooks).toEqual(hooks);
  });

  it('preserves a foreign hook with no xtrm-managed path', async () => {
    writeGlobalSettings({ Stop: [{ matcher: '', hooks: [{ type: 'command', command: globalCommand('gate.mjs') }] }] });

    const hooks = { Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'node /opt/vendor/my-hook.mjs' }] }] };
    const plan = await planLegacyHookDedupe(repoRoot, hooks, { home });

    expect(plan.planned).toHaveLength(0);
    expect(plan.preserved[0].classification).toBe('foreign');
    expect(plan.hooks).toEqual(hooks);
  });

  it('keeps sibling registrations in a wrapper when only one command is redundant', async () => {
    writeHookFile(repoRoot, 'gate.mjs', 'x\n');
    writeHookFile(home, 'gate.mjs', 'x\n');
    writeGlobalSettings({ Stop: [{ matcher: '', hooks: [{ type: 'command', command: globalCommand('gate.mjs') }] }] });

    const hooks = {
      Stop: [{
        matcher: '',
        hooks: [
          { type: 'command', command: projectCommand('gate.mjs') },
          { type: 'command', command: 'node /opt/vendor/my-hook.mjs' },
        ],
      }],
    };
    const plan = await planLegacyHookDedupe(repoRoot, hooks, { home });

    expect(plan.planned).toHaveLength(1);
    expect(plan.hooks.Stop[0].hooks).toHaveLength(1);
    expect(plan.hooks.Stop[0].hooks[0].command).toBe('node /opt/vendor/my-hook.mjs');
  });

  it('matches on (event, matcher, command) — a different matcher is not covered', async () => {
    writeHookFile(repoRoot, 'gate.mjs', 'x\n');
    writeHookFile(home, 'gate.mjs', 'x\n');
    writeGlobalSettings({
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: globalCommand('gate.mjs') }] }],
    });

    const hooks = {
      PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: projectCommand('gate.mjs') }] }],
    };
    const plan = await planLegacyHookDedupe(repoRoot, hooks, { home });

    expect(plan.planned).toHaveLength(0);
    expect(plan.hooks).toEqual(hooks);
  });

  // Fail-open contract: no global baseline -> report and change nothing, never throw.
  it('fails open when the global settings file is unreadable', async () => {
    const hooks = { Stop: [{ matcher: '', hooks: [{ type: 'command', command: projectCommand('gate.mjs') }] }] };
    const plan = await planLegacyHookDedupe(repoRoot, hooks, { home });

    expect(plan.skipped).toContain('cannot read');
    expect(plan.planned).toHaveLength(0);
    expect(plan.hooks).toEqual(hooks);
  });

  it('fails open when the global hooks directory is missing', async () => {
    fs.removeSync(path.join(home, '.xtrm', 'hooks'));
    writeGlobalSettings({ Stop: [{ matcher: '', hooks: [{ type: 'command', command: globalCommand('gate.mjs') }] }] });

    const hooks = { Stop: [{ matcher: '', hooks: [{ type: 'command', command: projectCommand('gate.mjs') }] }] };
    const plan = await planLegacyHookDedupe(repoRoot, hooks, { home });

    expect(plan.skipped).toContain('is missing');
    expect(plan.hooks).toEqual(hooks);
  });

  it('preserves everything when the project hook file is gone (cannot prove identity)', async () => {
    writeHookFile(home, 'gate.mjs', 'x\n');
    writeGlobalSettings({ Stop: [{ matcher: '', hooks: [{ type: 'command', command: globalCommand('gate.mjs') }] }] });

    const hooks = { Stop: [{ matcher: '', hooks: [{ type: 'command', command: projectCommand('gate.mjs') }] }] };
    const plan = await planLegacyHookDedupe(repoRoot, hooks, { home });

    expect(plan.planned).toHaveLength(0);
    expect(plan.preserved[0].classification).toBe('xt-owned-drift');
  });
});
