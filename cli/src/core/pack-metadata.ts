import fs from 'fs-extra';
import path from 'node:path';
import { z } from 'zod';
import { PACK_FILE_NAME, type SkillsTier } from './skills-layout.js';

const packMetadataSchema = z.object({
  schemaVersion: z.literal('1').default('1'),
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().min(1),
  skills: z.array(z.string().min(1)).default([]),
});

export type PackMetadata = z.infer<typeof packMetadataSchema>;

export type PackMetadataMismatch = {
  readonly metadataOnlySkills: string[];
  readonly filesystemOnlySkills: string[];
};

function normalizeNames(names: readonly string[]): string[] {
  return [...new Set(names)].sort((left, right) => left.localeCompare(right));
}

export async function readPackMetadata(
  packRoot: string,
  tier: Exclude<SkillsTier, 'default'>,
): Promise<PackMetadata> {
  const metadataPath = path.join(packRoot, PACK_FILE_NAME);
  const packName = path.basename(packRoot);
  const metadata = packMetadataSchema.parse(await fs.readJson(metadataPath));

  if (metadata.name !== packName) {
    throw new Error(`Invalid pack metadata at ${metadataPath}: name must match directory '${packName}'.`);
  }
  if (tier === 'user' && metadata.name.startsWith('default-')) {
    throw new Error(`Invalid user pack metadata at ${metadataPath}: reserved 'default-' prefix.`);
  }

  return { ...metadata, skills: normalizeNames(metadata.skills) };
}

export function diffPackMetadataSkills(
  metadataSkills: readonly string[],
  filesystemSkills: readonly string[],
): PackMetadataMismatch {
  const metadataSet = new Set(metadataSkills);
  const filesystemSet = new Set(filesystemSkills);
  return {
    metadataOnlySkills: normalizeNames(metadataSkills.filter(name => !filesystemSet.has(name))),
    filesystemOnlySkills: normalizeNames(filesystemSkills.filter(name => !metadataSet.has(name))),
  };
}
