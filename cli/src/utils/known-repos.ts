import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';

interface KnownRepoEntry {
  migratedAt: string;
  skillsMigrated: boolean;
  hooksMigrated: boolean;
  backupPath?: string;
}

interface KnownReposData {
  repos: Record<string, KnownRepoEntry>;
}

function resolveKnownReposPath(): string {
  return path.join(os.homedir(), '.xtrm', 'known-repos.json');
}

async function readKnownRepos(): Promise<KnownReposData> {
  const knownReposPath = resolveKnownReposPath();
  if (!await fs.pathExists(knownReposPath)) {
    return { repos: {} };
  }

  try {
    const data = await fs.readJson(knownReposPath) as KnownReposData;
    return { repos: data.repos ?? {} };
  } catch {
    return { repos: {} };
  }
}

async function writeKnownRepos(data: KnownReposData): Promise<void> {
  const knownReposPath = resolveKnownReposPath();
  await fs.ensureDir(path.dirname(knownReposPath));
  await fs.writeJson(knownReposPath, data, { spaces: 2 });
  await fs.appendFile(knownReposPath, '\n');
}

export async function markRepoMigrated(
  repoPath: string,
  opts: { skillsMigrated?: boolean; hooksMigrated?: boolean; backupPath?: string },
): Promise<void> {
  const data = await readKnownRepos();
  const normalizedPath = path.resolve(repoPath);

  const existing = data.repos[normalizedPath] ?? {
    migratedAt: new Date().toISOString(),
    skillsMigrated: false,
    hooksMigrated: false,
  };

  data.repos[normalizedPath] = {
    ...existing,
    migratedAt: new Date().toISOString(),
    skillsMigrated: opts.skillsMigrated ?? existing.skillsMigrated,
    hooksMigrated: opts.hooksMigrated ?? existing.hooksMigrated,
    backupPath: opts.backupPath ?? existing.backupPath,
  };

  await writeKnownRepos(data);
}

export async function isRepoMigrated(
  repoPath: string,
  opts: { skills?: boolean; hooks?: boolean },
): Promise<boolean> {
  const data = await readKnownRepos();
  const normalizedPath = path.resolve(repoPath);
  const entry = data.repos[normalizedPath];

  if (!entry) {
    return false;
  }

  if (opts.skills && !entry.skillsMigrated) {
    return false;
  }

  if (opts.hooks && !entry.hooksMigrated) {
    return false;
  }

  return true;
}

// Sync variant for hot paths (global-skills-flag). Reads the JSON on every
// call — the file is tiny (<1KB fleet-scale) and this only fires during
// install/update/skills-enable, not per-render.
export function isRepoMigratedSync(
  repoPath: string,
  opts: { skills?: boolean; hooks?: boolean },
): boolean {
  const knownReposPath = resolveKnownReposPath();
  if (!fs.pathExistsSync(knownReposPath)) return false;
  let data: KnownReposData;
  try {
    data = fs.readJsonSync(knownReposPath) as KnownReposData;
  } catch {
    return false;
  }
  const normalizedPath = path.resolve(repoPath);
  const entry = data.repos?.[normalizedPath];
  if (!entry) return false;
  if (opts.skills && !entry.skillsMigrated) return false;
  if (opts.hooks && !entry.hooksMigrated) return false;
  return true;
}

export async function getKnownRepos(): Promise<Record<string, KnownRepoEntry>> {
  const data = await readKnownRepos();
  return data.repos;
}
