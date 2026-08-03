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
  return { name, path: packPath, tier: 'user', skills: [{ name: skillName, runtimeName: skillName, path: path.join(packPath, skillName) }] };
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'xtrm-reconcile-'));
  projectRoot = path.join(root, 'project');
  globalRoot = path.join(root, 'global');
  await fs.ensureDir(path.join(globalRoot, 'default', 'base'));
  await fs.writeFile(path.join(globalRoot, 'default', 'base', 'SKILL.md'), '---\nname: base\n---\n');
});
afterEach(async () => fs.remove(root));

async function run(runtime: 'claude' | 'pi' = 'claude', state: SkillsState = { ...createDefaultSkillsState(), enabledPacks: { claude: runtime === 'claude' ? ['local'] : [], pi: runtime === 'pi' ? ['local'] : [], codex: [] } }) {
  const localPackPath = path.join(projectRoot, '.xtrm', 'skills', 'local');
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
    expect(await fs.readlink(link)).toBe(path.join(projectRoot, '.xtrm', 'skills', 'local', 'local-skill'));
    expect((await readSkillsState(path.join(projectRoot, '.xtrm', 'skills'))).managedLinks.claude).toEqual({
      'local-skill': '.xtrm/skills/local/local-skill',
    });
  });

  it('creates direct Pi links without creating managed Pi settings entries', async () => {
    const result = await run('pi');
    const link = path.join(projectRoot, '.pi', 'skills', 'local-skill');

    expect((await fs.lstat(path.dirname(link))).isDirectory()).toBe(true);
    expect((await fs.lstat(link)).isSymbolicLink()).toBe(true);
    expect(result.state.managedLinks.pi).toEqual({
      'local-skill': '.xtrm/skills/local/local-skill',
    });
    expect(await fs.pathExists(path.join(projectRoot, '.pi', 'settings.json'))).toBe(false);
  });

  it('re-materializes a broken managed symlink whose target no longer exists (xtrm-4cqxc)', async () => {
    // Bootstrap: create a valid managed symlink through the normal reconciler flow.
    const first = await run();
    const link = path.join(projectRoot, '.claude', 'skills', 'local-skill');
    const validTarget = path.join(projectRoot, '.xtrm', 'skills', 'local', 'local-skill');
    expect(await fs.readlink(link)).toBe(validTarget);
    expect(await fs.pathExists(link)).toBe(true);

    // Simulate the mercury-repo class of drift: replace the managed symlink with one that points
    // at the same STRING (readlink matches) but at a target that no longer exists on disk.
    // Under v2 migration, .xtrm/skills/active/ was retired; existing symlinks pointing there
    // would readlink-match nothing (different string) — but symlinks pointing at a since-deleted
    // .xtrm/skills/default/<skill> path (e.g. an intermediate rename) would readlink-match yet
    // dangle. Force the dangling case:
    await fs.remove(validTarget);
    expect(await fs.pathExists(link)).toBe(false); // broken through the symlink

    // Re-materialize the target under a fresh pack path so the reconciler has something to point at.
    await fs.ensureDir(validTarget);
    await fs.writeFile(path.join(validTarget, 'SKILL.md'), '---\nname: local-skill\n---\n');

    // Now leave the (still valid readlink-string) link in place and re-run reconcile — but first
    // corrupt the link so it points at a since-removed path with the same target string:
    // simplest reproducer: point at a subdirectory of the target that we then delete.
    const staleSubpath = path.join(validTarget, 'stale-inner');
    await fs.ensureDir(staleSubpath);
    await fs.remove(link);
    await fs.symlink(staleSubpath, link);
    await fs.remove(staleSubpath); // link now dangles

    // Preserve the managedLinks manifest as-if reconciler previously wrote it (relative path).
    const brokenState: SkillsState = {
      ...first.state,
      managedLinks: {
        claude: { 'local-skill': path.relative(projectRoot, staleSubpath) },
        pi: {},
        codex: {},
      },
    };

    const result = await reconcileRuntimeLinks({
      projectRoot,
      state: brokenState,
      runtime: 'claude',
      discoveredPacks: [pack('local', path.join(projectRoot, '.xtrm', 'skills', 'local'), 'local-skill')],
      globalDefaultRoot: path.join(globalRoot, 'default'),
      globalOptionalRoot: path.join(globalRoot, 'optional'),
    });

    // The link should now point at the valid desired target, not the stale dangling one.
    expect(await fs.readlink(link)).toBe(validTarget);
    expect(await fs.pathExists(link)).toBe(true);
    expect(result.state.managedLinks.claude['local-skill']).toBe('.xtrm/skills/local/local-skill');
  });

  it('does not touch a healthy managed symlink whose target exists (regression against over-eager repair)', async () => {
    const first = await run();
    const link = path.join(projectRoot, '.claude', 'skills', 'local-skill');
    const inodeBefore = (await fs.lstat(link)).ino;

    const second = await run('claude', first.state);
    const inodeAfter = (await fs.lstat(link)).ino;

    // Same inode → symlink was not removed+recreated.
    expect(inodeAfter).toBe(inodeBefore);
    expect(second.removedLinks).toEqual([]);
  });

  it('reconciles v1 state into schema v2 manifest ownership', async () => {
    const legacyState = { schemaVersion: '1', enabledPacks: { claude: ['local'], pi: [] } } as unknown as SkillsState;
    const result = await run('claude', legacyState);

    expect(result.state.schemaVersion).toBe('2');
    expect(result.state.managedLinks.claude['local-skill']).toBe('.xtrm/skills/local/local-skill');
  });

  it('reaps only manifest-owned links and preserves untracked runtime symlinks', async () => {
    const first = await run();
    const runtimeRoot = path.join(projectRoot, '.claude', 'skills');
    const manualTarget = path.join(projectRoot, '.xtrm', 'skills', 'user', 'manual-skill');
    await fs.ensureDir(manualTarget);
    await fs.symlink(manualTarget, path.join(runtimeRoot, 'manual-skill'));

    const nextState = { ...first.state, enabledPacks: { claude: [], pi: [], codex: [] } };
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
    const localPackPath = path.join(projectRoot, '.xtrm', 'skills', 'local');
    const state = {
      ...createDefaultSkillsState(),
      enabledPacks: { claude: runtime === 'claude' ? ['local'] : [], pi: runtime === 'pi' ? ['local'] : [], codex: [] },
    };
    const unsafePack = pack('local', localPackPath, '../outside');

    await expect(reconcileRuntimeLinks({ runtime, projectRoot, state, discoveredPacks: [unsafePack], globalDefaultRoot: path.join(globalRoot, 'default'), globalOptionalRoot: path.join(globalRoot, 'optional') })).rejects.toThrow(/Unsafe runtime skill name/);
    expect(await fs.pathExists(path.join(projectRoot, runtime === 'claude' ? '.claude' : '.pi', 'skills'))).toBe(false);
  });

  it.each(['claude', 'pi'] as const)('rejects unsafe managed-link keys before mutating %s runtime', async (runtime) => {
    const state: SkillsState = {
      ...createDefaultSkillsState(),
      enabledPacks: { claude: [], pi: [], codex: [] },
      managedLinks: runtime === 'claude'
        ? { claude: { '../outside': '.xtrm/skills/old' }, pi: {}, codex: {} }
        : { claude: {}, pi: { '../outside': '.xtrm/skills/old' }, codex: {} },
    };

    await expect(reconcileRuntimeLinks({ runtime, projectRoot, state, discoveredPacks: [], globalDefaultRoot: path.join(globalRoot, 'default'), globalOptionalRoot: path.join(globalRoot, 'optional') })).rejects.toThrow(/Unsafe runtime skill name/);
    expect(await fs.pathExists(path.join(projectRoot, runtime === 'claude' ? '.claude' : '.pi', 'skills'))).toBe(false);
  });

  it('rejects same-name optional packs from global and project scope', async () => {
    const globalPackPath = path.join(globalRoot, 'optional', 'shared');
    const localPackPath = path.join(projectRoot, '.xtrm', 'skills', 'optional', 'shared');
    const state = { ...createDefaultSkillsState(), enabledPacks: { claude: ['shared'], pi: [], codex: [] } };

    await expect(reconcileRuntimeLinks({ projectRoot, state, runtime: 'claude', discoveredPacks: [pack('shared', globalPackPath, 'global-skill'), pack('shared', localPackPath, 'local-skill')], globalDefaultRoot: path.join(globalRoot, 'default'), globalOptionalRoot: path.join(globalRoot, 'optional') })).rejects.toThrow(/present in more than one scope/);
  });

  it('rejects collision with global default and preserves user links', async () => {
    const localPackPath = path.join(projectRoot, '.xtrm', 'skills', 'local');
    const collision = pack('local', localPackPath, 'base');
    await expect(reconcileRuntimeLinks({ projectRoot, state: { ...createDefaultSkillsState(), enabledPacks: { claude: ['local'], pi: [], codex: [] } }, runtime: 'claude', discoveredPacks: [collision], globalDefaultRoot: path.join(globalRoot, 'default'), globalOptionalRoot: path.join(globalRoot, 'optional') })).rejects.toThrow(/global default/);
    await fs.ensureDir(path.join(projectRoot, '.claude', 'skills'));
    await fs.writeFile(path.join(projectRoot, '.claude', 'skills', 'hand-linked'), 'user');
    expect(await fs.readFile(path.join(projectRoot, '.claude', 'skills', 'hand-linked'), 'utf8')).toBe('user');
  });

  // xtrm-vtqlg.7: the two loud refusals are the enforcement half of the
  // user-owned LOCATION contract (xtrm-kvsrd.4) and had no coverage anywhere.
  it('refuses to replace a runtime directory that is itself a user symlink', async () => {
    const userOwned = path.join(root, 'user-runtime-dir');
    await fs.ensureDir(userOwned);
    await fs.ensureDir(path.join(projectRoot, '.claude'));
    await fs.symlink(userOwned, path.join(projectRoot, '.claude', 'skills'));

    await expect(run()).rejects.toThrow(/Refusing to replace user-owned runtime directory/);
    expect((await fs.lstat(path.join(projectRoot, '.claude', 'skills'))).isSymbolicLink()).toBe(true);
  });

  it('refuses to overwrite an untracked real dir whose name collides with a managed skill', async () => {
    const userDir = path.join(projectRoot, '.claude', 'skills', 'local-skill');
    await fs.ensureDir(userDir);
    await fs.writeFile(path.join(userDir, 'SKILL.md'), '---\nname: local-skill\n---\nuser content\n');

    await expect(run()).rejects.toThrow(/Cannot enable skill 'local-skill'.*is user-owned/);
    expect((await fs.lstat(userDir)).isDirectory()).toBe(true);
    expect(await fs.readFile(path.join(userDir, 'SKILL.md'), 'utf8')).toContain('user content');
  });
});
