import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import fsExtra from 'fs-extra';
import { mergeSettingsHooks, installSkills, installGitHooks } from '../src/commands/install-service-skills.js';

// __dirname in vitest context = cli/test/
const REPO_ROOT = path.resolve(__dirname, '../..');
const ACTUAL_SKILLS_SRC = path.join(REPO_ROOT, 'project-skills', 'service-skills-set', '.claude');

describe('mergeSettingsHooks', () => {
    it('adds all three hooks to empty settings', () => {
        const { result, added, skipped } = mergeSettingsHooks({});
        const hooks = result.hooks as Record<string, unknown>;
        expect(added).toEqual(['SessionStart', 'PreToolUse', 'PostToolUse']);
        expect(skipped).toEqual([]);
        expect(hooks).toHaveProperty('SessionStart');
        expect(hooks).toHaveProperty('PreToolUse');
        expect(hooks).toHaveProperty('PostToolUse');
    });

    it('preserves existing keys and skips them', () => {
        const existing = { hooks: { SessionStart: [{ custom: true }] } };
        const { result, added, skipped } = mergeSettingsHooks(existing);
        const hooks = result.hooks as Record<string, unknown>;
        expect(skipped).toEqual(['SessionStart']);
        expect(added).toEqual(['PreToolUse', 'PostToolUse']);
        expect(hooks.SessionStart).toEqual([{ custom: true }]);
    });

    it('preserves non-hook keys in settings', () => {
        const existing = { apiKey: 'abc', permissions: { allow: [] } };
        const { result } = mergeSettingsHooks(existing);
        expect(result.apiKey).toBe('abc');
        expect(result.permissions).toEqual({ allow: [] });
    });
});

describe('installSkills', () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await mkdtemp(path.join(tmpdir(), 'jaggers-test-'));
    });

    afterEach(async () => {
        await rm(tmpDir, { recursive: true, force: true });
    });

    it('creates .claude/skills/<skill> directories', async () => {
        await installSkills(tmpDir, ACTUAL_SKILLS_SRC);
        for (const skill of ['creating-service-skills', 'using-service-skills', 'updating-service-skills', 'scoping-service-skills']) {
            const dest = path.join(tmpDir, '.claude', 'skills', skill);
            expect(await fsExtra.pathExists(dest)).toBe(true);
        }
    });

    it('is idempotent (safe to run twice)', async () => {
        await installSkills(tmpDir, ACTUAL_SKILLS_SRC);
        await expect(installSkills(tmpDir, ACTUAL_SKILLS_SRC)).resolves.not.toThrow();
    });
});

describe('installGitHooks', () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await mkdtemp(path.join(tmpdir(), 'jaggers-test-'));
        await fsExtra.mkdirp(path.join(tmpDir, '.git', 'hooks'));
    });

    afterEach(async () => {
        await rm(tmpDir, { recursive: true, force: true });
    });

    it('creates .githooks/pre-commit with doc-reminder snippet', async () => {
        await installGitHooks(tmpDir, ACTUAL_SKILLS_SRC);
        const content = await fsExtra.readFile(path.join(tmpDir, '.githooks', 'pre-commit'), 'utf8');
        expect(content).toContain('# [jaggers] doc-reminder');
        expect(content).toContain('.claude/git-hooks/doc_reminder.py');
    });

    it('creates .githooks/pre-push with skill-staleness snippet', async () => {
        await installGitHooks(tmpDir, ACTUAL_SKILLS_SRC);
        const content = await fsExtra.readFile(path.join(tmpDir, '.githooks', 'pre-push'), 'utf8');
        expect(content).toContain('# [jaggers] skill-staleness');
        expect(content).toContain('.claude/git-hooks/skill_staleness.py');
    });

    it('copies hook scripts into .claude/git-hooks/', async () => {
        await installGitHooks(tmpDir, ACTUAL_SKILLS_SRC);
        expect(await fsExtra.pathExists(path.join(tmpDir, '.claude', 'git-hooks', 'doc_reminder.py'))).toBe(true);
        expect(await fsExtra.pathExists(path.join(tmpDir, '.claude', 'git-hooks', 'skill_staleness.py'))).toBe(true);
    });

    it('activates hooks in .git/hooks/', async () => {
        await installGitHooks(tmpDir, ACTUAL_SKILLS_SRC);
        expect(await fsExtra.pathExists(path.join(tmpDir, '.git', 'hooks', 'pre-commit'))).toBe(true);
        expect(await fsExtra.pathExists(path.join(tmpDir, '.git', 'hooks', 'pre-push'))).toBe(true);
    });

    it('is idempotent — does not duplicate snippets on re-run', async () => {
        await installGitHooks(tmpDir, ACTUAL_SKILLS_SRC);
        await installGitHooks(tmpDir, ACTUAL_SKILLS_SRC);
        const content = await fsExtra.readFile(path.join(tmpDir, '.githooks', 'pre-commit'), 'utf8');
        const count = (content.match(/# \[jaggers\] doc-reminder/g) ?? []).length;
        expect(count).toBe(1);
    });
});
