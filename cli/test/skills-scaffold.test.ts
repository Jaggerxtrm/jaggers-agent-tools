import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureAgentsSkillsSymlink } from '../src/core/skills-scaffold.js';

const tempDirs: string[] = [];
const REPO_ROOT = path.resolve(__dirname, '../..');
const REPO_SKILLS_ROOT = path.join(REPO_ROOT, '.xtrm', 'skills');
const SYMLINK_UNSUPPORTED = process.platform === 'win32';

afterEach(async () => {
  for (const tempDir of tempDirs.splice(0)) {
    await fs.remove(tempDir);
  }
});

async function createTempProjectRoot(): Promise<string> {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'xtrm-skills-scaffold-test-'));
  tempDirs.push(projectRoot);
  return projectRoot;
}

describe.skipIf(SYMLINK_UNSUPPORTED)('skills scaffold direct-runtime guard', () => {
  it('preserves foreign files in real .claude/skills directory', async () => {
    const projectRoot = await createTempProjectRoot();
    const projectSkillsRoot = path.join(projectRoot, '.xtrm', 'skills');

    await fs.copy(REPO_SKILLS_ROOT, projectSkillsRoot);
    await ensureAgentsSkillsSymlink(projectRoot);

    const skillsPath = path.join(projectRoot, '.claude', 'skills');
    await fs.remove(skillsPath);
    await fs.ensureDir(skillsPath);
    await fs.writeFile(path.join(skillsPath, 'foreign.txt'), 'local content', 'utf8');

    await expect(ensureAgentsSkillsSymlink(projectRoot)).resolves.toBeDefined();
    expect(await fs.readFile(path.join(skillsPath, 'foreign.txt'), 'utf8')).toBe('local content');
    expect((await fs.lstat(skillsPath)).isDirectory()).toBe(true);
    expect((await fs.readdir(path.join(projectRoot, '.claude'))).some(name => name.startsWith('skills.bak-'))).toBe(false);
  });

  it('keeps foreign content when forced because runtime root is no longer replaced', async () => {
    const projectRoot = await createTempProjectRoot();
    const projectSkillsRoot = path.join(projectRoot, '.xtrm', 'skills');

    await fs.copy(REPO_SKILLS_ROOT, projectSkillsRoot);
    await ensureAgentsSkillsSymlink(projectRoot);

    const skillsPath = path.join(projectRoot, '.claude', 'skills');
    await fs.remove(skillsPath);
    await fs.ensureDir(path.join(skillsPath, 'foo'));
    await fs.writeFile(path.join(skillsPath, 'foo', 'SKILL.md'), '# foo', 'utf8');

    await ensureAgentsSkillsSymlink(projectRoot, { force: true });

    expect(await fs.pathExists(path.join(skillsPath, 'foo', 'SKILL.md'))).toBe(true);
    const backups = (await fs.readdir(path.join(projectRoot, '.claude'))).filter(name => name.startsWith('skills.bak-'));
    expect(backups).toEqual([]);
  });

  it('keeps direct runtime directory untouched', async () => {
    const projectRoot = await createTempProjectRoot();
    const projectSkillsRoot = path.join(projectRoot, '.xtrm', 'skills');

    await fs.copy(REPO_SKILLS_ROOT, projectSkillsRoot);
    await ensureAgentsSkillsSymlink(projectRoot);

    const skillsPath = path.join(projectRoot, '.claude', 'skills');
    const before = await fs.readdir(skillsPath);

    await ensureAgentsSkillsSymlink(projectRoot);

    expect((await fs.lstat(skillsPath)).isDirectory()).toBe(true);
    expect(await fs.readdir(skillsPath)).toEqual(before);
    expect((await fs.readdir(path.join(projectRoot, '.claude'))).some(name => name.startsWith('skills.bak-'))).toBe(false);
  });
});
