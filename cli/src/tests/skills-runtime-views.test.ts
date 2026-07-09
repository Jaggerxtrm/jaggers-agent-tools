import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assertRuntimeSkillsViews, getRuntimePointerTarget } from '../core/skills-runtime-views.js';

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    await fs.remove(tempDirs.pop() as string);
  }
});

async function createTempDir(): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xtrm-runtime-view-test-'));
  tempDirs.push(tempDir);
  return tempDir;
}

describe('skills-runtime-views', () => {
  it('returns project runtime pointer target', () => {
    expect(getRuntimePointerTarget({ scope: 'project' })).toBe(path.join('..', '.xtrm', 'skills', 'active'));
  });

  it('returns global runtime pointer target', () => {
    expect(getRuntimePointerTarget({ scope: 'global' })).toBe(path.join(os.homedir(), '.xtrm', 'skills', 'active'));
  });

  it('accepts scope both for migrated repo using global runtime pointers only', async () => {
    const tempHome = await createTempDir();
    const projectRoot = await createTempDir();
    const previousHome = process.env.HOME;
    process.env.HOME = tempHome;

    try {
      const globalActiveRoot = path.join(tempHome, '.xtrm', 'skills', 'active');
      const projectSkillsRoot = path.join(projectRoot, '.xtrm', 'skills');
      const projectActiveRoot = path.join(projectSkillsRoot, 'active');
      const projectDefaultRoot = path.join(projectSkillsRoot, 'default', 'alpha');
      await fs.ensureDir(globalActiveRoot);
      await fs.ensureDir(projectActiveRoot);
      await fs.ensureDir(projectDefaultRoot);
      await fs.writeFile(path.join(globalActiveRoot, 'alpha.md'), '# alpha\n', 'utf8');
      await fs.writeFile(path.join(projectDefaultRoot, 'SKILL.md'), '# alpha\n', 'utf8');
      await fs.symlink(path.join('..', 'default', 'alpha'), path.join(projectActiveRoot, 'alpha'));
      await fs.ensureDir(path.join(projectRoot, '.pi'));
      await fs.writeJson(path.join(projectRoot, '.pi', 'settings.json'), {
        skills: ['~/.xtrm/skills/active'],
      });
      await fs.ensureDir(path.join(tempHome, '.claude'));
      await fs.symlink(globalActiveRoot, path.join(tempHome, '.claude', 'skills'));
      await fs.ensureDir(path.join(tempHome, '.pi', 'agent'));
      await fs.symlink(globalActiveRoot, path.join(tempHome, '.pi', 'agent', 'skills'));

      await expect(assertRuntimeSkillsViews(projectRoot, { scope: 'both' })).resolves.toBeUndefined();
    } finally {
      process.env.HOME = previousHome;
    }
  });
});
