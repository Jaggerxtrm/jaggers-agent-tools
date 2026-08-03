import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { rmSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveGlobalSkillsRoot } from '../core/skills-layout.js';
import {
  createDefaultSkillsState,
  isSafeRuntimeLinkName,
  readSkillsState,
  setRuntimeEnabledPacks,
  writeSkillsState,
} from '../core/skills-state.js';

interface RuntimePackCase {
  name: string;
  apply: (skillsRoot: string) => Promise<void>;
  expectedClaude: string[];
  expectedPi: string[];
}

const tempDirs: string[] = [];
const realHome = process.env.HOME;

afterEach(() => {
  if (realHome === undefined) delete process.env.HOME;
  else process.env.HOME = realHome;
  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

async function createTempSkillsRoot(): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xtrm-skills-state-test-'));
  tempDirs.push(tempDir);
  return path.join(tempDir, '.xtrm', 'skills');
}

const runtimePackCases: RuntimePackCase[] = [
  {
    name: 'deduplicates and sorts enabled packs',
    apply: async (skillsRoot) => {
      await writeSkillsState(skillsRoot, {
        schemaVersion: '1',
        enabledPacks: {
          claude: ['zeta', 'alpha', 'alpha'],
          pi: ['pi-pack', 'pi-pack'],
        },
      });
    },
    expectedClaude: ['alpha', 'zeta'],
    expectedPi: ['pi-pack'],
  },
  {
    name: 'updates per-runtime enabled packs',
    apply: async (skillsRoot) => {
      await setRuntimeEnabledPacks(skillsRoot, 'claude', ['service', 'service', 'alpha']);
    },
    expectedClaude: ['alpha', 'service'],
    expectedPi: [],
  },
];

describe('skills-state', () => {
  it('initializes schemaVersion 2 state with per-runtime manifests and no active view', async () => {
    const skillsRoot = await createTempSkillsRoot();

    const state = await readSkillsState(skillsRoot);

    expect(state).toEqual(createDefaultSkillsState());
    expect(await fs.pathExists(path.join(skillsRoot, 'state.json'))).toBe(true);
    expect(await fs.pathExists(path.join(skillsRoot, 'active'))).toBe(false);
    expect(await fs.pathExists(path.join(skillsRoot, 'user', 'packs'))).toBe(false);
  });

  // xtrm-vtqlg.5: repo scope must not re-mint the tiers the global-SSOT
  // migration retires, or `xt migrate skills --apply` is undone by the next write.
  it('does not scaffold retired managed tiers at repo scope', async () => {
    const skillsRoot = await createTempSkillsRoot();

    await setRuntimeEnabledPacks(skillsRoot, 'claude', ['alpha']);

    expect(await fs.pathExists(path.join(skillsRoot, 'state.json'))).toBe(true);
    expect(await fs.pathExists(path.join(skillsRoot, 'default'))).toBe(false);
    expect(await fs.pathExists(path.join(skillsRoot, 'optional'))).toBe(false);
  });

  it('still scaffolds both managed tiers at global scope', async () => {
    const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xtrm-skills-state-home-'));
    tempDirs.push(tempHome);
    process.env.HOME = tempHome;
    const globalSkillsRoot = resolveGlobalSkillsRoot();
    expect(globalSkillsRoot).toBe(path.join(tempHome, '.xtrm', 'skills'));

    await readSkillsState(globalSkillsRoot);

    expect(await fs.pathExists(path.join(globalSkillsRoot, 'default'))).toBe(true);
    expect(await fs.pathExists(path.join(globalSkillsRoot, 'optional'))).toBe(true);
  });

  it('accepts forward-compatible unknown state keys', async () => {
    const skillsRoot = await createTempSkillsRoot();

    await fs.ensureDir(skillsRoot);
    await fs.writeJson(path.join(skillsRoot, 'state.json'), {
      schemaVersion: '1',
      enabledPacks: { claude: ['alpha'], pi: [] },
      futureField: 'kept-on-disk-ignored-in-memory',
    });

    const state = await readSkillsState(skillsRoot);

    expect(state).toEqual({
      schemaVersion: '2',
      enabledPacks: { claude: ['alpha'], pi: [], codex: [] },
      managedLinks: { claude: {}, pi: {}, codex: {} },
    });
    expect(await fs.readJson(path.join(skillsRoot, 'state.json'))).toEqual({
      schemaVersion: '1',
      enabledPacks: { claude: ['alpha'], pi: [] },
      futureField: 'kept-on-disk-ignored-in-memory',
    });
  });

  it.each(['../outside', 'nested/name', '..', 'bad\0name'])('rejects unsafe runtime link name %j', (name) => {
    expect(isSafeRuntimeLinkName(name)).toBe(false);
  });

  it('rejects unsafe managed-link names before writing state', async () => {
    const skillsRoot = await createTempSkillsRoot();

    await expect(writeSkillsState(skillsRoot, {
      ...createDefaultSkillsState(),
      managedLinks: { claude: { '../outside': '.xtrm/skills/old' }, pi: {}, codex: {} },
    })).rejects.toThrow();
    expect(await fs.pathExists(skillsRoot)).toBe(false);
  });

  it('rejects unsafe managed-link names when reading state', async () => {
    const skillsRoot = await createTempSkillsRoot();
    await fs.ensureDir(skillsRoot);
    await fs.writeJson(path.join(skillsRoot, 'state.json'), {
      schemaVersion: '2',
      enabledPacks: { claude: [], pi: [] },
      managedLinks: { claude: { '../outside': '.xtrm/skills/old' }, pi: {} },
    });

    await expect(readSkillsState(skillsRoot)).rejects.toThrow(/Invalid skills state/);
  });

  it.each(runtimePackCases)('$name', async ({ apply, expectedClaude, expectedPi }) => {
    const skillsRoot = await createTempSkillsRoot();

    await apply(skillsRoot);
    const state = await readSkillsState(skillsRoot);

    expect(state.enabledPacks.claude).toEqual(expectedClaude);
    expect(state.enabledPacks.pi).toEqual(expectedPi);
  });
});
