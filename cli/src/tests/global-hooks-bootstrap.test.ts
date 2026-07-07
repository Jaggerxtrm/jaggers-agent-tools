import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureGlobalHooksBootstrapped } from '../core/global-hooks-bootstrap.js';

const tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const tempDir of tempDirs.splice(0)) {
    await fs.remove(tempDir);
  }
});

describe('global-hooks-bootstrap', () => {
  it('copies global hooks payload and stays idempotent', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xtrm-global-hooks-'));
    tempDirs.push(tempDir);
    const fakeHome = path.join(tempDir, 'home');
    const pkgRoot = path.join(tempDir, 'pkg');
    vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);

    await fs.ensureDir(pkgRoot);
    await fs.writeJson(path.join(pkgRoot, 'package.json'), { version: '1.2.3' });
    await fs.outputFile(path.join(pkgRoot, '.xtrm', 'hooks', 'beads-claim-sync.mjs'), '#!/usr/bin/env node\n');
    await fs.outputFile(path.join(pkgRoot, '.xtrm', 'hooks', 'gitnexus', 'gitnexus-hook.cjs'), 'module.exports = {};\n');
    await fs.outputFile(path.join(pkgRoot, '.xtrm', 'config', 'hooks.json'), JSON.stringify({ hooks: { PostToolUse: [] } }, null, 2));

    const first = await ensureGlobalHooksBootstrapped(pkgRoot);
    const second = await ensureGlobalHooksBootstrapped(pkgRoot);

    expect(first).toEqual({ installedVersion: '1.2.3', changed: true });
    expect(second).toEqual({ installedVersion: '1.2.3', changed: false });
    expect(await fs.pathExists(path.join(fakeHome, '.xtrm', 'hooks', 'beads-claim-sync.mjs'))).toBe(true);
    expect(await fs.pathExists(path.join(fakeHome, '.xtrm', 'hooks', 'gitnexus', 'gitnexus-hook.cjs'))).toBe(true);
    expect(await fs.pathExists(path.join(fakeHome, '.xtrm', 'config', 'hooks.json'))).toBe(true);
  });
});
