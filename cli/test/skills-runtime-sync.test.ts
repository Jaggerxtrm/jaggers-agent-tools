import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureAgentsSkillsSymlink } from '../src/core/skills-scaffold.js';
import { checkRuntimeSkillsViews, assertRuntimeSkillsViews } from '../src/core/skills-runtime-views.js';

const tempDirs: string[] = [];

const SYMLINK_UNSUPPORTED = process.platform === 'win32';

afterEach(async () => {
  for (const tempDir of tempDirs.splice(0)) {
    await fs.remove(tempDir);
  }
});

async function createTempProjectRoot(): Promise<string> {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'xtrm-runtime-sync-test-'));
  tempDirs.push(projectRoot);
  return projectRoot;
}

async function writeSkill(parentRoot: string, skillName: string): Promise<void> {
  const skillRoot = path.join(parentRoot, skillName);
  await fs.ensureDir(skillRoot);
  await fs.writeFile(path.join(skillRoot, 'SKILL.md'), `# ${skillName}\n`, 'utf8');
}

async function writePack(
  skillsRoot: string,
  tier: 'optional' | 'user',
  packName: string,
  skillNames: readonly string[],
): Promise<void> {
  const packRoot = tier === 'optional'
    ? path.join(skillsRoot, 'optional', packName)
    : path.join(skillsRoot, 'user', 'packs', packName);

  await fs.ensureDir(packRoot);
  await fs.writeJson(path.join(packRoot, 'PACK.json'), {
    schemaVersion: '1',
    name: packName,
    version: '1.0.0',
    description: `${packName} pack`,
    skills: [...skillNames],
  });

  for (const skillName of skillNames) {
    await writeSkill(packRoot, skillName);
  }
}

async function writeState(skillsRoot: string, claudePacks: readonly string[], piPacks: readonly string[]): Promise<void> {
  await fs.ensureDir(skillsRoot);
  await fs.writeJson(path.join(skillsRoot, 'state.json'), {
    schemaVersion: '1',
    enabledPacks: {
      claude: [...claudePacks],
      pi: [...piPacks],
    },
  });
}

describe.skipIf(SYMLINK_UNSUPPORTED)('skills runtime sync filesystem contract', () => {
  it('materializes direct Claude and Pi child symlinks and persists manifest ownership', async () => {
    const projectRoot = await createTempProjectRoot();
    const skillsRoot = path.join(projectRoot, '.xtrm', 'skills');

    await writeSkill(path.join(skillsRoot, 'default'), 'alpha');
    await writeSkill(path.join(skillsRoot, 'default'), 'beta');
    await writePack(skillsRoot, 'optional', 'pack-claude', ['gamma']);
    await writePack(skillsRoot, 'user', 'pack-shared', ['delta']);
    await writeState(skillsRoot, ['pack-claude', 'pack-shared'], ['pack-shared']);

    await ensureAgentsSkillsSymlink(projectRoot);

    for (const [runtime, expectedSkills] of [
      ['claude', ['delta', 'gamma']],
      ['pi', ['delta']],
    ] as const) {
      const runtimeRoot = path.join(projectRoot, runtime === 'claude' ? '.claude' : '.pi', 'skills');
      expect((await fs.readdir(runtimeRoot)).sort()).toEqual(expectedSkills);
      for (const entryName of expectedSkills) {
        const entryPath = path.join(runtimeRoot, entryName);
        expect((await fs.lstat(entryPath)).isSymbolicLink()).toBe(true);
        const target = await fs.readlink(entryPath);
        expect(path.isAbsolute(target)).toBe(true);
        expect(await fs.pathExists(path.join(target, 'SKILL.md'))).toBe(true);
      }
    }

    expect(await fs.pathExists(path.join(skillsRoot, 'active'))).toBe(false);
    expect(await fs.pathExists(path.join(projectRoot, '.pi', 'settings.json'))).toBe(false);

    const check = await checkRuntimeSkillsViews(projectRoot);
    expect(check.activeReady).toBe(true);
    expect(check.projectClaudePointerState).toBe('ready');
    expect(check.projectPiPointerState).toBe('ready');
  });

  it('uses enabled optional skill when default has same runtime name', async () => {
    const projectRoot = await createTempProjectRoot();
    const skillsRoot = path.join(projectRoot, '.xtrm', 'skills');

    await writeSkill(path.join(skillsRoot, 'default'), 'alpha');
    await writePack(skillsRoot, 'optional', 'dup-pack', ['alpha']);
    await writeState(skillsRoot, ['dup-pack'], []);

    await expect(ensureAgentsSkillsSymlink(projectRoot)).resolves.toMatchObject({ activatedClaudeSkills: 1 });
    const runtimeLink = path.join(projectRoot, '.claude', 'skills', 'alpha');
    expect(await fs.readlink(runtimeLink)).toBe(path.join(skillsRoot, 'optional', 'dup-pack', 'alpha'));
    expect(await fs.pathExists(path.join(skillsRoot, 'active'))).toBe(false);
  });

  it('reports malformed reconciled runtime directories without consulting Pi settings', async () => {
    const projectRoot = await createTempProjectRoot();
    const skillsRoot = path.join(projectRoot, '.xtrm', 'skills');

    await writeState(skillsRoot, [], []);
    await fs.ensureDir(path.join(projectRoot, '.claude', 'skills'));
    await fs.writeJson(path.join(skillsRoot, 'state.json'), {
      schemaVersion: '2',
      enabledPacks: { claude: [], pi: [] },
      managedLinks: { claude: { alpha: '.xtrm/skills/missing' }, pi: {} },
    });
    await fs.ensureDir(path.join(projectRoot, '.pi'));
    await fs.writeFile(path.join(projectRoot, '.pi', 'settings.json'), '{ malformed', 'utf8');

    const check = await checkRuntimeSkillsViews(projectRoot);
    expect(check.activeReady).toBe(false);
    expect(check.projectPiPointerState).toBe('skipped');

    await expect(assertRuntimeSkillsViews(projectRoot, { scope: 'project' })).rejects.toThrow(
      /\.claude\/skills is not a real reconciled directory/,
    );
  });

  it('throws clear errors for malformed state.json during rebuild', async () => {
    const projectRoot = await createTempProjectRoot();
    const skillsRoot = path.join(projectRoot, '.xtrm', 'skills');

    await writeSkill(path.join(skillsRoot, 'default'), 'alpha');
    await fs.writeFile(path.join(skillsRoot, 'state.json'), '{not-json', 'utf8');

    await expect(ensureAgentsSkillsSymlink(projectRoot)).rejects.toThrow();
  });
});
