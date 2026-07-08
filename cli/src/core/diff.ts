import { join, normalize } from 'path';
import fs from 'fs-extra';
import { hashDirectory, getNewestMtime } from '../utils/hash.js';
import type { ChangeSet } from '../types/config.js';
import { detectAdapter } from '../adapters/registry.js';

// Items to ignore from diff scanning (similar to .gitignore)
const IGNORED_ITEMS = new Set(['__pycache__', '.DS_Store', 'Thumbs.db', '.gitkeep', 'node_modules']);

export class PruneModeReadError extends Error {
    constructor(path: string) {
        super(`Cannot read ${path} in prune mode — aborting to prevent accidental deletion`);
        this.name = 'PruneModeReadError';
    }
}

export async function calculateDiff(repoRoot: string, systemRoot: string, pruneMode: boolean = false): Promise<ChangeSet> {
    const adapter = detectAdapter(systemRoot);
    const isClaude = adapter?.toolName === 'claude-code';

    const changeSet: ChangeSet = {
        skills: { missing: [], outdated: [], drifted: [], total: 0 },
        hooks: { missing: [], outdated: [], drifted: [], total: 0 },
        config: { missing: [], outdated: [], drifted: [], total: 0 },
        commands: { missing: [], outdated: [], drifted: [], total: 0 },
    };

    // Load installed file hashes from manifest for precise drift classification
    const manifestPath = join(systemRoot, '.jaggers-sync-manifest.json');
    let installedHashes: Record<string, string> | null = null;
    try {
        if (await fs.pathExists(manifestPath)) {
            const manifest = await fs.readJson(manifestPath);
            if (manifest.fileHashes && typeof manifest.fileHashes === 'object') {
                installedHashes = manifest.fileHashes;
            }
        }
    } catch {
        // Manifest unreadable — fall back to mtime heuristic
    }

    // 1. Folders: Skills & Hooks & Commands
    const folders = ['skills', 'hooks'];
    if (!isClaude) folders.push('commands');

    for (const category of folders) {
        const repoPath = join(repoRoot, category);
        const systemPath = join(systemRoot, category);

        if (!(await fs.pathExists(repoPath))) continue;

        const items = (await fs.readdir(repoPath)).filter(i => !IGNORED_ITEMS.has(i));
        (changeSet[category as keyof ChangeSet] as any).total = items.length;

        for (const item of items) {
            await compareItem(
                category as keyof ChangeSet,
                item,
                join(repoPath, item),
                join(systemPath, item),
                changeSet,
                pruneMode,
                installedHashes,
            );
        }
    }

    // 2. Config Files (Explicit Mapping)
    const configMapping = {
        'settings.json': { repo: 'config/settings.json', sys: 'settings.json' },
    };

    for (const [name, paths] of Object.entries(configMapping)) {
        // settings.json is path-transformed on install for all agent environments,
        // so the hash always differs — skip to prevent perpetual false "1 update"
        if (name === 'settings.json' && adapter !== null) continue;

        const itemRepoPath = join(repoRoot, paths.repo);
        const itemSystemPath = join(systemRoot, paths.sys);

        if (await fs.pathExists(itemRepoPath)) {
            await compareItem('config', name, itemRepoPath, itemSystemPath, changeSet, false, installedHashes);
        }
    }

    return changeSet;
}

async function compareItem(
    category: keyof ChangeSet,
    item: string,
    repoPath: string,
    systemPath: string,
    changeSet: ChangeSet,
    pruneMode: boolean = false,
    installedHashes: Record<string, string> | null = null,
): Promise<void> {
    const cat = changeSet[category] as any;

    if (!(await fs.pathExists(systemPath))) {
        cat.missing.push(item);
        return;
    }

    const repoHash = await hashDirectory(repoPath);

    // Wrap system-side hash read in try/catch for prune mode safety
    let systemHash: string;
    try {
        systemHash = await hashDirectory(systemPath);
    } catch (error) {
        if (pruneMode) {
            throw new PruneModeReadError(systemPath);
        }
        // If not in prune mode, treat as missing
        cat.missing.push(item);
        return;
    }

    if (repoHash !== systemHash) {
        const manifestKey = `${category}/${item}`;
        const installedHash = installedHashes?.[manifestKey];

        if (installedHash !== undefined) {
            // Manifest-based classification: compare system against installed snapshot
            if (systemHash !== installedHash) {
                // System was modified after last install → drifted (local changes)
                cat.drifted.push(item);
            } else {
                // System matches install snapshot but repo changed → outdated
                cat.outdated.push(item);
            }
        } else {
            // No manifest data: fall back to mtime heuristic
            const repoMtime = await getNewestMtime(repoPath);
            const systemMtime = await getNewestMtime(systemPath);

            if (systemMtime > repoMtime + 2000) {
                cat.drifted.push(item);
            } else {
                cat.outdated.push(item);
            }
        }
    }
}
