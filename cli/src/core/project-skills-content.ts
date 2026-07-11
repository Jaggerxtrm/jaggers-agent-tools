import fs from 'fs-extra';
import path from 'node:path';
import { hasServiceRegistry } from './service-skills-ensure.js';
import { resolveSkillsRoot, resolveUserPacksRoot } from './skills-layout.js';

export async function hasProjectScopedSkillsContent(projectRoot: string): Promise<boolean> {
  const packsRoot = resolveUserPacksRoot(resolveSkillsRoot(projectRoot));
  const entries = await fs.readdir(packsRoot, { withFileTypes: true }).catch(() => [] as fs.Dirent[]);
  return entries.some((entry) => entry.isDirectory()) || hasServiceRegistry(projectRoot);
}
