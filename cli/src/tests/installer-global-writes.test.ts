import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// xtrm-tzzud: the installer must stop writing global state from project-scoped
// paths. Two deletions from the installer-writes matrix
// (docs/installer-settings-writes.md), one test each.

vi.mock('../core/global-hooks-flag.js', () => ({ shouldUseGlobalHooks: () => false }));

const PKG = 'npm:@jaggerxtrm/pi-extensions';

let repoRoot = '';
let homeDir = '';
let originalHome: string | undefined;
let originalAgentDir: string | undefined;

beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xtrm-tzzud-repo-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xtrm-tzzud-home-'));
    fs.ensureDirSync(path.join(repoRoot, '.xtrm', 'hooks'));
    fs.ensureDirSync(path.join(homeDir, '.claude'));
    fs.ensureDirSync(path.join(homeDir, '.xtrm', 'hooks'));
    fs.ensureDirSync(path.join(homeDir, '.pi', 'agent'));
    originalHome = process.env.HOME;
    originalAgentDir = process.env.PI_AGENT_DIR;
    process.env.HOME = homeDir;
    process.env.PI_AGENT_DIR = path.join(homeDir, '.pi', 'agent');
    vi.spyOn(os, 'homedir').mockReturnValue(homeDir);
    vi.resetModules();
});

afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
    if (originalAgentDir === undefined) delete process.env.PI_AGENT_DIR; else process.env.PI_AGENT_DIR = originalAgentDir;
    vi.restoreAllMocks();
    fs.removeSync(repoRoot);
    fs.removeSync(homeDir);
});

// Matrix finding 2: runClaudeRuntimeSyncPhase called ensureGlobalStatusLine on
// every exit path regardless of isGlobal, so `xt claude sync` inside one
// project flipped a setting in ~/.claude/settings.json.
describe('runClaudeRuntimeSyncPhase isGlobal=false', () => {
    async function syncProject() {
        const { runClaudeRuntimeSyncPhase } = await import('../core/claude-runtime-sync.js');
        return runClaudeRuntimeSyncPhase({ repoRoot, dryRun: false, isGlobal: false });
    }

    it('does not write statusLine into ~/.claude/settings.json', async () => {
        // The statusline hook exists, so the write is armed — only the isGlobal
        // gate stops it.
        fs.writeFileSync(path.join(homeDir, '.xtrm', 'hooks', 'statusline.mjs'), '// statusline');
        const globalSettings = path.join(homeDir, '.claude', 'settings.json');
        fs.writeJsonSync(globalSettings, { model: 'claude-opus-4-8' });

        await syncProject();

        expect(fs.readJsonSync(globalSettings)).toEqual({ model: 'claude-opus-4-8' });
    });

    it('still writes the project settings.json it owns', async () => {
        fs.writeFileSync(path.join(homeDir, '.xtrm', 'hooks', 'statusline.mjs'), '// statusline');

        const result = await syncProject();

        expect(result.settingsPath).toBe(path.join(repoRoot, '.claude', 'settings.json'));
        expect(fs.existsSync(result.settingsPath)).toBe(true);
    });
});

// Matrix finding 1: updatePiSettings unconditionally pushed the extension
// package into per-project packages. Pi resolves npm packages by scope-free
// identity and lets the PROJECT entry win, so that write shadowed the global
// install rather than duplicating it harmlessly (xtrm-tzzud.1).
describe('updatePiSettings project packages', () => {
    async function update() {
        const { updatePiSettings } = await import('../core/pi-runtime.js');
        return updatePiSettings(repoRoot, false);
    }

    const projectPi = () => path.join(repoRoot, '.pi', 'settings.json');
    const globalPi = () => path.join(homeDir, '.pi', 'agent', 'settings.json');

    it('does not add the extension package when the global settings declare it', async () => {
        fs.writeJsonSync(globalPi(), { packages: [PKG] });

        await update();

        expect(fs.readJsonSync(projectPi()).packages).not.toContain(PKG);
    });

    it('removes an existing project entry once the global settings declare it', async () => {
        fs.writeJsonSync(globalPi(), { packages: [PKG] });
        fs.ensureDirSync(path.join(repoRoot, '.pi'));
        fs.writeJsonSync(projectPi(), { packages: [PKG, 'npm:other'] });

        await update();

        expect(fs.readJsonSync(projectPi()).packages).toEqual(['npm:other']);
    });

    it('keeps the project entry load-bearing when the global settings do NOT declare it', async () => {
        fs.writeJsonSync(globalPi(), { packages: ['npm:something-else'] });

        await update();

        expect(fs.readJsonSync(projectPi()).packages).toContain(PKG);
    });

    it('keeps the project entry when the global settings are missing entirely', async () => {
        fs.removeSync(globalPi());

        await update();

        expect(fs.readJsonSync(projectPi()).packages).toContain(PKG);
    });
});
