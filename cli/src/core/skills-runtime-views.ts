import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { resolveDefaultTierRoot, resolveGlobalSkillsRoot, resolveSkillsRoot } from './skills-layout.js';
import { readSkillsState } from './skills-state.js';

export interface RuntimeViewCheckResult {
  readonly activeReady: boolean;
  readonly globalClaudePointerReady: boolean;
  readonly globalPiPointerReady: boolean;
  readonly projectClaudePointerState: 'ready' | 'skipped' | 'missing';
  readonly projectPiPointerState: 'ready' | 'skipped' | 'missing';
  readonly activeEntries: string[];
  readonly projectClaudeSkillsReady: boolean;
  readonly projectPiSkillsReady: boolean;
}
type RuntimeScope = 'global' | 'project' | 'both';

export function getRuntimePointerTarget(options: { scope: 'global' | 'project' }): string {
  return options.scope === 'global' ? resolveDefaultTierRoot(resolveGlobalSkillsRoot()) : 'real .claude/skills and .pi/skills directories';
}

async function pointsTo(link: string, target: string): Promise<boolean> {
  const stat = await fs.lstat(link).catch(() => null);
  if (!stat?.isSymbolicLink()) return false;
  return path.resolve(path.dirname(link), await fs.readlink(link)) === path.resolve(target) && await fs.pathExists(target);
}

async function isRealDirectory(dir: string): Promise<boolean> {
  const stat = await fs.lstat(dir).catch(() => null);
  return Boolean(stat?.isDirectory() && !stat.isSymbolicLink());
}

async function managedEntries(projectRoot: string, runtime: 'claude' | 'pi'): Promise<string[]> {
  const state = await readSkillsState(resolveSkillsRoot(projectRoot));
  const dir = path.join(projectRoot, runtime === 'claude' ? '.claude' : '.pi', 'skills');
  const names = Object.keys(state.managedLinks[runtime]);
  for (const name of names) {
    const stat = await fs.lstat(path.join(dir, name)).catch(() => null);
    if (!stat?.isSymbolicLink()) return [];
  }
  return names;
}

export async function checkRuntimeSkillsViews(projectRoot: string): Promise<RuntimeViewCheckResult> {
  const globalDefault = resolveDefaultTierRoot(resolveGlobalSkillsRoot());
  const globalClaudePointerReady = await pointsTo(path.join(os.homedir(), '.claude', 'skills'), globalDefault);
  const globalPiPointerReady = await pointsTo(path.join(os.homedir(), '.pi', 'agent', 'skills'), globalDefault);
  const projectClaudeSkillsReady = await isRealDirectory(path.join(projectRoot, '.claude', 'skills')) && await managedEntries(projectRoot, 'claude').then(() => true);
  const projectPiSkillsReady = await isRealDirectory(path.join(projectRoot, '.pi', 'skills')) && await managedEntries(projectRoot, 'pi').then(() => true);
  const projectClaudePointerState = projectClaudeSkillsReady ? 'ready' : 'skipped';
  const projectPiPointerState = projectPiSkillsReady ? 'ready' : 'skipped';
  return {
    activeReady: projectClaudeSkillsReady && projectPiSkillsReady,
    globalClaudePointerReady,
    globalPiPointerReady,
    projectClaudePointerState,
    projectPiPointerState,
    activeEntries: [],
    projectClaudeSkillsReady,
    projectPiSkillsReady,
  };
}

export async function assertRuntimeSkillsViews(projectRoot: string, options: { scope?: RuntimeScope } = {}): Promise<void> {
  const scope = options.scope ?? 'both';
  const check = await checkRuntimeSkillsViews(projectRoot);
  const failures: string[] = [];
  if ((scope === 'global' || scope === 'both') && !check.globalClaudePointerReady) failures.push(`~/.claude/skills is not linked to ${getRuntimePointerTarget({ scope: 'global' })}`);
  if ((scope === 'global' || scope === 'both') && !check.globalPiPointerReady) failures.push(`~/.pi/agent/skills is not linked to ${getRuntimePointerTarget({ scope: 'global' })}`);
  if ((scope === 'project' || scope === 'both') && !check.projectClaudeSkillsReady) failures.push('.claude/skills is not a real reconciled directory');
  if ((scope === 'project' || scope === 'both') && !check.projectPiSkillsReady) failures.push('.pi/skills is not a real reconciled directory');
  if (failures.length > 0) throw new Error(`Runtime skills validation failed: ${failures.join('; ')}`);
}
