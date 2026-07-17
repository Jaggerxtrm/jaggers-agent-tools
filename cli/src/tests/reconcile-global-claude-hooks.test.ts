import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reconcileGlobalClaudeHooks } from '../core/claude-runtime-sync.js';

let homeDir = '';
let previousHome: string | undefined;

beforeEach(() => {
  homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xtrm-global-claude-'));
  previousHome = process.env.HOME;
  process.env.HOME = homeDir;
  vi.spyOn(os, 'homedir').mockReturnValue(homeDir);
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  vi.restoreAllMocks();
  fs.removeSync(homeDir);
});

describe('reconcileGlobalClaudeHooks', () => {
  it('preserves user hooks and tags global-owned entries', async () => {
    const settingsPath = path.join(homeDir, '.claude', 'settings.json');
    const hooksConfigPath = path.join(homeDir, '.xtrm', 'config', 'hooks.json');
    const hooksRoot = path.join(homeDir, '.xtrm', 'hooks');
    fs.ensureDirSync(hooksRoot);
    fs.ensureDirSync(path.dirname(settingsPath));
    fs.ensureDirSync(path.dirname(hooksConfigPath));
    fs.writeJsonSync(hooksConfigPath, {
      permissionsDefaults: ['Bash(git status:*)'],
      hooks: {
        PreToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'node ${CLAUDE_PLUGIN_ROOT}/hooks/worktree-boundary.mjs' }] }],
      },
    });
    fs.writeFileSync(path.join(hooksRoot, 'statusline.mjs'), '');
    fs.writeJsonSync(settingsPath, {
      permissions: { allow: ['Bash(ls:*)'] },
      hooks: {
        PreToolUse: [{ matcher: 'foo', hooks: [{ type: 'command', command: 'my-tool' }] }],
      },
    });

    const result = await reconcileGlobalClaudeHooks();
    const written = fs.readJsonSync(settingsPath) as { hooks: Record<string, Array<{ _source?: string; _xtrm?: { hash?: string }; hooks: Array<{ command: string }> }>> };

    expect(result.changed).toBe(true);
    expect(fs.readJsonSync(settingsPath).permissions.allow).toEqual(['Bash(ls:*)', 'Bash(git status:*)']);
    expect(written.hooks.PreToolUse).toHaveLength(2);
    expect(written.hooks.PreToolUse[0]._source).toBe('xtrm-global');
    expect(written.hooks.PreToolUse[0]._xtrm?.hash).toBeTruthy();
    expect(written.hooks.PreToolUse[1].hooks[0].command).toBe('my-tool');
  });
});
