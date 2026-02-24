import os from 'os';
import path from 'path';
import fs from 'fs-extra';
// @ts-ignore
import Conf from 'conf';
// @ts-ignore
import prompts from 'prompts';
import kleur from 'kleur';
import type { SyncMode } from '../types/config.js';


export interface Context {
    targets: string[];
    syncMode: 'copy' | 'symlink' | 'prune';
    config: any;
}

// Initialize configuration (persists sync mode preference only)
const config = new Conf({
    projectName: 'jaggers-config-manager',
    defaults: {
        syncMode: 'copy',
    },
});

function getCandidatePaths(): Array<{ label: string; path: string }> {
    const home = os.homedir();
    const appData = process.env.APPDATA;
    const isWindows = process.platform === 'win32';

    const paths = [
        { label: '.claude', path: path.join(home, '.claude') },
        { label: '.gemini', path: path.join(home, '.gemini') },
        { label: '.qwen', path: path.join(home, '.qwen') },
        { label: '~/.gemini/antigravity', path: path.join(home, '.gemini', 'antigravity') },
    ];

    if (isWindows && appData) {
        paths.push({ label: 'Claude (AppData)', path: path.join(appData, 'Claude') });
    }

    return paths;
}

export async function getContext(): Promise<Context> {
    const choices = [];
    const candidates = getCandidatePaths();

    for (const c of candidates) {
        const exists = await fs.pathExists(c.path);
        const icon = exists ? kleur.green('●') : kleur.gray('○');
        const desc = exists ? 'Found' : 'Not found (will create)';

        choices.push({
            title: `${icon} ${c.label} (${c.path})`,
            description: desc,
            value: c.path,
            selected: exists, // Pre-select existing environments
        });
    }

    const response = await prompts({
        type: 'multiselect',
        name: 'targets',
        message: 'Select target environment(s):',
        choices: choices,
        hint: '- Space to select. Return to submit',
        instructions: false,
    });

    if (response.targets === undefined) {
        console.log(kleur.gray('\nCancelled.'));
        process.exit(130);
    }
    if (response.targets.length === 0) {
        console.log(kleur.gray('No targets selected.'));
        process.exit(0);
    }

    // Ensure directories exist for selected targets
    for (const target of response.targets) {
        await fs.ensureDir(target);
    }

    return {
        targets: response.targets,
        syncMode: config.get('syncMode') as SyncMode,
        config,
    };

}

export function resetContext(): void {
    config.clear();
    console.log(kleur.yellow('Configuration cleared.'));
}
