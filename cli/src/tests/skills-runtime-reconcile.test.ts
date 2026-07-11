import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { reconcileRuntimeLinks } from '../core/skills-runtime-reconcile.js';
import { createDefaultSkillsState, readSkillsState, type SkillsState } from '../core/skills-state.js';
import type { DiscoveredPack } from '../core/skill-discovery.js';

let root: string;
let projectRoot: string;
let globalRoot: string;

function pack(name: string, packPath: string, skillName: string): DiscoveredPack {
  return { name, path: packPath, tier: 'user', skills: [{ name: skillName, runtimeName: skillName, path: path.join(packPath, skillName) }], metadataMismatch: { metadataOnlySkills: [], filesystemOnlySkills: [] } };
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'xtrm-reconcile-'));
  projectRoot = path.join(root, 'project');
  globalRoot = path.join(root, 'global');
  await fs.ensureDir(path.join(globalRoot, 'default', 'base'));
  await fs.writeFile(path.join(globalRoot, 'default', 'base', 'SKILL.md'), '---\nname: base\n---\n');
});
afterEach(async () => fs.remove(root));

async function run(state: SkillsState = { ...createDefaultSkillsState(), enabledPacks: { claude: ['local'], pi: [] } }) {
  const localPackPath = path.join(projectRoot, '.xtrm', 'skills', 'user', 'packs', 'local');
  await fs.ensureDir(path.join(localPackPath, 'local-skill'));
  await fs.writeFile(path.join(localPackPath, 'PACK.json'), '{}');
  await fs.writeFile(path.join(localPackPath, 'local-skill', 'SKILL.md'), '---\nname: local-skill\n---\n');
  const result = await reconcileRuntimeLinks({ projectRoot, state, runtime: 'claude', discoveredPacks: [pack('local', localPackPath, 'local-skill')], globalDefaultRoot: path.join(globalRoot, 'default'), globalOptionalRoot: path.join(globalRoot, 'optional') });
  return result;
}

describe('reconcileRuntimeLinks', () => {
  it('creates idempotent direct links and persists manifest', async () => {
    const first = await run();
    const second = await run(first.state);
    expect(second.removedLinks).toEqual([]);
    expect(await fs.readlink(path.join(projectRoot, '.claude', 'skills', 'local-skill'))).toBe(path.join(projectRoot, '.xtrm', 'skills', 'user', 'packs', 'local', 'local-skill'));
    expect((await readSkillsState(path.join(projectRoot, '.xtrm', 'skills'))).managedLinks.claude['local-skill']).toContain('.xtrm');
  });

  it('rejects collision with global default and preserves user links', async () => {
    const localPackPath = path.join(projectRoot, '.xtrm', 'skills', 'user', 'packs', 'local');
    const collision = pack('local', localPackPath, 'base');
    await expect(reconcileRuntimeLinks({ projectRoot, state: { ...createDefaultSkillsState(), enabledPacks: { claude: ['local'], pi: [] } }, runtime: 'claude', discoveredPacks: [collision], globalDefaultRoot: path.join(globalRoot, 'default'), globalOptionalRoot: path.join(globalRoot, 'optional') })).rejects.toThrow(/global default/);
    await fs.ensureDir(path.join(projectRoot, '.claude', 'skills'));
    await fs.writeFile(path.join(projectRoot, '.claude', 'skills', 'hand-linked'), 'user');
    expect(await fs.readFile(path.join(projectRoot, '.claude', 'skills', 'hand-linked'), 'utf8')).toBe('user');
  });
});
