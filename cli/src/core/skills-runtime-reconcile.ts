import fs from 'fs-extra';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { DiscoveredPack, DiscoveredSkill } from './skill-discovery.js';
import { discoverDefaultSkills, discoverDirectSkills, discoverTierPacks } from './skill-discovery.js';
import { resolveSkillsRoot } from './skills-layout.js';
import { assertSafeRuntimeLinkName, writeSkillsState, type SkillsState } from './skills-state.js';
import type { SkillsRuntime } from './skills-layout.js';

export interface ReconcileRuntimeLinksOptions {
  readonly projectRoot: string;
  readonly state: SkillsState;
  readonly runtime: SkillsRuntime;
  readonly discoveredPacks: readonly DiscoveredPack[];
  readonly globalDefaultRoot: string;
  readonly globalOptionalRoot: string;
}

export interface RuntimeLinksReconcileResult {
  readonly runtime: SkillsRuntime;
  readonly desiredLinks: Record<string, string>;
  readonly removedLinks: string[];
  readonly state: SkillsState;
}

function isInside(child: string, parent: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveRuntimeLinkPath(runtimeDirectory: string, name: string): string {
  assertSafeRuntimeLinkName(name);
  const linkPath = path.resolve(runtimeDirectory, name);
  if (!isInside(linkPath, runtimeDirectory)) {
    throw new Error(`Runtime skill link '${name}' resolves outside runtime directory ${runtimeDirectory}.`);
  }
  return linkPath;
}

function targetRelativePath(projectRoot: string, target: string): string {
  return path.relative(projectRoot, target) || '.';
}

function getPackSkills(pack: DiscoveredPack, name: string): DiscoveredSkill[] {
  return pack.name === name ? pack.skills : [];
}

function resolveDesiredSkills(options: ReconcileRuntimeLinksOptions, defaults: readonly DiscoveredSkill[]): DiscoveredSkill[] {
  const enabledNames = options.state.enabledPacks[options.runtime];
  const matchingPacks = options.discoveredPacks.filter((pack) => enabledNames.includes(pack.name));
  const byName = new Map<string, DiscoveredPack>();
  for (const pack of matchingPacks) {
    const existing = byName.get(pack.name);
    if (existing && path.resolve(existing.path) !== path.resolve(pack.path)) {
      throw new Error(`Pack '${pack.name}' is present in more than one scope; remove same-name project/global packs before enabling it.`);
    }
    byName.set(pack.name, pack);
  }

  const globalOptionalPacks = matchingPacks.filter((pack) => path.resolve(path.dirname(pack.path)) === path.resolve(options.globalOptionalRoot));
  for (const pack of matchingPacks) {
    if (globalOptionalPacks.some((globalPack) => globalPack.name === pack.name && path.resolve(globalPack.path) !== path.resolve(pack.path))) {
      throw new Error(`Pack '${pack.name}' collides between project scope and global optional scope.`);
    }
  }

  const selected = matchingPacks.flatMap((pack) => getPackSkills(pack, pack.name));
  const seen = new Map<string, string>();
  for (const skill of [...defaults, ...selected]) {
    assertSafeRuntimeLinkName(skill.runtimeName);
    const first = seen.get(skill.runtimeName);
    if (first && first !== skill.path) {
      const against = defaults.some((entry) => entry.runtimeName === skill.runtimeName) ? 'global default' : 'another enabled pack';
      throw new Error(`Cannot enable skill '${skill.runtimeName}' for ${options.runtime}: name collides with ${against} (${first} vs ${skill.path}).`);
    }
    seen.set(skill.runtimeName, skill.path);
  }
  return options.runtime === 'codex' ? [...defaults, ...selected] : selected;
}

function runtimeSkillsDirectory(projectRoot: string, runtime: SkillsRuntime): string {
  if (runtime === 'claude') return path.join(projectRoot, '.claude', 'skills');
  if (runtime === 'pi') return path.join(projectRoot, '.pi', 'skills');
  return path.join(projectRoot, '.agents', 'skills');
}

async function ensureRuntimeDirectory(directory: string): Promise<void> {
  const existing = await fs.lstat(directory).catch(() => null);
  if (existing?.isSymbolicLink()) {
    throw new Error(`Refusing to replace user-owned runtime directory ${directory}.`);
  }
  if (existing && !existing.isDirectory()) {
    throw new Error(`Refusing to replace non-directory runtime path ${directory}.`);
  }
  await fs.ensureDir(directory);
}

async function atomicSymlink(target: string, linkPath: string): Promise<void> {
  const temporaryPath = `${linkPath}.tmp-${randomUUID()}`;
  await fs.symlink(target, temporaryPath);
  try {
    await fs.rename(temporaryPath, linkPath);
  } finally {
    await fs.remove(temporaryPath).catch(() => undefined);
  }
}

async function discoverManagedLinks(
  projectRoot: string,
  directory: string,
  expected: Readonly<Record<string, string>>,
  roots: readonly string[],
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => [] as fs.Dirent[]);
  for (const entry of entries) {
    const linkPath = resolveRuntimeLinkPath(directory, entry.name);
    const stat = await fs.lstat(linkPath).catch(() => null);
    if (!stat?.isSymbolicLink()) continue;
    const resolved = path.resolve(directory, await fs.readlink(linkPath));
    if (Object.prototype.hasOwnProperty.call(expected, entry.name) && roots.some((root) => isInside(resolved, root))) {
      // Claim v1 links by location, not exact target. Layout migration changes
      // `.xtrm/skills/user/packs/...` targets to v2 flat targets; reconcile owns
      // both so it can replace stale links and persist v2-relative ownership.
      result[entry.name] = targetRelativePath(projectRoot, resolved);
    }
  }
  return result;
}

export async function selectRuntimeSkills(runtime: SkillsRuntime, skillsRoot: string, state: Pick<SkillsState, 'enabledPacks'> & { managedLinks?: SkillsState['managedLinks'] }, additionalRoots: readonly string[] = []): Promise<{ runtime: SkillsRuntime; enabledPacks: string[]; skills: DiscoveredSkill[] }> {
  const roots = [skillsRoot, ...additionalRoots];
  const normalizedState: SkillsState = {
    schemaVersion: '2',
    enabledPacks: state.enabledPacks,
    managedLinks: state.managedLinks ?? { claude: {}, pi: {}, codex: {} },
  };
  const packs = (await Promise.all(roots.map(async (root) => [
    ...(await discoverTierPacks(root, 'optional')),
    ...(await discoverTierPacks(root, 'user')),
  ]))).flat();
  const defaults = await discoverDefaultSkills(skillsRoot);
  const desired = resolveDesiredSkills({ projectRoot: path.dirname(path.dirname(skillsRoot)), state: normalizedState, runtime, discoveredPacks: packs, globalDefaultRoot: skillsRoot, globalOptionalRoot: path.join(skillsRoot, 'optional') }, defaults);
  const skills = runtime === 'codex' ? desired : [...defaults, ...desired];
  return { runtime, enabledPacks: [...normalizedState.enabledPacks[runtime]], skills };
}

export async function reconcileRuntimeLinks(options: ReconcileRuntimeLinksOptions): Promise<RuntimeLinksReconcileResult> {
  const { projectRoot, runtime, state, globalDefaultRoot, globalOptionalRoot } = options;
  const runtimeDirectory = runtimeSkillsDirectory(projectRoot, runtime);
  const defaults = await discoverDirectSkills(globalDefaultRoot);
  const selected = resolveDesiredSkills(options, defaults);
  const desiredLinks: Record<string, string> = {};
  for (const skill of selected) {
    resolveRuntimeLinkPath(runtimeDirectory, skill.runtimeName);
    desiredLinks[skill.runtimeName] = path.resolve(skill.path);
  }

  const oldManifest = state.managedLinks?.[runtime] ?? {};
  for (const name of Object.keys(oldManifest)) resolveRuntimeLinkPath(runtimeDirectory, name);
  await ensureRuntimeDirectory(runtimeDirectory);
  const roots = [path.join(projectRoot, '.xtrm', 'skills'), globalDefaultRoot, globalOptionalRoot];
  const bootstrapped = Object.keys(oldManifest).length === 0
    ? await discoverManagedLinks(projectRoot, runtimeDirectory, desiredLinks, roots)
    : {};
  const managed = { ...bootstrapped, ...oldManifest };
  const removedLinks: string[] = [];

  for (const [name, relativeTarget] of Object.entries(managed)) {
    if (desiredLinks[name]) continue;
    const linkPath = resolveRuntimeLinkPath(runtimeDirectory, name);
    const stat = await fs.lstat(linkPath).catch(() => null);
    if (stat?.isSymbolicLink()) {
      const resolved = path.resolve(runtimeDirectory, await fs.readlink(linkPath));
      const recorded = path.resolve(projectRoot, relativeTarget);
      if (resolved === recorded && roots.some((root) => isInside(resolved, root))) await fs.remove(linkPath);
    }
    removedLinks.push(name);
  }

  for (const [name, target] of Object.entries(desiredLinks)) {
    const linkPath = resolveRuntimeLinkPath(runtimeDirectory, name);
    const existing = await fs.lstat(linkPath).catch(() => null);
    const tracked = Object.prototype.hasOwnProperty.call(managed, name);
    if (existing && !tracked) {
      if (!existing.isSymbolicLink() || path.resolve(runtimeDirectory, await fs.readlink(linkPath)) !== target) {
        throw new Error(`Cannot enable skill '${name}': ${linkPath} is user-owned.`);
      }
    }
    if (existing?.isSymbolicLink() && path.resolve(runtimeDirectory, await fs.readlink(linkPath)) === target) {
      // Symlink already points at the desired target string. Verify the target actually resolves
      // on disk; a broken symlink (points at a since-removed path) must be re-materialized rather
      // than left dangling. (xtrm-4cqxc: mercury repos surfaced this on v2 migration.)
      const targetExists = await fs.pathExists(target);
      if (targetExists) continue;
      await fs.remove(linkPath);
    } else if (existing && !existing.isSymbolicLink()) {
      throw new Error(`Cannot replace non-symlink managed entry ${linkPath}.`);
    }
    await atomicSymlink(target, linkPath);
  }

  const nextManaged = Object.fromEntries(Object.entries(desiredLinks).map(([name, target]) => [name, targetRelativePath(projectRoot, target)]));
  const nextState: SkillsState = { ...state, managedLinks: { ...state.managedLinks, [runtime]: nextManaged } };
  const persisted = await writeSkillsState(resolveSkillsRoot(projectRoot), nextState);
  Object.assign(state, persisted);
  return { runtime, desiredLinks: nextManaged, removedLinks, state: persisted };
}
