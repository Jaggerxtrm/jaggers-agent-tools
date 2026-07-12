import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { rmSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { discoverRepoPacks, discoverTierPacks, validateSkillsInvariants } from '../core/skill-discovery.js';

const tempDirs: string[] = [];
afterEach(() => { for (const tempDir of tempDirs.splice(0)) rmSync(tempDir, { recursive: true, force: true }); });

async function createRoot(): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xtrm-skill-discovery-test-'));
  tempDirs.push(tempDir);
  return path.join(tempDir, '.xtrm', 'skills');
}

async function writeSkill(dir: string, name?: string): Promise<void> {
  await fs.ensureDir(dir);
  await fs.writeFile(path.join(dir, 'SKILL.md'), name ? `---\nname: ${name}\n---\n# skill\n` : '# skill\n');
}

describe('skill-discovery v2', () => {
  it('discovers root and direct-child skills from flat packs', async () => {
    const root = await createRoot();
    await writeSkill(path.join(root, 'pack-one'), 'renamed-pack');
    await writeSkill(path.join(root, 'pack-one', 'child'));
    await writeSkill(path.join(root, 'default', 'reserved'));
    await fs.writeJson(path.join(root, 'pack-one', 'PACK.json'), { ignored: true });

    const packs = await discoverRepoPacks(root);
    expect(packs.map(pack => pack.name)).toEqual(['pack-one']);
    expect(packs[0]?.skills.map(skill => [skill.name, skill.runtimeName])).toEqual([
      ['pack-one', 'renamed-pack'],
      ['child', 'child'],
    ]);
  });

  it('uses v2 pack over v1 shim and discovers legacy-only packs', async () => {
    const root = await createRoot();
    await writeSkill(path.join(root, 'same', 'v2'));
    await writeSkill(path.join(root, 'user', 'packs', 'same', 'v1'));
    await writeSkill(path.join(root, 'user', 'packs', 'legacy-only', 'skill'));

    const packs = await discoverTierPacks(root, 'user');
    expect(packs.map(pack => pack.name)).toEqual(['legacy-only', 'same']);
    expect(packs.find(pack => pack.name === 'same')?.skills.map(skill => skill.name)).toEqual(['v2']);
  });

  it('filters reserved names', async () => {
    const root = await createRoot();
    for (const name of ['default', 'optional', 'user', 'active', 'local-legacy']) await writeSkill(path.join(root, name));
    await fs.writeFile(path.join(root, 'state.json'), '{}');
    expect(await discoverRepoPacks(root)).toEqual([]);
    expect(await validateSkillsInvariants(root)).toEqual([]);
  });
});
