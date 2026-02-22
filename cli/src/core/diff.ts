import { join } from 'path';
import fs from 'fs-extra';
import { hashDirectory, getNewestMtime } from '../utils/hash.js';
import type { ChangeSet } from '../types/config.js';
import { getAdapter } from '../adapters/registry.js';
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
    const isQwen = adapter?.toolName === 'qwen';
    const isGemini = adapter?.toolName === 'gemini';

    const changeSet: ChangeSet = {
        skills: { missing: [], outdated: [], drifted: [], total: 0 },
        hooks: { missing: [], outdated: [], drifted: [], total: 0 },
        config: { missing: [], outdated: [], drifted: [], total: 0 },
        commands: { missing: [], outdated: [], drifted: [], total: 0 },
        'qwen-commands': { missing: [], outdated: [], drifted: [], total: 0 },
        'antigravity-workflows': { missing: [], outdated: [], drifted: [], total: 0 },
    };

    // 1. Folders: Skills & Hooks & Commands
    const folders = ['skills', 'hooks'];
    if (isQwen) folders.push('qwen-commands');
    else if (isGemini) folders.push('commands', 'antigravity-workflows');
    else if (!isClaude) folders.push('commands');

    for (const category of folders) {
        let repoPath: string;
        let systemPath: string;

        if (category === 'commands') {
            repoPath = join(repoRoot, '.gemini', 'commands');
            systemPath = join(systemRoot, category);
        } else if (category === 'qwen-commands') {
            repoPath = join(repoRoot, '.qwen', 'commands');
            systemPath = join(systemRoot, 'commands');
        } else if (category === 'antigravity-workflows') {
            repoPath = join(repoRoot, '.gemini', 'antigravity', 'global_workflows');
            systemPath = join(systemRoot, '.gemini', 'antigravity', 'global_workflows');
        } else {
            repoPath = join(repoRoot, category);
            systemPath = join(systemRoot, category);
        }

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
                pruneMode
            );
        }
    }

    // 2. Config Files (Explicit Mapping)
    const configMapping = {
        'settings.json': { repo: 'config/settings.json', sys: 'settings.json' },
    };

    for (const [name, paths] of Object.entries(configMapping)) {
        const itemRepoPath = join(repoRoot, paths.repo);
        const itemSystemPath = join(systemRoot, paths.sys);

        if (await fs.pathExists(itemRepoPath)) {
            await compareItem('config', name, itemRepoPath, itemSystemPath, changeSet);
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
    pruneMode: boolean = false
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
        const repoMtime = await getNewestMtime(repoPath);
        const systemMtime = await getNewestMtime(systemPath);

        if (systemMtime > repoMtime + 2000) {
            cat.drifted.push(item);
        } else {
            cat.outdated.push(item);
        }
    }
}
