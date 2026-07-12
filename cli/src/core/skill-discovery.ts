import fs from 'fs-extra';
import path from 'node:path';
import {
  RUNTIME_ROOT_MARKERS,
  SKILL_FILE_NAME,
  type SkillsTier,
  resolveDefaultTierRoot,
  resolveOptionalTierRoot,
  resolveUserPacksRoot,
  RESERVED_PACK_NAMES,
} from './skills-layout.js';
import { assertSafeRuntimeLinkName } from './skills-state.js';
import { diffPackMetadataSkills, readPackMetadata, type PackMetadataMismatch } from './pack-metadata.js';

export type DiscoveredSkill = {
  /** Directory identity, or pack name for a root SKILL.md. */
  readonly name: string;
  /** Runtime skill name from SKILL.md frontmatter `name:`. */
  readonly runtimeName: string;
  readonly path: string;
};

export type InvariantViolationCode =
  | 'SKILL_AND_PACK_CONFLICT'
  | 'NESTED_RUNTIME_ROOT'
  | 'PACK_METADATA_MISMATCH'
  | 'PACK_NAME_COLLISION';

export type InvariantViolation = {
  readonly code: InvariantViolationCode;
  readonly path: string;
  readonly message: string;
};

export type DiscoveredPack = {
  readonly name: string;
  readonly path: string;
  readonly tier: Exclude<SkillsTier, 'default'>;
  readonly skills: DiscoveredSkill[];
  readonly metadataMismatch?: PackMetadataMismatch;
};

const warnedMessages = new Set<string>();

function warnOnce(key: string, message: string): void {
  if (warnedMessages.has(key)) return;
  warnedMessages.add(key);
  console.warn(`[xtrm] Warning: ${message}`);
}

async function listDirectChildDirectories(root: string): Promise<string[]> {
  if (!await fs.pathExists(root)) return [];
  const entries = await fs.readdir(root, { withFileTypes: true });
  return entries
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

async function hasFile(dirPath: string, fileName: string): Promise<boolean> {
  return fs.pathExists(path.join(dirPath, fileName));
}

async function hasNestedRuntimeRoot(dirPath: string): Promise<boolean> {
  for (const marker of RUNTIME_ROOT_MARKERS) {
    if (await hasFile(dirPath, marker)) return true;
  }
  return false;
}

export async function detectDirectChildSkill(dirPath: string): Promise<boolean> {
  return hasFile(dirPath, SKILL_FILE_NAME);
}

async function readSkillFrontmatterName(skillFilePath: string): Promise<string | null> {
  let content: string;
  try {
    content = await fs.readFile(skillFilePath, 'utf8');
  } catch {
    return null;
  }

  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!frontmatter) return null;
  const nameLine = frontmatter[1].split(/\r?\n/).find(line => /^name\s*:/.test(line));
  if (!nameLine) return null;
  return nameLine.replace(/^name\s*:/, '').trim().replace(/^["']|["']$/g, '').trim() || null;
}

async function discoverSkill(skillPath: string, name: string): Promise<DiscoveredSkill> {
  const frontmatterName = await readSkillFrontmatterName(path.join(skillPath, SKILL_FILE_NAME));
  const runtimeName = frontmatterName ?? name;
  assertSafeRuntimeLinkName(runtimeName);
  return { name, runtimeName, path: skillPath };
}

export async function discoverDirectSkills(root: string): Promise<DiscoveredSkill[]> {
  const discoveredSkills: DiscoveredSkill[] = [];
  for (const childDirectory of await listDirectChildDirectories(root)) {
    const skillPath = path.join(root, childDirectory);
    if (await detectDirectChildSkill(skillPath)) {
      discoveredSkills.push(await discoverSkill(skillPath, childDirectory));
    }
  }
  return discoveredSkills;
}

async function discoverPackSkills(packPath: string, packName: string): Promise<DiscoveredSkill[]> {
  const skills: DiscoveredSkill[] = [];
  if (await hasFile(packPath, SKILL_FILE_NAME)) {
    skills.push(await discoverSkill(packPath, packName));
  }
  skills.push(...await discoverDirectSkills(packPath));
  return skills;
}

function isReservedPackName(name: string): boolean {
  return RESERVED_PACK_NAMES.has(name);
}

async function discoverPack(
  packPath: string,
  tier: Exclude<SkillsTier, 'default'>,
  validateMetadata: boolean,
): Promise<DiscoveredPack> {
  const packName = path.basename(packPath);
  const metadataPath = path.join(packPath, 'PACK.json');
  const skills = await discoverPackSkills(packPath, packName);
  let metadataMismatch: PackMetadataMismatch | undefined;

  if (validateMetadata && await fs.pathExists(metadataPath)) {
    const metadata = await readPackMetadata(packPath, tier);
    metadataMismatch = diffPackMetadataSkills(metadata.skills, skills.map(skill => skill.name));
  }
  if (!validateMetadata && await fs.pathExists(metadataPath)) {
    warnOnce(`pack-json:${path.resolve(packPath)}`, `${metadataPath} is ignored; PACK.json is retired in v2.`);
  }

  return { name: packName, path: packPath, tier, skills, metadataMismatch };
}

async function discoverFlatPacks(skillsRoot: string): Promise<DiscoveredPack[]> {
  const packs: DiscoveredPack[] = [];
  for (const packName of await listDirectChildDirectories(skillsRoot)) {
    if (isReservedPackName(packName)) continue;
    packs.push(await discoverPack(path.join(skillsRoot, packName), 'user', false));
  }
  return packs;
}

async function discoverLegacyPacks(skillsRoot: string): Promise<DiscoveredPack[]> {
  const legacyRoot = resolveUserPacksRoot(skillsRoot);
  const packs: DiscoveredPack[] = [];
  for (const packName of await listDirectChildDirectories(legacyRoot)) {
    if (isReservedPackName(packName)) continue;
    packs.push(await discoverPack(path.join(legacyRoot, packName), 'user', true));
  }
  return packs;
}

/** Discover project packs from v2 flat layout, with v1 user/packs shim. */
export async function discoverRepoPacks(skillsRoot: string): Promise<DiscoveredPack[]> {
  const flatPacks = await discoverFlatPacks(skillsRoot);
  const legacyPacks = await discoverLegacyPacks(skillsRoot);
  if (legacyPacks.length > 0) {
    warnOnce(`legacy-root:${path.resolve(skillsRoot)}`, `v1 skills layout found under ${resolveUserPacksRoot(skillsRoot)}; migrate with xt migrate skills-layout --apply.`);
  }

  const flatNames = new Set(flatPacks.map(pack => pack.name));
  for (const legacyPack of legacyPacks) {
    if (flatNames.has(legacyPack.name)) {
      warnOnce(
        `collision:${path.resolve(skillsRoot)}:${legacyPack.name}`,
        `v2 pack '${legacyPack.name}' at ${path.join(skillsRoot, legacyPack.name)} wins over v1 pack at ${legacyPack.path}.`,
      );
      continue;
    }
    flatPacks.push(legacyPack);
  }
  return flatPacks.sort((left, right) => left.name.localeCompare(right.name));
}

/** Compatibility entry point. User-tier discovery uses v2 repo packs; optional keeps global v1 tier support. */
export async function discoverTierPacks(
  skillsRoot: string,
  tier: Exclude<SkillsTier, 'default'>,
): Promise<DiscoveredPack[]> {
  if (tier === 'user') return discoverRepoPacks(skillsRoot);
  const packs: DiscoveredPack[] = [];
  for (const packName of await listDirectChildDirectories(resolveOptionalTierRoot(skillsRoot))) {
    const packPath = path.join(resolveOptionalTierRoot(skillsRoot), packName);
    if (!await fs.pathExists(path.join(packPath, 'PACK.json'))) continue;
    packs.push(await discoverPack(packPath, 'optional', true));
  }
  return packs;
}

export async function discoverDefaultSkills(skillsRoot: string): Promise<DiscoveredSkill[]> {
  return discoverDirectSkills(resolveDefaultTierRoot(skillsRoot));
}

export async function validateSkillsInvariants(skillsRoot: string): Promise<InvariantViolation[]> {
  const violations: InvariantViolation[] = [];
  const defaultSkills = await discoverDefaultSkills(skillsRoot);
  for (const skill of defaultSkills) {
    if (await hasNestedRuntimeRoot(skill.path)) {
      violations.push({ code: 'NESTED_RUNTIME_ROOT', path: skill.path, message: `Skill '${skill.name}' contains a nested runtime root directory (.claude/.agents/.pi).` });
    }
  }

  const packs = [
    ...(await discoverTierPacks(skillsRoot, 'optional')),
    ...(await discoverRepoPacks(skillsRoot)),
  ];
  const seenNames = new Map<string, string>();
  for (const pack of packs) {
    const existing = seenNames.get(pack.name);
    if (existing) {
      violations.push({ code: 'PACK_NAME_COLLISION', path: pack.path, message: `Pack '${pack.name}' collides with '${existing}'.` });
    } else {
      seenNames.set(pack.name, pack.path);
    }
    for (const skill of pack.skills) {
      if (await hasNestedRuntimeRoot(skill.path)) {
        violations.push({ code: 'NESTED_RUNTIME_ROOT', path: skill.path, message: `Pack skill '${pack.name}/${skill.name}' contains a nested runtime root directory (.claude/.agents/.pi).` });
      }
    }
    const mismatch = pack.metadataMismatch;
    if (mismatch && (mismatch.metadataOnlySkills.length > 0 || mismatch.filesystemOnlySkills.length > 0)) {
      violations.push({
        code: 'PACK_METADATA_MISMATCH',
        path: pack.path,
        message: `Pack '${pack.name}' metadata skills do not match filesystem (metadata-only: ${mismatch.metadataOnlySkills.join(', ') || 'none'}, filesystem-only: ${mismatch.filesystemOnlySkills.join(', ') || 'none'}).`,
      });
    }
  }
  return violations;
}
