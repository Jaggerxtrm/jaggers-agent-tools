import { describe, expect, it } from 'vitest';
import {
    buildRoleTmuxPlan,
    parseSpecialistJson,
    guardRolePassthrough,
    computeRoleExtensions,
    ROLE_DEFAULT_EXTENSIONS,
} from '../utils/worktree-session.js';

const SAMPLE_SPECIALIST = JSON.stringify({
    specialist: {
        metadata: { name: 'chain-coordinator' },
        prompt: {
            system: 'You are the chain coordinator.\nDo the thing.',
        },
        skills: {
            paths: [
                '.xtrm/skills/active/using-xtrm/SKILL.md',
                '.xtrm/skills/active/using-specialists-v3/SKILL.md',
            ],
        },
    },
});

describe('parseSpecialistJson', () => {
    it('extracts system prompt + skill paths', () => {
        const role = parseSpecialistJson('chain-coordinator', SAMPLE_SPECIALIST);
        expect(role.name).toBe('chain-coordinator');
        expect(role.systemPrompt).toContain('chain coordinator');
        expect(role.skillPaths).toEqual([
            '.xtrm/skills/active/using-xtrm/SKILL.md',
            '.xtrm/skills/active/using-specialists-v3/SKILL.md',
        ]);
    });

    it('throws on missing specialist key', () => {
        expect(() => parseSpecialistJson('x', '{}')).toThrow(/missing 'specialist' key/);
    });

    it('throws on empty system prompt', () => {
        const bad = JSON.stringify({ specialist: { prompt: { system: '   ' } } });
        expect(() => parseSpecialistJson('x', bad)).toThrow(/prompt.system is empty/);
    });

    it('throws on non-JSON input', () => {
        expect(() => parseSpecialistJson('x', 'not-json')).toThrow(/did not return JSON/);
    });

    it('tolerates missing skills section (returns empty array)', () => {
        const minimal = JSON.stringify({
            specialist: { prompt: { system: 'hi' } },
        });
        const role = parseSpecialistJson('minimal', minimal);
        expect(role.skillPaths).toEqual([]);
    });

    it('filters non-string skill paths', () => {
        const messy = JSON.stringify({
            specialist: {
                prompt: { system: 'hi' },
                skills: { paths: ['a.md', 42, null, 'b.md'] },
            },
        });
        const role = parseSpecialistJson('messy', messy);
        expect(role.skillPaths).toEqual(['a.md', 'b.md']);
    });

    it('honors system_prompt_mode=replace by warning and returning prompt anyway', () => {
        const replaceMode = JSON.stringify({
            specialist: {
                prompt: { system: 'ignore-base' },
                system_prompt_mode: 'replace',
            },
        });
        const role = parseSpecialistJson('replacer', replaceMode);
        expect(role.systemPrompt).toBe('ignore-base');
    });
});

describe('buildRoleTmuxPlan', () => {
    const role = parseSpecialistJson('chain-coordinator', SAMPLE_SPECIALIST);

    it('builds session name and metadata for role+bead', () => {
        const plan = buildRoleTmuxPlan({
            role,
            bead: 'xtmux-2i5',
            parentSessionId: '$3',
            promptFile: '/tmp/prompt.md',
        });
        expect(plan.sessionName).toBe('role-chain-coordinator-xtmux-2i5');
        expect(plan.piArgs.slice(0, 2)).toEqual(['--append-system-prompt', '/tmp/prompt.md']);
        expect(plan.piArgs.filter((a) => a === '--skill')).toHaveLength(2);
        const bead = plan.paneOptions.find((o) => o.key === '@agent_bead');
        expect(bead?.value).toBe('xtmux-2i5');
        const task = plan.paneOptions.find((o) => o.key === '@agent_task');
        expect(task?.value).toBe('role:chain-coordinator');
        const parent = plan.paneOptions.find((o) => o.key === '@agent_parent_session');
        expect(parent?.value).toBe('$3');
    });

    it('omits @agent_bead and bead-slug when bead is not provided', () => {
        const plan = buildRoleTmuxPlan({
            role,
            parentSessionId: '',
            promptFile: '/tmp/prompt.md',
        });
        expect(plan.sessionName).toBe('role-chain-coordinator');
        expect(plan.paneOptions.some((o) => o.key === '@agent_bead')).toBe(false);
        const parent = plan.paneOptions.find((o) => o.key === '@agent_parent_session');
        expect(parent?.value).toBe(''); // no-tmux fallback: empty, not omitted
    });

    it('shell-quotes the pi command string', () => {
        const plan = buildRoleTmuxPlan({
            role,
            parentSessionId: '',
            promptFile: "/tmp/it's-mine.md",
        });
        expect(plan.piCmdString.startsWith("'pi' ")).toBe(true);
        expect(plan.piCmdString).toContain("'/tmp/it'\\''s-mine.md'");
    });

    it('slugifies bead ids with weird characters', () => {
        const plan = buildRoleTmuxPlan({
            role,
            bead: 'MY BEAD/1',
            parentSessionId: '',
            promptFile: '/tmp/prompt.md',
        });
        expect(plan.sessionName).toBe('role-chain-coordinator-my-bead-1');
    });

    it('emits --no-extensions and the curated -e allow-list', () => {
        const plan = buildRoleTmuxPlan({
            role,
            parentSessionId: '',
            promptFile: '/tmp/prompt.md',
        });
        expect(plan.piArgs).toContain('--no-extensions');
        for (const ext of ROLE_DEFAULT_EXTENSIONS) {
            const i = plan.piArgs.indexOf('-e');
            expect(i).toBeGreaterThan(-1);
            expect(plan.piArgs).toContain(ext);
        }
    });

    it('forwards --model / --thinking CLI overrides', () => {
        const plan = buildRoleTmuxPlan({
            role,
            parentSessionId: '',
            promptFile: '/tmp/prompt.md',
            modelOverride: 'gemini/gemini-3-pro',
            thinkingOverride: 'high',
        });
        const modelIdx = plan.piArgs.indexOf('--model');
        expect(modelIdx).toBeGreaterThan(-1);
        expect(plan.piArgs[modelIdx + 1]).toBe('gemini/gemini-3-pro');
        const thinkIdx = plan.piArgs.indexOf('--thinking');
        expect(thinkIdx).toBeGreaterThan(-1);
        expect(plan.piArgs[thinkIdx + 1]).toBe('high');
    });

    it('appends passthrough argv verbatim after all other flags', () => {
        const plan = buildRoleTmuxPlan({
            role,
            parentSessionId: '',
            promptFile: '/tmp/prompt.md',
            passthrough: ['--gitnexus-cmd', 'foo bar'],
        });
        const idx = plan.piArgs.indexOf('--gitnexus-cmd');
        expect(idx).toBeGreaterThan(-1);
        expect(plan.piArgs[idx + 1]).toBe('foo bar');
    });

    it('CLI --model wins over specialist.execution.model', () => {
        const roleWithModel = parseSpecialistJson('withmodel', JSON.stringify({
            specialist: {
                prompt: { system: 'x' },
                execution: { model: 'default-model', thinking_level: 'medium' },
            },
        }));
        const plan = buildRoleTmuxPlan({
            role: roleWithModel,
            parentSessionId: '',
            promptFile: '/tmp/prompt.md',
            modelOverride: 'override-model',
        });
        const modelIdx = plan.piArgs.indexOf('--model');
        expect(plan.piArgs[modelIdx + 1]).toBe('override-model');
        // thinking still uses specialist default
        const thinkIdx = plan.piArgs.indexOf('--thinking');
        expect(plan.piArgs[thinkIdx + 1]).toBe('medium');
    });
});

describe('guardRolePassthrough', () => {
    it('rejects xt-owned flags with a clear error', () => {
        const r = guardRolePassthrough(['--session-dir', '/x']);
        expect(r.guardedError).toMatch(/--session-dir/);
    });

    it('rejects --name= form', () => {
        const r = guardRolePassthrough(['--name=other']);
        expect(r.guardedError).toMatch(/--name/);
    });

    it('warns-and-drops --print and consumes its value', () => {
        const r = guardRolePassthrough(['--print', 'once', '--foo', 'bar']);
        expect(r.warnings.length).toBeGreaterThan(0);
        expect(r.filteredArgs).toEqual(['--foo', 'bar']);
    });

    it('warns-and-drops --list-models (boolean flag: no value to consume)', () => {
        const r = guardRolePassthrough(['--list-models', '--foo']);
        expect(r.warnings.length).toBeGreaterThan(0);
        expect(r.filteredArgs).toEqual(['--foo']);
    });

    it('passes safe flags through verbatim', () => {
        const r = guardRolePassthrough(['--gitnexus-cmd', 'foo bar', '--verbose']);
        expect(r.guardedError).toBeUndefined();
        expect(r.filteredArgs).toEqual(['--gitnexus-cmd', 'foo bar', '--verbose']);
    });
});

describe('computeRoleExtensions', () => {
    it('returns the default allow-list when no overrides', () => {
        const role = parseSpecialistJson('x', JSON.stringify({
            specialist: { prompt: { system: 'x' } },
        }));
        const exts = computeRoleExtensions(role);
        for (const e of ROLE_DEFAULT_EXTENSIONS) expect(exts).toContain(e);
        expect(exts).toHaveLength(ROLE_DEFAULT_EXTENSIONS.length);
    });

    it('adds specialist opt-ins (execution.extensions: {name: true})', () => {
        const role = parseSpecialistJson('x', JSON.stringify({
            specialist: {
                prompt: { system: 'x' },
                execution: { extensions: { 'pi-gitnexus': true } },
            },
        }));
        expect(computeRoleExtensions(role)).toContain('pi-gitnexus');
    });

    it('drops specialist opt-outs (execution.extensions: {name: false})', () => {
        const role = parseSpecialistJson('x', JSON.stringify({
            specialist: {
                prompt: { system: 'x' },
                execution: { extensions: { caveman: false } },
            },
        }));
        expect(computeRoleExtensions(role)).not.toContain('caveman');
    });
});
