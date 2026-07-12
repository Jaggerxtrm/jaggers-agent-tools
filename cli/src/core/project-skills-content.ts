import fs from 'fs-extra';
import path from 'node:path';
import { hasServiceRegistry } from './service-skills-ensure.js';
import { RESERVED_PACK_NAMES, resolveSkillsRoot } from './skills-layout.js';

export async function hasProjectScopedSkillsContent(projectRoot: string): Promise<boolean> {
  const skillsRoot = resolveSkillsRoot(projectRoot);
  const entries = await fs.readdir(skillsRoot, { withFileTypes: true }).catch(() => [] as fs.Dirent[]);
  const hasFlatPack = entries.some((entry) => entry.isDirectory() && !RESERVED_PACK_NAMES.has(entry.name));
  return hasFlatPack || hasServiceRegistry(projectRoot);
}
