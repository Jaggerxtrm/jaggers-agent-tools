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

async function run(runtime: 'claude' | 'pi' = 'claude', state: SkillsState = { ...createDefaultSkillsState(), enabledPacks: { claude: runtime === 'claude' ? ['local'] : [], pi: runtime === 'pi' ? ['local'] : [] } }) {
  const localPackPath = path.join(projectRoot, '.xtrm', 'skills', 'user', 'packs', 'local');
  await fs.ensureDir(path.join(localPackPath, 'local-skill'));
  await fs.writeFile(path.join(localPackPath, 'PACK.json'), '{}');
  await fs.writeFile(path.join(localPackPath, 'local-skill', 'SKILL.md'), '---\nname: local-skill\n---\n');
  return reconcileRuntimeLinks({ projectRoot, state, runtime, discoveredPacks: [pack('local', localPackPath, 'local-skill')], globalDefaultRoot: path.join(globalRoot, 'default'), globalOptionalRoot: path.join(globalRoot, 'optional') });
}

describe('reconcileRuntimeLinks', () => {
  it('creates idempotent direct Claude links and persists only relative manifest ownership', async () => {
    const first = await run();
    const second = await run('claude', first.state);

    expect(second.removedLinks).toEqual([]);
    const link = path.join(projectRoot, '.claude', 'skills', 'local-skill');
    expect((await fs.lstat(path.dirname(link))).isDirectory()).toBe(true);
    expect((await fs.lstat(link)).isSymbolicLink()).toBe(true);
    expect(await fs.readlink(link)).toBe(path.join(projectRoot, '.xtrm', 'skills', 'user', 'packs', 'local', 'local-skill'));
    expect((await readSkillsState(path.join(projectRoot, '.xtrm', 'skills'))).managedLinks.claude).toEqual({
      'local-skill': '.xtrm/skills/user/packs/local/local-skill',
    });
  });

  it('creates direct Pi links without creating managed Pi settings entries', async () => {
    const result = await run('pi');
    const link = path.join(projectRoot, '.pi', 'skills', 'local-skill');

    expect((await fs.lstat(path.dirname(link))).isDirectory()).toBe(true);
    expect((await fs.lstat(link)).isSymbolicLink()).toBe(true);
    expect(result.state.managedLinks.pi).toEqual({
      'local-skill': '.xtrm/skills/user/packs/local/local-skill',
    });
    expect(await fs.pathExists(path.join(projectRoot, '.pi', 'settings.json'))).toBe(false);
  });

  it('reconciles v1 state into schema v2 manifest ownership', async () => {
    const legacyState = { schemaVersion: '1', enabledPacks: { claude: ['local'], pi: [] } } as unknown as SkillsState;
    const result = await run('claude', legacyState);

    expect(result.state.schemaVersion).toBe('2');
    expect(result.state.managedLinks.claude['local-skill']).toBe('.xtrm/skills/user/packs/local/local-skill');
  });

  it('reaps only manifest-owned links and preserves untracked runtime symlinks', async () => {
    const first = await run();
    const runtimeRoot = path.join(projectRoot, '.claude', 'skills');
    const manualTarget = path.join(projectRoot, '.xtrm', 'skills', 'user', 'manual-skill');
    await fs.ensureDir(manualTarget);
    await fs.symlink(manualTarget, path.join(runtimeRoot, 'manual-skill'));

    const nextState = { ...first.state, enabledPacks: { claude: [], pi: [] } };
    const result = await reconcileRuntimeLinks({ projectRoot, state: nextState, runtime: 'claude', discoveredPacks: [], globalDefaultRoot: path.join(globalRoot, 'default'), globalOptionalRoot: path.join(globalRoot, 'optional') });

    expect(result.removedLinks).toEqual(['local-skill']);
    expect(await fs.pathExists(path.join(runtimeRoot, 'local-skill'))).toBe(false);
    expect((await fs.lstat(path.join(runtimeRoot, 'manual-skill'))).isSymbolicLink()).toBe(true);
    expect(result.state.managedLinks.claude).toEqual({});
  });

  it('preserves user-owned runtime directory symlinks regardless of target text', async () => {
    const runtimeDirectory = path.join(projectRoot, '.claude', 'skills');
    await fs.ensureDir(path.dirname(runtimeDirectory));
    await fs.symlink('/custom/active-skills', runtimeDirectory);

    await expect(run()).rejects.toThrow(/user-owned runtime directory/);
    expect(await fs.readlink(runtimeDirectory)).toBe('/custom/active-skills');
  });

  it.each(['claude', 'pi'] as const)('rejects unsafe runtime names before mutating %s runtime', async (runtime) => {
    const localPackPath = path.join(projectRoot, '.xtrm', 'skills', 'user', 'packs', 'local');
    const state = {
      ...createDefaultSkillsState(),
      enabledPacks: { claude: runtime === 'claude' ? ['local'] : [], pi: runtime === 'pi' ? ['local'] : [] },
    };
    const unsafePack = pack('local', localPackPath, '../outside');

    await expect(reconcileRuntimeLinks({ runtime, projectRoot, state, discoveredPacks: [unsafePack], globalDefaultRoot: path.join(globalRoot, 'default'), globalOptionalRoot: path.join(globalRoot, 'optional') })).rejects.toThrow(/Unsafe runtime skill name/);
    expect(await fs.pathExists(path.join(projectRoot, runtime === 'claude' ? '.claude' : '.pi', 'skills'))).toBe(false);
  });

  it.each(['claude', 'pi'] as const)('rejects unsafe managed-link keys before mutating %s runtime', async (runtime) => {
    const state: SkillsState = {
      ...createDefaultSkillsState(),
      enabledPacks: { claude: [], pi: [] },
      managedLinks: runtime === 'claude'
        ? { claude: { '../outside': '.xtrm/skills/old' }, pi: {} }
        : { claude: {}, pi: { '../outside': '.xtrm/skills/old' } },
    };

    await expect(reconcileRuntimeLinks({ runtime, projectRoot, state, discoveredPacks: [], globalDefaultRoot: path.join(globalRoot, 'default'), globalOptionalRoot: path.join(globalRoot, 'optional') })).rejects.toThrow(/Unsafe runtime skill name/);
    expect(await fs.pathExists(path.join(projectRoot, runtime === 'claude' ? '.claude' : '.pi', 'skills'))).toBe(false);
  });

  it('rejects same-name optional packs from global and project scope', async () => {
    const globalPackPath = path.join(globalRoot, 'optional', 'shared');
    const localPackPath = path.join(projectRoot, '.xtrm', 'skills', 'optional', 'shared');
    const state = { ...createDefaultSkillsState(), enabledPacks: { claude: ['shared'], pi: [] } };

    await expect(reconcileRuntimeLinks({ projectRoot, state, runtime: 'claude', discoveredPacks: [pack('shared', globalPackPath, 'global-skill'), pack('shared', localPackPath, 'local-skill')], globalDefaultRoot: path.join(globalRoot, 'default'), globalOptionalRoot: path.join(globalRoot, 'optional') })).rejects.toThrow(/present in more than one scope/);
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
