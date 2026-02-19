import path from 'path';
import fs from 'fs-extra';
import crypto from 'crypto';

/**
 * Calculate MD5 hash of a file or directory
 */
async function getHash(targetPath) {
    if (!fs.existsSync(targetPath)) return null;

    const stats = await fs.stat(targetPath);

    if (stats.isDirectory()) {
        const children = await fs.readdir(targetPath);
        const childHashes = await Promise.all(
            children.sort().map(async child => {
                const h = await getHash(path.join(targetPath, child));
                return `${child}:${h}`;
            })
        );
        return crypto.createHash('md5').update(childHashes.join('|')).digest('hex');
    } else {
        const content = await fs.readFile(targetPath);
        return crypto.createHash('md5').update(content).digest('hex');
    }
}

async function getNewestMtime(targetPath) {
    const stats = await fs.stat(targetPath);
    let maxTime = stats.mtimeMs;

    if (stats.isDirectory()) {
        const children = await fs.readdir(targetPath);
        for (const child of children) {
            const childPath = path.join(targetPath, child);
            const childTime = await getNewestMtime(childPath);
            if (childTime > maxTime) maxTime = childTime;
        }
    }
    return maxTime;
}

export async function calculateDiff(repoRoot, systemRoot) {
    const isClaude = systemRoot.includes('.claude') || systemRoot.includes('Claude');
    const isQwen = systemRoot.includes('.qwen') || systemRoot.includes('Qwen');
    const isGemini = systemRoot.includes('.gemini') || systemRoot.includes('Gemini');

    const changeSet = {
        skills: { missing: [], outdated: [], drifted: [], total: 0 },
        hooks: { missing: [], outdated: [], drifted: [], total: 0 },
        config: { missing: [], outdated: [], drifted: [], total: 0 },
        commands: { missing: [], outdated: [], drifted: [], total: 0 },
        'qwen-commands': { missing: [], outdated: [], drifted: [], total: 0 },
        'antigravity-workflows': { missing: [], outdated: [], drifted: [], total: 0 }
    };

    // 1. Folders: Skills & Hooks & Commands (for different environments)
    const folders = ['skills', 'hooks'];
    if (isQwen) {
        folders.push('qwen-commands');
    } else if (isGemini) {
        folders.push('commands', 'antigravity-workflows');
    } else if (!isClaude) {
        folders.push('commands');
    }

    for (const category of folders) {
        let repoPath;
        if (category === 'commands') {
            // Commands are always in .gemini/commands in repo
            repoPath = path.join(repoRoot, '.gemini', 'commands');
        } else if (category === 'qwen-commands') {
            // Qwen commands are in .qwen/commands in repo
            repoPath = path.join(repoRoot, '.qwen', 'commands');
        } else if (category === 'antigravity-workflows') {
            // Antigravity workflows are in .gemini/antigravity/global_workflows in repo
            repoPath = path.join(repoRoot, '.gemini', 'antigravity', 'global_workflows');
        } else {
            repoPath = path.join(repoRoot, category);
        }
        
        let systemPath;
        if (category === 'qwen-commands') {
            systemPath = path.join(systemRoot, 'commands');
        } else if (category === 'antigravity-workflows') {
            systemPath = path.join(systemRoot, '.gemini', 'antigravity', 'global_workflows');
        } else if (category === 'commands') {
            systemPath = path.join(systemRoot, category);
        } else {
            systemPath = path.join(systemRoot, category);
        }

        if (!fs.existsSync(repoPath)) continue;

        const items = await fs.readdir(repoPath);
        changeSet[category].total = items.length;

        for (const item of items) {
            const itemRepoPath = path.join(repoPath, item);
            const itemSystemPath = path.join(systemPath, item);

            await compareItem(category, item, itemRepoPath, itemSystemPath, changeSet);
        }
    }

    // 2. Config Files (Explicit Mapping)
    const configMapping = {
        'settings.json': { repo: 'config/settings.json', sys: 'settings.json' }
    };

    for (const [name, paths] of Object.entries(configMapping)) {
        const itemRepoPath = path.join(repoRoot, paths.repo);
        const itemSystemPath = path.join(systemRoot, paths.sys);
        
        if (fs.existsSync(itemRepoPath)) {
            await compareItem('config', name, itemRepoPath, itemSystemPath, changeSet);
        }
    }

    return changeSet;
}

async function compareItem(category, item, repoPath, systemPath, changeSet) {
    if (!fs.existsSync(systemPath)) {
        changeSet[category].missing.push(item);
        return;
    }

    const repoHash = await getHash(repoPath);
    const systemHash = await getHash(systemPath);

    if (repoHash !== systemHash) {
        const repoMtime = await getNewestMtime(repoPath);
        const systemMtime = await getNewestMtime(systemPath);

        if (systemMtime > repoMtime + 2000) {
            changeSet[category].drifted.push(item);
        } else {
            changeSet[category].outdated.push(item);
        }
    }
}