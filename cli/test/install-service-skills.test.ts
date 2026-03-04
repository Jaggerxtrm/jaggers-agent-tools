import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import fsExtra from 'fs-extra';
import { mergeSettingsHooks, installSkills } from '../src/commands/install-service-skills.js';

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
    // __dirname in test context = cli/test/, so three levels up = repo root
    const ACTUAL_SKILLS_SRC = path.resolve(__dirname, '../../project-skills/service-skills-set/.claude');

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
