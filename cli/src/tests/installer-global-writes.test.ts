import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// xtrm-tzzud: the installer must stop writing global state from project-scoped
// paths. Two deletions from the installer-writes matrix
// (docs/installer-settings-writes.md), one test each.
//
// xtrm-wiy5n.4.37: same file also holds the four survival proofs — the
// bootstrap must never delete a file it cannot prove it wrote. See the
// bottom two `describe` blocks.

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

// xtrm-wiy5n.4.37 — the installer must never delete a file it cannot prove it
// wrote. Before this fix, ensureGlobalSkillsBootstrapped/copyTier issued an
// unconditional `fs.remove` on ~/.xtrm/skills/default and .../optional
// whenever the guarded version changed — which is exactly every release day.
// The proofs below anchor the fix: a user file present at first install
// survives that install, survives a re-run at the same version, survives a
// version bump that changes the payload, and a shipped file that goes away
// between versions is still cleaned up (the manifest is doing its job, not
// just "delete nothing").
describe('ensureGlobalSkillsBootstrapped safe-delete (xtrm-wiy5n.4.37)', () => {
    function seedPkg(version: string, tiers: { default?: Record<string, string>; optional?: Record<string, string> }): void {
        fs.writeJsonSync(path.join(repoRoot, 'package.json'), { name: 'xtrm-tools', version });
        fs.emptyDirSync(path.join(repoRoot, '.xtrm', 'skills', 'default'));
        fs.emptyDirSync(path.join(repoRoot, '.xtrm', 'skills', 'optional'));
        for (const [rel, content] of Object.entries(tiers.default ?? {})) {
            const dest = path.join(repoRoot, '.xtrm', 'skills', 'default', rel);
            fs.ensureDirSync(path.dirname(dest));
            fs.writeFileSync(dest, content);
        }
        for (const [rel, content] of Object.entries(tiers.optional ?? {})) {
            const dest = path.join(repoRoot, '.xtrm', 'skills', 'optional', rel);
            fs.ensureDirSync(path.dirname(dest));
            fs.writeFileSync(dest, content);
        }
    }

    async function bootstrap(): Promise<void> {
        const { ensureGlobalSkillsBootstrapped } = await import('../core/global-skills-bootstrap.js');
        await ensureGlobalSkillsBootstrapped(repoRoot);
    }

    const userDefault = (): string => path.join(homeDir, '.xtrm', 'skills', 'default', 'my-user-skill', 'SKILL.md');
    const userOptional = (): string => path.join(homeDir, '.xtrm', 'skills', 'optional', 'user-optional', 'SKILL.md');

    it('proof 1: a user-authored file present before the first install survives it', async () => {
        fs.ensureDirSync(path.dirname(userDefault()));
        fs.writeFileSync(userDefault(), '# user-authored, must survive');
        seedPkg('1.0.0', { default: { 'shipped-a/SKILL.md': '# shipped-a v1' } });

        await bootstrap();

        expect(fs.readFileSync(userDefault(), 'utf8')).toBe('# user-authored, must survive');
        expect(fs.existsSync(path.join(homeDir, '.xtrm', 'skills', 'default', 'shipped-a', 'SKILL.md'))).toBe(true);
    });

    it('proof 2: a user file added after the first install survives an update at the same version', async () => {
        seedPkg('1.0.0', { default: { 'shipped-a/SKILL.md': '# shipped-a v1' } });
        await bootstrap();

        fs.ensureDirSync(path.dirname(userDefault()));
        fs.writeFileSync(userDefault(), '# added after first install');

        await bootstrap();

        expect(fs.readFileSync(userDefault(), 'utf8')).toBe('# added after first install');
    });

    it('proof 3: a user file survives a version bump AND a payload change', async () => {
        seedPkg('1.0.0', {
            default: { 'shipped-a/SKILL.md': '# shipped-a v1' },
            optional: { 'shipped-opt/SKILL.md': '# opt v1' },
        });
        await bootstrap();

        fs.ensureDirSync(path.dirname(userDefault()));
        fs.writeFileSync(userDefault(), '# user default, must survive bump');
        fs.ensureDirSync(path.dirname(userOptional()));
        fs.writeFileSync(userOptional(), '# user optional, must survive bump');

        seedPkg('2.0.0', {
            default: { 'shipped-b/SKILL.md': '# shipped-b v2' },
            optional: { 'shipped-opt/SKILL.md': '# opt v2' },
        });
        await bootstrap();

        expect(fs.readFileSync(userDefault(), 'utf8')).toBe('# user default, must survive bump');
        expect(fs.readFileSync(userOptional(), 'utf8')).toBe('# user optional, must survive bump');
        // The manifest tracked shipped-a — so it IS removed on the bump. This
        // proves the fix is not the trivial "delete nothing".
        expect(fs.existsSync(path.join(homeDir, '.xtrm', 'skills', 'default', 'shipped-a', 'SKILL.md'))).toBe(false);
        expect(fs.existsSync(path.join(homeDir, '.xtrm', 'skills', 'default', 'shipped-b', 'SKILL.md'))).toBe(true);
    });

    it('proof 4: a user file dropped INSIDE a shipped skill dir survives that skill being removed', async () => {
        // Adversarial: user drops a file inside a directory that used to house
        // a shipped skill. Tracked-file removal must not sweep the user file
        // with it; dir-pruning must stop at the first non-empty directory.
        seedPkg('1.0.0', { default: { 'skill-x/SKILL.md': '# skill-x v1', 'skill-x/lib/helper.md': '# helper' } });
        await bootstrap();

        const userDropIn = path.join(homeDir, '.xtrm', 'skills', 'default', 'skill-x', 'user-notes.md');
        fs.writeFileSync(userDropIn, '# I wrote this into a shipped dir');

        seedPkg('2.0.0', { default: {} });
        await bootstrap();

        expect(fs.readFileSync(userDropIn, 'utf8')).toBe('# I wrote this into a shipped dir');
        expect(fs.existsSync(path.join(homeDir, '.xtrm', 'skills', 'default', 'skill-x', 'SKILL.md'))).toBe(false);
        expect(fs.existsSync(path.join(homeDir, '.xtrm', 'skills', 'default', 'skill-x', 'lib', 'helper.md'))).toBe(false);
    });
});

describe('ensureGlobalHooksBootstrapped safe-delete (xtrm-wiy5n.4.37)', () => {
    function seedHooksPkg(version: string, files: Record<string, string>, configBody = '{"hooks":{}}'): void {
        fs.writeJsonSync(path.join(repoRoot, 'package.json'), { name: 'xtrm-tools', version });
        fs.emptyDirSync(path.join(repoRoot, '.xtrm', 'hooks'));
        fs.ensureDirSync(path.join(repoRoot, '.xtrm', 'config'));
        fs.writeFileSync(path.join(repoRoot, '.xtrm', 'config', 'hooks.json'), configBody);
        for (const [rel, content] of Object.entries(files)) {
            const dest = path.join(repoRoot, '.xtrm', 'hooks', rel);
            fs.ensureDirSync(path.dirname(dest));
            fs.writeFileSync(dest, content);
        }
    }

    async function bootstrap(): Promise<void> {
        const { ensureGlobalHooksBootstrapped } = await import('../core/global-hooks-bootstrap.js');
        await ensureGlobalHooksBootstrapped(repoRoot);
    }

    const userHook = (): string => path.join(homeDir, '.xtrm', 'hooks', 'user-authored-hook.mjs');

    it('proof: a user-authored hook survives a version bump AND a source-fingerprint change', async () => {
        seedHooksPkg('1.0.0', { 'shipped-hook.mjs': '// shipped v1' });
        await bootstrap();

        fs.writeFileSync(userHook(), '// user-authored hook, must survive');

        // Change BOTH version and content — the old fingerprint-match guard
        // would have let the pre-fix `fs.remove(targetHooksRoot)` blow through.
        seedHooksPkg('2.0.0', { 'shipped-hook.mjs': '// shipped v2 CHANGED' }, '{"hooks":{"v":2}}');
        await bootstrap();

        expect(fs.readFileSync(userHook(), 'utf8')).toBe('// user-authored hook, must survive');
        expect(fs.readFileSync(path.join(homeDir, '.xtrm', 'hooks', 'shipped-hook.mjs'), 'utf8')).toBe('// shipped v2 CHANGED');
    });

    it('proof: dropping a shipped hook between versions cleans it without touching the user hook', async () => {
        seedHooksPkg('1.0.0', { 'shipped-hook.mjs': '// shipped v1', 'another.mjs': '// another' });
        await bootstrap();

        fs.writeFileSync(userHook(), '// still mine');

        seedHooksPkg('2.0.0', { 'shipped-hook.mjs': '// shipped v2' });
        await bootstrap();

        expect(fs.existsSync(path.join(homeDir, '.xtrm', 'hooks', 'another.mjs'))).toBe(false);
        expect(fs.readFileSync(userHook(), 'utf8')).toBe('// still mine');
    });
});
