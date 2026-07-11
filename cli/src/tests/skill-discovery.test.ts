import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { rmSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  detectDirectChildSkill,
  discoverDefaultSkills,
  discoverTierPacks,
  validateSkillsInvariants,
} from '../core/skill-discovery.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

async function createTempSkillsRoot(): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xtrm-skill-discovery-test-'));
  tempDirs.push(tempDir);
  return path.join(tempDir, '.xtrm', 'skills');
}

async function createSkill(root: string, skillName: string): Promise<void> {
  const skillDir = path.join(root, skillName);
  await fs.ensureDir(skillDir);
  await fs.writeFile(path.join(skillDir, 'SKILL.md'), `# ${skillName}\n`, 'utf8');
}

describe('skill-discovery', () => {
  it('treats only direct children containing SKILL.md as skills', async () => {
    const skillsRoot = await createTempSkillsRoot();
    const defaultRoot = path.join(skillsRoot, 'default');

    await createSkill(defaultRoot, 'valid-skill');
    await fs.ensureDir(path.join(defaultRoot, 'missing-skill-file'));
    await fs.ensureDir(path.join(defaultRoot, 'nested-skill', 'inner'));
    await fs.writeFile(path.join(defaultRoot, 'nested-skill', 'inner', 'SKILL.md'), '# not-direct\n', 'utf8');

    const skills = await discoverDefaultSkills(skillsRoot);

    expect(skills.map(skill => skill.name)).toEqual(['valid-skill']);
  });

  it('ignores directories that contain both SKILL.md and PACK.json', async () => {
    const skillsRoot = await createTempSkillsRoot();
    const defaultRoot = path.join(skillsRoot, 'default');
    const conflictedDir = path.join(defaultRoot, 'conflicted');

    await fs.ensureDir(conflictedDir);
    await fs.writeFile(path.join(conflictedDir, 'SKILL.md'), '# conflicted\n', 'utf8');
    await fs.writeJson(path.join(conflictedDir, 'PACK.json'), { name: 'conflicted' });

    expect(await detectDirectChildSkill(conflictedDir)).toBe(false);
    expect(await discoverDefaultSkills(skillsRoot)).toEqual([]);
  });

  it('discovers pack skills from optional and validates metadata mismatch', async () => {
    const skillsRoot = await createTempSkillsRoot();
    const packRoot = path.join(skillsRoot, 'optional', 'service-pack');

    await fs.ensureDir(packRoot);
    await fs.writeJson(path.join(packRoot, 'PACK.json'), {
      schemaVersion: '1',
      name: 'service-pack',
      version: '1.0.0',
      description: 'Service tools',
      skills: ['listed-only'],
    });
    await createSkill(packRoot, 'filesystem-only');

    const packs = await discoverTierPacks(skillsRoot, 'optional');

    expect(packs).toHaveLength(1);
    expect(packs[0]?.skills.map(skill => skill.name)).toEqual(['filesystem-only']);
    expect(packs[0]?.metadataMismatch).toEqual({
      metadataOnlySkills: ['listed-only'],
      filesystemOnlySkills: ['filesystem-only'],
    });
  });

  it('preserves valid frontmatter runtime names', async () => {
    const skillsRoot = await createTempSkillsRoot();
    const skillDir = path.join(skillsRoot, 'default', 'filesystem-name');

    await fs.ensureDir(skillDir);
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), '---\nname: runtime-name\n---\n', 'utf8');

    await expect(discoverDefaultSkills(skillsRoot)).resolves.toEqual([
      { name: 'filesystem-name', runtimeName: 'runtime-name', path: skillDir },
    ]);
  });

  it('rejects unsafe frontmatter runtime names', async () => {
    const skillsRoot = await createTempSkillsRoot();
    const defaultRoot = path.join(skillsRoot, 'default');
    const skillDir = path.join(defaultRoot, 'safe-directory');

    await fs.ensureDir(skillDir);
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), '---\nname: ../outside\n---\n', 'utf8');

    await expect(discoverDefaultSkills(skillsRoot)).rejects.toThrow(/Unsafe runtime skill name/);
  });

  it('reports invariant violations for nested runtime roots', async () => {
    const skillsRoot = await createTempSkillsRoot();
    const defaultRoot = path.join(skillsRoot, 'default');

    await createSkill(defaultRoot, 'bad-skill');
    await fs.ensureDir(path.join(defaultRoot, 'bad-skill', '.claude'));

    const violations = await validateSkillsInvariants(skillsRoot);

    expect(violations.some(violation => violation.code === 'NESTED_RUNTIME_ROOT')).toBe(true);
  });
});
