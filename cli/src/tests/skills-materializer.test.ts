import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { rmSync } from 'node:fs';
import {
  rebuildAllRuntimeActiveViews,
  rebuildGlobalActiveView,
  rebuildProjectActiveView,
  rebuildRuntimeActiveView,
} from '../core/skills-materializer.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

async function createTempDir(): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xtrm-materializer-test-'));
  tempDirs.push(tempDir);
  return tempDir;
}

async function writeSkill(root: string, name: string): Promise<void> {
  const skillRoot = path.join(root, name);
  await fs.ensureDir(skillRoot);
  await fs.writeFile(path.join(skillRoot, 'SKILL.md'), `# ${name}\n`, 'utf8');
}

async function writePack(skillsRoot: string, tier: 'optional' | 'user', packName: string, skillNames: string[]): Promise<void> {
  const packRoot = tier === 'optional'
    ? path.join(skillsRoot, 'optional', packName)
    : path.join(skillsRoot, 'user', 'packs', packName);

  await fs.ensureDir(packRoot);
  await fs.writeJson(path.join(packRoot, 'PACK.json'), {
    schemaVersion: '1',
    name: packName,
    version: '1.0.0',
    description: `${packName} pack`,
    skills: skillNames,
  });

  for (const skillName of skillNames) {
    await writeSkill(packRoot, skillName);
  }
}

describe('skills-materializer', () => {
  it('materializes sorted active skills from default + enabled packs', async () => {
    const tempDir = await createTempDir();
    const skillsRoot = path.join(tempDir, '.xtrm', 'skills');

    await writeSkill(path.join(skillsRoot, 'default'), 'zeta');
    await writeSkill(path.join(skillsRoot, 'default'), 'alpha');
    await writePack(skillsRoot, 'optional', 'pack-one', ['beta']);
    await fs.writeJson(path.join(skillsRoot, 'state.json'), {
      schemaVersion: '1',
      enabledPacks: { claude: ['pack-one'], pi: [] },
    });

    const result = await rebuildRuntimeActiveView('claude', skillsRoot);

    expect(result.discoveredSkillCount).toBe(3);
    expect(result.symlinkNames).toEqual(['alpha', 'beta', 'zeta']);

    const activeRuntimeRoot = path.join(skillsRoot, 'active');
    expect((await fs.readdir(activeRuntimeRoot)).sort()).toEqual(['alpha', 'beta', 'zeta']);
    expect((await fs.lstat(path.join(activeRuntimeRoot, 'alpha'))).isSymbolicLink()).toBe(true);
    expect((await fs.lstat(path.join(activeRuntimeRoot, 'beta'))).isSymbolicLink()).toBe(true);
    expect((await fs.lstat(path.join(activeRuntimeRoot, 'zeta'))).isSymbolicLink()).toBe(true);
  });

  it('fails fast on duplicate skill names and leaves existing active view unchanged', async () => {
    const tempDir = await createTempDir();
    const skillsRoot = path.join(tempDir, '.xtrm', 'skills');
    const activeRuntimeRoot = path.join(skillsRoot, 'active');

    await writeSkill(path.join(skillsRoot, 'default'), 'alpha');
    await writePack(skillsRoot, 'optional', 'pack-one', ['alpha']);
    await fs.writeJson(path.join(skillsRoot, 'state.json'), {
      schemaVersion: '1',
      enabledPacks: { claude: ['pack-one'], pi: [] },
    });

    await fs.ensureDir(activeRuntimeRoot);
    await fs.writeFile(path.join(activeRuntimeRoot, 'sentinel.txt'), 'keep', 'utf8');

    await expect(rebuildRuntimeActiveView('claude', skillsRoot)).rejects.toThrow(/Duplicate skill name 'alpha'/);
    expect(await fs.pathExists(path.join(activeRuntimeRoot, 'sentinel.txt'))).toBe(true);
  });

  it('rebuilds single active view from union of claude and pi enabled packs', async () => {
    const tempDir = await createTempDir();
    const skillsRoot = path.join(tempDir, '.xtrm', 'skills');

    await writeSkill(path.join(skillsRoot, 'default'), 'always-on');
    await writePack(skillsRoot, 'optional', 'claude-pack', ['claude-skill']);
    await writePack(skillsRoot, 'optional', 'pi-pack', ['pi-skill']);
    await fs.writeJson(path.join(skillsRoot, 'state.json'), {
      schemaVersion: '1',
      enabledPacks: { claude: ['claude-pack'], pi: ['pi-pack'] },
    });

    const results = await rebuildAllRuntimeActiveViews(skillsRoot);

    expect(results).toEqual([
      {
        runtime: 'claude',
        enabledPackCount: 2,
        discoveredSkillCount: 3,
        symlinkNames: ['always-on', 'claude-skill', 'pi-skill'],
      },
    ]);

    expect((await fs.readdir(path.join(skillsRoot, 'active'))).sort()).toEqual(['always-on', 'claude-skill', 'pi-skill']);
  });

  it('rebuilds global active view from global skills root', async () => {
    const tempDir = await createTempDir();
    const skillsRoot = path.join(tempDir, '.xtrm', 'skills');

    await writeSkill(path.join(skillsRoot, 'default'), 'global-default');
    await writePack(skillsRoot, 'optional', 'global-pack', ['global-optional']);
    await fs.writeJson(path.join(skillsRoot, 'state.json'), {
      schemaVersion: '1',
      enabledPacks: { claude: ['global-pack'], pi: [] },
    });

    const results = await rebuildGlobalActiveView(skillsRoot);

    expect(results[0]?.symlinkNames).toEqual(['global-default', 'global-optional']);
    expect((await fs.readdir(path.join(skillsRoot, 'active'))).sort()).toEqual(['global-default', 'global-optional']);
  });

  it('rebuilds project active view as superset of global active + local skills', async () => {
    const tempDir = await createTempDir();
    const globalSkillsRoot = path.join(tempDir, 'home', '.xtrm', 'skills');
    const projectSkillsRoot = path.join(tempDir, 'repo', '.xtrm', 'skills');

    await writeSkill(path.join(globalSkillsRoot, 'default'), 'global-default');
    await writePack(globalSkillsRoot, 'optional', 'global-pack', ['global-pack-skill']);
    await fs.writeJson(path.join(globalSkillsRoot, 'state.json'), {
      schemaVersion: '1',
      enabledPacks: { claude: ['global-pack'], pi: [] },
    });
    await rebuildGlobalActiveView(globalSkillsRoot);

    await writeSkill(path.join(projectSkillsRoot, 'default'), 'project-default');
    await writePack(projectSkillsRoot, 'user', 'project-pack', ['project-pack-skill']);
    await fs.writeJson(path.join(projectSkillsRoot, 'state.json'), {
      schemaVersion: '1',
      enabledPacks: { claude: ['project-pack'], pi: [] },
    });

    const results = await rebuildProjectActiveView(projectSkillsRoot, { globalSkillsRoot });

    expect(results[0]?.symlinkNames).toEqual([
      'global-default',
      'global-pack-skill',
      'project-default',
      'project-pack-skill',
    ]);
    expect((await fs.readdir(path.join(projectSkillsRoot, 'active'))).sort()).toEqual([
      'global-default',
      'global-pack-skill',
      'project-default',
      'project-pack-skill',
    ]);
  });

  it('keeps rebuildAllRuntimeActiveViews idempotent across repeated calls', async () => {
    const tempDir = await createTempDir();
    const skillsRoot = path.join(tempDir, '.xtrm', 'skills');

    await writeSkill(path.join(skillsRoot, 'default'), 'always-on');
    await writePack(skillsRoot, 'optional', 'shared-pack', ['shared-skill']);
    await fs.writeJson(path.join(skillsRoot, 'state.json'), {
      schemaVersion: '1',
      enabledPacks: { claude: ['shared-pack'], pi: ['shared-pack'] },
    });

    await rebuildAllRuntimeActiveViews(skillsRoot);

    const firstTargets = new Map<string, string>();
    const activeRuntimeRoot = path.join(skillsRoot, 'active');
    for (const name of (await fs.readdir(activeRuntimeRoot)).sort()) {
      firstTargets.set(name, await fs.readlink(path.join(activeRuntimeRoot, name)));
    }

    await rebuildAllRuntimeActiveViews(skillsRoot);

    const secondTargets = new Map<string, string>();
    for (const name of (await fs.readdir(activeRuntimeRoot)).sort()) {
      secondTargets.set(name, await fs.readlink(path.join(activeRuntimeRoot, name)));
    }

    expect([...secondTargets.entries()]).toEqual([...firstTargets.entries()]);
  });
});
