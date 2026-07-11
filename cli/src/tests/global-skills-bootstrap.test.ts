import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureGlobalSkillsBootstrapped } from '../core/global-skills-bootstrap.js';

const tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const tempDir of tempDirs.splice(0)) {
    await fs.remove(tempDir);
  }
});

async function createTempDir(): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xtrm-global-bootstrap-'));
  tempDirs.push(tempDir);
  return tempDir;
}

async function writeSkill(root: string, name: string): Promise<void> {
  const skillRoot = path.join(root, name);
  await fs.ensureDir(skillRoot);
  await fs.writeFile(path.join(skillRoot, 'SKILL.md'), `# ${name}\n`, 'utf8');
}

describe('global-skills-bootstrap', () => {
  it('bootstraps global skills tree and stays idempotent', async () => {
    const tempDir = await createTempDir();
    const fakeHome = path.join(tempDir, 'home');
    const pkgRoot = path.join(tempDir, 'pkg');

    vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);

    await fs.ensureDir(pkgRoot);
    await fs.writeJson(path.join(pkgRoot, 'package.json'), { version: '9.9.9' });
    await writeSkill(path.join(pkgRoot, '.xtrm', 'skills', 'default'), 'default-skill');
    await fs.ensureDir(path.join(pkgRoot, '.xtrm', 'skills', 'optional', 'optional-pack'));
    await fs.writeJson(path.join(pkgRoot, '.xtrm', 'skills', 'optional', 'optional-pack', 'PACK.json'), {
      schemaVersion: '1',
      name: 'optional-pack',
      version: '1.0.0',
      description: 'optional',
      skills: ['optional-skill'],
    });
    await writeSkill(path.join(pkgRoot, '.xtrm', 'skills', 'optional', 'optional-pack'), 'optional-skill');

    const first = await ensureGlobalSkillsBootstrapped(pkgRoot);
    const activeRoot = path.join(fakeHome, '.xtrm', 'skills', 'active');
    expect(await fs.pathExists(activeRoot)).toBe(false);

    await fs.ensureDir(activeRoot);
    await fs.writeFile(path.join(activeRoot, 'preserved.txt'), 'preserved', 'utf8');
    const second = await ensureGlobalSkillsBootstrapped(pkgRoot);

    expect(first).toEqual({ installedVersion: '9.9.9', changed: true });
    expect(second).toEqual({ installedVersion: '9.9.9', changed: false });
    expect(await fs.readFile(path.join(activeRoot, 'preserved.txt'), 'utf8')).toBe('preserved');

    const state = await fs.readJson(path.join(fakeHome, '.xtrm', 'skills', 'state.json')) as {
      schemaVersion: string;
      installedVersion: string;
      installedFrom: string;
      installedAt: string;
    };
    expect(state.schemaVersion).toBe('2');
    expect(state.installedVersion).toBe('9.9.9');
    expect(typeof state.installedFrom).toBe('string');
    expect(typeof state.installedAt).toBe('string');

    const logPath = path.join(fakeHome, '.xtrm', 'logs', 'skills-migration.jsonl');
    const logLines = (await fs.readFile(logPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as { event: string; component: string; outcome: string });
    expect(logLines.some(line => line.event === 'bootstrap.start' && line.component === 'skills-bootstrap')).toBe(true);
    expect(logLines.some(line => line.event === 'bootstrap.copy.default')).toBe(true);
    expect(logLines.some(line => line.event === 'bootstrap.copy.optional')).toBe(true);
    expect(logLines.some(line => line.event === 'bootstrap.ok' && line.outcome === 'skipped')).toBe(true);
  });
});
