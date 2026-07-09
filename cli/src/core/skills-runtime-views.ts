import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { hasServiceRegistry } from './service-skills-ensure.js';
import { resolveGlobalSkillsRoot, resolveSkillsRoot, resolveUserPacksRoot } from './skills-layout.js';

interface PiSettings {
  skills?: string[];
}

type RuntimePointerState = 'ready' | 'skipped' | 'missing';
type RuntimeScope = 'global' | 'project' | 'both';

export interface RuntimeViewCheckResult {
  readonly activeReady: boolean;
  readonly globalClaudePointerReady: boolean;
  readonly globalPiPointerReady: boolean;
  readonly projectClaudePointerState: RuntimePointerState;
  readonly projectPiPointerState: RuntimePointerState;
  readonly activeEntries: string[];
}

export function getRuntimePointerTarget(options: { scope: 'global' | 'project' }): string {
  return options.scope === 'global'
    ? path.join(os.homedir(), '.xtrm', 'skills', 'active')
    : path.join('..', '.xtrm', 'skills', 'active');
}

async function readSymlinkTarget(linkPath: string): Promise<string | null> {
  const stat = await fs.lstat(linkPath).catch(() => null);
  if (!stat?.isSymbolicLink()) {
    return null;
  }

  return fs.readlink(linkPath);
}

async function hasExpectedSymlink(linkPath: string, expectedTarget: string): Promise<boolean> {
  const currentTarget = await readSymlinkTarget(linkPath);
  if (currentTarget !== expectedTarget) {
    return false;
  }

  const resolvedTarget = path.resolve(path.dirname(linkPath), currentTarget);
  return fs.pathExists(resolvedTarget);
}

async function listRuntimeEntries(runtimeRoot: string): Promise<string[]> {
  const stat = await fs.lstat(runtimeRoot).catch(() => null);
  if (!stat?.isDirectory()) {
    return [];
  }

  return (await fs.readdir(runtimeRoot)).sort((a, b) => a.localeCompare(b));
}

async function hasOnlyValidSymlinkEntries(runtimeRoot: string, names: readonly string[]): Promise<boolean> {
  for (const name of names) {
    const entryPath = path.join(runtimeRoot, name);
    const stat = await fs.lstat(entryPath).catch(() => null);
    if (!stat?.isSymbolicLink()) {
      return false;
    }

    const linkTarget = await fs.readlink(entryPath);
    const resolvedTarget = path.resolve(path.dirname(entryPath), linkTarget);
    if (!await fs.pathExists(resolvedTarget)) {
      return false;
    }
  }

  return true;
}

async function readPiSkillsEntries(projectRoot: string): Promise<string[]> {
  const settingsPath = path.join(projectRoot, '.pi', 'settings.json');
  if (!await fs.pathExists(settingsPath)) {
    return [];
  }

  const settings = await fs.readJson(settingsPath).catch(() => ({} as PiSettings)) as PiSettings;
  return Array.isArray(settings.skills) ? settings.skills : [];
}

async function hasProjectScopedSkillsContent(projectRoot: string): Promise<boolean> {
  const packsRoot = resolveUserPacksRoot(resolveSkillsRoot(projectRoot));
  const packEntries = await fs.readdir(packsRoot, { withFileTypes: true }).catch(() => [] as fs.Dirent[]);
  if (packEntries.some((entry) => entry.isDirectory())) {
    return true;
  }

  return hasServiceRegistry(projectRoot);
}

export async function checkRuntimeSkillsViews(projectRoot: string): Promise<RuntimeViewCheckResult> {
  const activeRoot = path.join(projectRoot, '.xtrm', 'skills', 'active');
  const activeEntries = await listRuntimeEntries(activeRoot);
  const activeReady = activeEntries.length > 0 && await hasOnlyValidSymlinkEntries(activeRoot, activeEntries);

  const globalClaudePointerReady = await hasExpectedSymlink(
    path.join(os.homedir(), '.claude', 'skills'),
    getRuntimePointerTarget({ scope: 'global' }),
  );
  const globalPiPointerReady = await hasExpectedSymlink(
    path.join(os.homedir(), '.pi', 'agent', 'skills'),
    getRuntimePointerTarget({ scope: 'global' }),
  );

  const projectClaudePointerReady = await hasExpectedSymlink(
    path.join(projectRoot, '.claude', 'skills'),
    getRuntimePointerTarget({ scope: 'project' }),
  );
  const projectPiSkills = await readPiSkillsEntries(projectRoot);
  const projectPiPointerReady = projectPiSkills.includes(getRuntimePointerTarget({ scope: 'project' }));
  const projectHasLocalSkills = await hasProjectScopedSkillsContent(projectRoot);
  const projectCanUseGlobal = await fs.pathExists(path.join(resolveGlobalSkillsRoot(), 'active')) && globalClaudePointerReady && globalPiPointerReady;

  const projectClaudePointerState = projectHasLocalSkills
    ? (projectClaudePointerReady ? 'ready' : 'missing')
    : (projectClaudePointerReady ? 'ready' : (projectCanUseGlobal ? 'skipped' : 'missing'));
  const projectPiPointerState = projectHasLocalSkills
    ? (projectPiPointerReady ? 'ready' : 'missing')
    : (projectPiPointerReady ? 'ready' : (projectCanUseGlobal ? 'skipped' : 'missing'));

  return {
    activeReady,
    globalClaudePointerReady,
    globalPiPointerReady,
    projectClaudePointerState,
    projectPiPointerState,
    activeEntries,
  };
}

export async function assertRuntimeSkillsViews(projectRoot: string, options: { scope?: RuntimeScope } = {}): Promise<void> {
  const scope = options.scope ?? 'both';
  const check = await checkRuntimeSkillsViews(projectRoot);

  const failures: string[] = [];
  // Project active view is only asserted when the project is expected to
  // materialise its own skills (scope !== 'global'). Under XTRM_GLOBAL_SKILLS,
  // the project active view is legitimately empty.
  if (scope !== 'global' && !check.activeReady) failures.push('active view is missing, empty, or contains invalid links');
  if ((scope === 'global' || scope === 'both') && !check.globalClaudePointerReady) failures.push(`~/.claude/skills is not linked to ${getRuntimePointerTarget({ scope: 'global' })}`);
  if ((scope === 'global' || scope === 'both') && !check.globalPiPointerReady) failures.push(`~/.pi/agent/skills is not linked to ${getRuntimePointerTarget({ scope: 'global' })}`);
  if ((scope === 'project' || scope === 'both') && check.projectClaudePointerState === 'missing') failures.push(`.claude/skills is not linked to ${getRuntimePointerTarget({ scope: 'project' })}`);
  if ((scope === 'project' || scope === 'both') && check.projectPiPointerState === 'missing') failures.push(`.pi/settings.json.skills does not include ${getRuntimePointerTarget({ scope: 'project' })}`);

  if (failures.length > 0) {
    throw new Error(`Runtime skills view validation failed: ${failures.join('; ')}`);
  }
}
