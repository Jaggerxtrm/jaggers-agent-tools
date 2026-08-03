import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { DiscoveredPack } from '../core/skill-discovery.js';
import { reconcileRuntimeLinks } from '../core/skills-runtime-reconcile.js';
import { checkRuntimeSkillsViews } from '../core/skills-runtime-views.js';
import { createDefaultSkillsState, readSkillsState, type SkillsState } from '../core/skills-state.js';

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await fs.remove(root);
});

async function fixture(): Promise<{
  projectRoot: string;
  globalRoot: string;
  state: SkillsState;
  packs: DiscoveredPack[];
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xtrm-codex-k4-skills-'));
  roots.push(root);
  const projectRoot = path.join(root, 'project');
  const globalRoot = path.join(root, 'global');
  const defaultSkill = path.join(globalRoot, 'default', 'always-on');
  const packRoot = path.join(projectRoot, '.xtrm', 'skills', 'local');
  const packSkill = path.join(packRoot, 'project-tool');
  await fs.outputFile(path.join(defaultSkill, 'SKILL.md'), '---\nname: always-on\n---\n');
  await fs.outputFile(path.join(packSkill, 'SKILL.md'), '---\nname: project-tool\n---\n');

  const state = {
    ...createDefaultSkillsState(),
    enabledPacks: { claude: [], pi: [], codex: ['local'] },
  } as unknown as SkillsState;
  const packs: DiscoveredPack[] = [{
    name: 'local',
    path: packRoot,
    tier: 'user',
    skills: [{ name: 'project-tool', runtimeName: 'project-tool', path: packSkill }],
  }];
  return { projectRoot, globalRoot, state, packs };
}

describe('K4 Codex managed distribution', () => {
  it('keeps Serena out of active installer, policy, and default-skill surfaces', async () => {
    const repoRoot = path.resolve(__dirname, '../../..');
    const [packageJson, piSchema, piTemplate, settings, hooks] = await Promise.all([
      fs.readJson(path.join(repoRoot, 'package.json')),
      fs.readJson(path.join(repoRoot, '.xtrm', 'config', 'pi', 'install-schema.json')),
      fs.readJson(path.join(repoRoot, '.xtrm', 'config', 'pi', 'settings.json.template')),
      fs.readJson(path.join(repoRoot, '.xtrm', 'config', 'settings.json')),
      fs.readJson(path.join(repoRoot, '.xtrm', 'config', 'hooks.json')),
    ]);

    expect(packageJson.pi.packages).not.toContain('npm:pi-serena-tools');
    expect(packageJson.files).not.toContain('scripts/patch-external-pi-tools.mjs');
    expect(piSchema.packages).not.toContain('npm:pi-serena-tools');
    expect(piTemplate.packages).not.toContain('npm:pi-serena-tools');
    expect(JSON.stringify(settings)).not.toMatch(/mcp__serena__/i);
    expect(JSON.stringify(hooks)).not.toMatch(/serena/i);
    expect(await fs.pathExists(path.join(repoRoot, '.xtrm', 'skills', 'default', 'documenting', 'SKILL.md'))).toBe(false);
  });

  it('adds a Codex runtime state without changing the schema discriminator', async () => {
    const defaults = createDefaultSkillsState() as unknown as {
      schemaVersion: string;
      enabledPacks: { codex?: string[] };
      managedLinks: { codex?: Record<string, string> };
    };

    expect(defaults.schemaVersion).toBe('2');
    expect(defaults.enabledPacks.codex).toEqual([]);
    expect(defaults.managedLinks.codex).toEqual({});
  });

  it('migrates an existing v2 state to empty Codex ownership in memory', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xtrm-codex-k4-state-'));
    roots.push(root);
    const skillsRoot = path.join(root, '.xtrm', 'skills');
    await fs.outputJson(path.join(skillsRoot, 'state.json'), {
      schemaVersion: '2',
      enabledPacks: { claude: ['existing'], pi: [] },
      managedLinks: { claude: {}, pi: {} },
    });

    const state = await readSkillsState(skillsRoot) as unknown as {
      enabledPacks: { codex?: string[] };
      managedLinks: { codex?: Record<string, string> };
    };
    expect(state.enabledPacks.codex).toEqual([]);
    expect(state.managedLinks.codex).toEqual({});
  });

  it('projects defaults and enabled packs into .agents/skills while preserving unowned entries', async () => {
    const { projectRoot, globalRoot, state, packs } = await fixture();
    const userSkill = path.join(projectRoot, '.agents', 'skills', 'user-owned');
    await fs.outputFile(path.join(userSkill, 'SKILL.md'), '# user owned\n');

    const result = await reconcileRuntimeLinks({
      projectRoot,
      state,
      runtime: 'codex' as never,
      discoveredPacks: packs,
      globalDefaultRoot: path.join(globalRoot, 'default'),
      globalOptionalRoot: path.join(globalRoot, 'optional'),
    });

    const runtimeRoot = path.join(projectRoot, '.agents', 'skills');
    expect((await fs.readdir(runtimeRoot)).sort()).toEqual(['always-on', 'project-tool', 'user-owned']);
    expect((await fs.lstat(path.join(runtimeRoot, 'always-on'))).isSymbolicLink()).toBe(true);
    expect((await fs.lstat(path.join(runtimeRoot, 'project-tool'))).isSymbolicLink()).toBe(true);
    expect((await fs.lstat(userSkill)).isDirectory()).toBe(true);
    expect((result.state.managedLinks as unknown as { codex: Record<string, string> }).codex).toEqual({
      'always-on': path.relative(projectRoot, path.join(globalRoot, 'default', 'always-on')),
      'project-tool': '.xtrm/skills/local/project-tool',
    });
  });

  it('reports a project Codex view as ready only when its owned links resolve', async () => {
    const { projectRoot, globalRoot, state, packs } = await fixture();
    await reconcileRuntimeLinks({
      projectRoot,
      state,
      runtime: 'codex' as never,
      discoveredPacks: packs,
      globalDefaultRoot: path.join(globalRoot, 'default'),
      globalOptionalRoot: path.join(globalRoot, 'optional'),
    });

    const check = await checkRuntimeSkillsViews(projectRoot) as unknown as {
      projectCodexSkillsReady?: boolean;
      projectCodexPointerState?: string;
    };
    expect(check.projectCodexSkillsReady).toBe(true);
    expect(check.projectCodexPointerState).toBe('ready');
  });
});
