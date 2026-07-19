import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { cleanupConflictingPiPackageSettings, inventoryPiRuntime, executePiSync, ensureAlwaysGlobalPiPackages, getXtManagedPiPackages, syncManagedPiThemes, updatePiSettings } from '../src/core/pi-runtime.js';

async function makeExtension(baseDir: string, name: string, extraFiles: Record<string, string> = {}): Promise<void> {
    const extDir = path.join(baseDir, name);
    await fs.ensureDir(extDir);
    await fs.writeJson(path.join(extDir, 'package.json'), { name });
    await fs.writeFile(path.join(extDir, 'index.ts'), `export const ${name.replace(/[^a-zA-Z0-9_]/g, '_')} = 1;`);

    for (const [relativePath, content] of Object.entries(extraFiles)) {
        const absPath = path.join(extDir, relativePath);
        await fs.ensureDir(path.dirname(absPath));
        await fs.writeFile(absPath, content);
    }
}

describe('syncManagedPiThemes', () => {
    it('symlinks every XTRM theme and replaces copied assets', async () => {
        const sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-theme-source-'));
        const targetDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-theme-target-'));
        const themes = ['xtrm-dark.json', 'xtrm-dark-flattools.json', 'xtrm-light.json', 'xtrm-light-flattools.json'];

        try {
            await Promise.all(themes.map((name) => fs.writeFile(path.join(sourceDir, name), `{"name":"${name}"}`)));
            await fs.writeFile(path.join(sourceDir, 'ignored.json'), '{}');
            await Promise.all(themes.map((name) => fs.writeFile(path.join(targetDir, name), `{"name":"legacy-${name}"}`)));
            await fs.writeFile(path.join(targetDir, 'custom.json'), '{}');

            await syncManagedPiThemes(sourceDir, false, undefined, targetDir);

            expect((await fs.readdir(targetDir)).sort()).toEqual([...themes, 'custom.json'].sort());
            for (const name of themes) {
                expect((await fs.lstat(path.join(targetDir, name))).isSymbolicLink()).toBe(true);
                expect(await fs.readFile(path.join(targetDir, name), 'utf8')).toContain(name);
            }
        } finally {
            await fs.remove(sourceDir);
            await fs.remove(targetDir);
        }
    });

    it('does not create themes during a dry run', async () => {
        const sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-theme-source-'));
        const targetDir = path.join(os.tmpdir(), `pi-theme-target-${Date.now()}`);
        await Promise.all([
            'xtrm-dark.json',
            'xtrm-dark-flattools.json',
            'xtrm-light.json',
            'xtrm-light-flattools.json',
        ].map((name) => fs.writeFile(path.join(sourceDir, name), '{}')));

        try {
            await syncManagedPiThemes(sourceDir, true, undefined, targetDir);
            expect(await fs.pathExists(targetDir)).toBe(false);
        } finally {
            await fs.remove(sourceDir);
            await fs.remove(targetDir);
        }
    });
});

describe('cleanupConflictingPiPackageSettings', () => {
    it('leaves settings unchanged in dry-run mode', async () => {
        const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-project-'));
        const agentDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-agent-'));
        const projectSettingsPath = path.join(projectRoot, '.pi', 'settings.json');
        const globalSettingsPath = path.join(agentDir, 'settings.json');
        await fs.ensureDir(path.dirname(projectSettingsPath));
        await fs.writeJson(projectSettingsPath, { theme: 'pidex-light', xtrmExternalCompact: true });
        await fs.writeJson(globalSettingsPath, { theme: 'pidex-dark', xtrmExternalCompact: true });
        const projectBefore = await fs.readFile(projectSettingsPath, 'utf8');
        const globalBefore = await fs.readFile(globalSettingsPath, 'utf8');

        try {
            await cleanupConflictingPiPackageSettings(projectRoot, true, true, undefined, agentDir);
            expect(await fs.readFile(projectSettingsPath, 'utf8')).toBe(projectBefore);
            expect(await fs.readFile(globalSettingsPath, 'utf8')).toBe(globalBefore);
        } finally {
            await fs.remove(projectRoot);
            await fs.remove(agentDir);
        }
    });

    it('migrates global preferences only in global mode', async () => {
        const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-project-'));
        const agentDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-agent-'));
        const projectSettingsPath = path.join(projectRoot, '.pi', 'settings.json');
        const globalSettingsPath = path.join(agentDir, 'settings.json');
        await fs.ensureDir(path.dirname(projectSettingsPath));
        await fs.writeJson(projectSettingsPath, { theme: 'pidex-light', xtrmExternalCompact: true });
        await fs.writeJson(globalSettingsPath, { theme: 'pidex-dark', xtrmExternalCompact: true });

        try {
            await cleanupConflictingPiPackageSettings(projectRoot, false, false, undefined, agentDir);
            expect(await fs.readJson(projectSettingsPath)).toMatchObject({ theme: 'xtrm-light' });
            expect(await fs.readJson(projectSettingsPath)).not.toHaveProperty('xtrmExternalCompact');
            expect(await fs.readJson(globalSettingsPath)).toEqual({ theme: 'pidex-dark', xtrmExternalCompact: true });

            await cleanupConflictingPiPackageSettings(projectRoot, false, true, undefined, agentDir);
            expect(await fs.readJson(globalSettingsPath)).toMatchObject({ theme: 'xtrm-dark' });
            expect(await fs.readJson(globalSettingsPath)).not.toHaveProperty('xtrmExternalCompact');
        } finally {
            await fs.remove(projectRoot);
            await fs.remove(agentDir);
        }
    });
});

describe('updatePiSettings', () => {
    it('does not overwrite malformed settings', async () => {
        const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-settings-'));
        const settingsPath = path.join(projectRoot, '.pi', 'settings.json');
        await fs.ensureDir(path.dirname(settingsPath));
        await fs.writeFile(settingsPath, '{ malformed');

        try {
            await expect(updatePiSettings(projectRoot, false)).rejects.toThrow();
            expect(await fs.readFile(settingsPath, 'utf8')).toBe('{ malformed');
        } finally {
            await fs.remove(projectRoot);
        }
    });

    it.each([
        [undefined, []],
        [{ blockedTools: ['read', 'write', 'edit', 'ls', 'find', 'grep'] }, []],
        [{ blockedTools: ['execute_shell_command'] }, ['execute_shell_command']],
    ])('repairs Serena native-tool blocking while preserving custom blocks', async (serena, blockedTools) => {
        const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-settings-'));
        await fs.ensureDir(path.join(projectRoot, '.pi'));
        await fs.writeJson(path.join(projectRoot, '.pi', 'settings.json'), { serena });

        try {
            await updatePiSettings(projectRoot, false);
            expect((await fs.readJson(path.join(projectRoot, '.pi', 'settings.json'))).serena.blockedTools).toEqual(blockedTools);
        } finally {
            await fs.remove(projectRoot);
        }
    });

    it.each([
        ['pidex-dark', 'xtrm-dark'],
        ['pidex-light', 'xtrm-light'],
        ['pidex-dark-flattools', 'xtrm-dark-flattools'],
        ['pidex-light-flattools', 'xtrm-light-flattools'],
    ])('migrates legacy theme %s without changing unrelated settings', async (legacyTheme, expectedTheme) => {
        const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-settings-'));
        await fs.ensureDir(path.join(projectRoot, '.pi'));
        await fs.writeJson(path.join(projectRoot, '.pi', 'settings.json'), {
            theme: legacyTheme,
            customSetting: 'preserved',
            xtrmExternalCompact: false,
        });

        try {
            await updatePiSettings(projectRoot, false);
            const settings = await fs.readJson(path.join(projectRoot, '.pi', 'settings.json'));

            expect(settings.theme).toBe(expectedTheme);
            expect(settings.customSetting).toBe('preserved');
            expect(settings).not.toHaveProperty('xtrmExternalCompact');
        } finally {
            await fs.remove(projectRoot);
        }
    });
});

describe('inventoryPiRuntime', () => {
    let sourceDir: string;
    let targetDir: string;

    beforeEach(async () => {
        vi.resetModules();
        sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-src-'));
        targetDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-dst-'));
    });

    afterEach(async () => {
        await fs.remove(sourceDir);
        await fs.remove(targetDir);
    });

    it('detects missing extensions', async () => {
        await makeExtension(sourceDir, 'beads');
        await makeExtension(sourceDir, 'session-flow');

        const plan = await inventoryPiRuntime(sourceDir, targetDir);

        expect(plan.missingExtensions.length).toBeGreaterThan(0);
        expect(plan.missingExtensions.some(s => s.ext.id === 'beads')).toBe(true);
    });

    it('detects stale extensions', async () => {
        await makeExtension(sourceDir, 'beads', { 'extra.ts': 'export const x = 1;' });
        await makeExtension(targetDir, 'beads'); // No extra.ts

        const plan = await inventoryPiRuntime(sourceDir, targetDir);

        expect(plan.staleExtensions.length).toBeGreaterThan(0);
        expect(plan.staleExtensions.some(s => s.ext.id === 'beads')).toBe(true);
    });

    it('detects retired managed extensions without treating user extensions as orphans', async () => {
        await makeExtension(targetDir, 'pi-serena-compact');
        await makeExtension(targetDir, 'user-extension');

        const plan = await inventoryPiRuntime(sourceDir, targetDir);

        expect(plan.orphanedExtensions).toEqual(['pi-serena-compact']);
    });

    it('reports allPresent when everything is synced', async () => {
        await makeExtension(sourceDir, 'beads');
        await makeExtension(targetDir, 'beads');

        const plan = await inventoryPiRuntime(sourceDir, targetDir);

        // Only beads is in both, other managed extensions are missing
        // So allPresent will be false unless all MANAGED_EXTENSIONS are present
        expect(plan.allPresent).toBe(false);
    });

    it('computes allRequiredPresent correctly', async () => {
        // Create source for required extension
        await makeExtension(sourceDir, 'beads');
        await makeExtension(targetDir, 'beads');

        const plan = await inventoryPiRuntime(sourceDir, targetDir);

        // beads is required and present, but other required extensions are missing
        expect(plan.allRequiredPresent).toBe(false);
    });
});

describe('ensureAlwaysGlobalPiPackages', () => {
    let agentDir: string;

    beforeEach(async () => {
        agentDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-agent-'));
    });

    afterEach(async () => {
        await fs.remove(agentDir);
        vi.restoreAllMocks();
    });

    it('does not invoke pi install when global package directories already exist', async () => {
        for (const pkg of getXtManagedPiPackages()) {
            await fs.ensureDir(path.join(agentDir, 'npm', 'node_modules', pkg.id.slice(4)));
        }

        let installCalls = 0;
        const result = await ensureAlwaysGlobalPiPackages(false, undefined, agentDir, () => {
            installCalls += 1;
            return { status: 0, stdout: '', stderr: '' };
        });

        expect(installCalls).toBe(0);
        expect(result.installed).toEqual([]);
        expect(result.failed).toEqual([]);
    });

    it('runs global installs for missing required runtime packages', async () => {
        const installOrder: string[] = [];
        const result = await ensureAlwaysGlobalPiPackages(false, undefined, agentDir, (piPackageId) => {
            installOrder.push(piPackageId);
            return { status: 0, stdout: '', stderr: '' };
        }, null);

        const expectedPackageIds = getXtManagedPiPackages().map(pkg => pkg.id);
        expect(installOrder).toEqual(expectedPackageIds);
        expect(result.installed).toEqual(expectedPackageIds);
        expect(result.failed).toEqual([]);
    });
});

describe('executePiSync', () => {
    let sourceDir: string;
    let targetDir: string;

    beforeEach(async () => {
        vi.resetModules();
        sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-src-'));
        targetDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-dst-'));
    });

    afterEach(async () => {
        await fs.remove(sourceDir);
        await fs.remove(targetDir);
    });

    it('copies missing extensions', async () => {
        await makeExtension(sourceDir, 'beads');
        const plan = await inventoryPiRuntime(sourceDir, targetDir);

        const result = await executePiSync(plan, sourceDir, targetDir, { dryRun: false });

        expect(result.extensionsAdded).toContain('beads');
        expect(await fs.pathExists(path.join(targetDir, 'beads', 'index.ts'))).toBe(true);
    });

    it('updates stale extensions', async () => {
        await makeExtension(sourceDir, 'beads', { 'extra.ts': 'export const x = 1;' });
        await makeExtension(targetDir, 'beads'); // stale - missing extra.ts

        const plan = await inventoryPiRuntime(sourceDir, targetDir);
        const result = await executePiSync(plan, sourceDir, targetDir);

        expect(result.extensionsUpdated).toContain('beads');
        expect(await fs.pathExists(path.join(targetDir, 'beads', 'extra.ts'))).toBe(true);
    });

    it('removes retired managed extensions without touching user extensions', async () => {
        await makeExtension(targetDir, 'pi-serena-compact');
        await makeExtension(targetDir, 'user-extension');

        const plan = await inventoryPiRuntime(sourceDir, targetDir);
        const result = await executePiSync(plan, sourceDir, targetDir, { removeOrphaned: true });

        expect(result.extensionsRemoved).toContain('pi-serena-compact');
        expect(await fs.pathExists(path.join(targetDir, 'pi-serena-compact'))).toBe(false);
        expect(await fs.pathExists(path.join(targetDir, 'user-extension'))).toBe(true);
    });

    it('preserves retired managed extensions when removeOrphaned is false', async () => {
        await makeExtension(targetDir, 'quality-gates');

        const plan = await inventoryPiRuntime(sourceDir, targetDir);
        const result = await executePiSync(plan, sourceDir, targetDir, { removeOrphaned: false });

        expect(result.extensionsRemoved).not.toContain('quality-gates');
        expect(await fs.pathExists(path.join(targetDir, 'quality-gates'))).toBe(true);
    });

    it('dry run enrolls current extensions and skips disabled or library IDs', async () => {
        await makeExtension(sourceDir, 'serena-pool');
        await makeExtension(sourceDir, 'sp-terminal-overlay');
        await makeExtension(sourceDir, 'xtprompt');

        const plan = await inventoryPiRuntime(sourceDir, targetDir);
        const logs: string[] = [];
        const result = await executePiSync(plan, sourceDir, targetDir, { dryRun: true, log: (message) => logs.push(message) });

        expect(result.extensionsAdded).toHaveLength(0);
        expect(logs).toEqual(expect.arrayContaining([
            '[DRY RUN] + serena-pool',
            '[DRY RUN] + sp-terminal-overlay',
            '[DRY RUN] + xtprompt',
        ]));
        expect(logs.join('\n')).not.toContain('core');
        expect(logs.join('\n')).not.toContain('pi-serena-compact');
        expect(logs.join('\n')).not.toContain('quality-gates');
        expect(await fs.pathExists(path.join(targetDir, 'serena-pool'))).toBe(false);
    });
});
