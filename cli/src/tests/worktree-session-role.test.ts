import os from 'node:os';
import path from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    buildAgentEnv,
    buildRoleTmuxPlan,
    chooseAttachCommand,
    parseSpecialistJson,
    guardRolePassthrough,
    resolveSkillPath,
} from '../utils/worktree-session.js';

// Use synthetic test-only skill paths that don't exist under real repo OR
// $HOME. resolveSkillPath's home-fallback (xtmux-1rn) then leaves them
// deterministically repo-resolved, so assertions stay stable regardless of
// the runner's actual $HOME contents.
const SAMPLE_SPECIALIST = JSON.stringify({
    specialist: {
        metadata: { name: 'chain-coordinator' },
        prompt: {
            system: 'You are the chain coordinator.\nDo the thing.',
        },
        skills: {
            paths: [
                '.xtrm/skills/test-only/synthetic-a/SKILL.md',
                '.xtrm/skills/test-only/synthetic-b/SKILL.md',
            ],
        },
    },
});

describe('parseSpecialistJson', () => {
    const mainRepoRoot = '/repo/root';

    it('extracts system prompt + skill paths', () => {
        const role = parseSpecialistJson('chain-coordinator', SAMPLE_SPECIALIST, mainRepoRoot);
        expect(role.name).toBe('chain-coordinator');
        expect(role.systemPrompt).toContain('chain coordinator');
        expect(role.skillPaths).toEqual([
            path.resolve(mainRepoRoot, '.xtrm/skills/test-only/synthetic-a/SKILL.md'),
            path.resolve(mainRepoRoot, '.xtrm/skills/test-only/synthetic-b/SKILL.md'),
        ]);
    });

    it('resolves relative skill path from mainRepoRoot', () => {
        const role = parseSpecialistJson('x', JSON.stringify({
            specialist: {
                prompt: { system: 'hi' },
                skills: { paths: ['skills/demo/SKILL.md'] },
            },
        }), mainRepoRoot);
        expect(role.skillPaths).toEqual([
            path.resolve(mainRepoRoot, 'skills/demo/SKILL.md'),
        ]);
    });

    it('preserves absolute skill path unchanged', () => {
        const absoluteSkillPath = '/abs/skill/SKILL.md';
        const role = parseSpecialistJson('x', JSON.stringify({
            specialist: {
                prompt: { system: 'hi' },
                skills: { paths: [absoluteSkillPath] },
            },
        }), mainRepoRoot);
        expect(role.skillPaths).toEqual([absoluteSkillPath]);
    });

    it('expands tilde skill path from homedir', () => {
        const role = parseSpecialistJson('x', JSON.stringify({
            specialist: {
                prompt: { system: 'hi' },
                skills: { paths: ['~/team/skill/SKILL.md'] },
            },
        }), mainRepoRoot);
        expect(role.skillPaths).toEqual([
            path.join(os.homedir(), 'team/skill/SKILL.md'),
        ]);
    });

    it('throws on missing specialist key', () => {
        expect(() => parseSpecialistJson('x', '{}', mainRepoRoot)).toThrow(/missing 'specialist' key/);
    });

    it('throws on empty system prompt', () => {
        const bad = JSON.stringify({ specialist: { prompt: { system: '   ' } } });
        expect(() => parseSpecialistJson('x', bad, mainRepoRoot)).toThrow(/prompt.system is empty/);
    });

    it('throws on non-JSON input', () => {
        expect(() => parseSpecialistJson('x', 'not-json', mainRepoRoot)).toThrow(/did not return JSON/);
    });

    it('tolerates missing skills section (returns empty array)', () => {
        const minimal = JSON.stringify({
            specialist: { prompt: { system: 'hi' } },
        });
        const role = parseSpecialistJson('minimal', minimal, mainRepoRoot);
        expect(role.skillPaths).toEqual([]);
    });

    it('filters non-string skill paths', () => {
        const messy = JSON.stringify({
            specialist: {
                prompt: { system: 'hi' },
                skills: { paths: ['a.md', 42, null, 'b.md'] },
            },
        });
        const role = parseSpecialistJson('messy', messy, mainRepoRoot);
        expect(role.skillPaths).toEqual([
            path.resolve(mainRepoRoot, 'a.md'),
            path.resolve(mainRepoRoot, 'b.md'),
        ]);
    });

    it('honors system_prompt_mode=replace by warning and returning prompt anyway', () => {
        const replaceMode = JSON.stringify({
            specialist: {
                prompt: { system: 'ignore-base' },
                system_prompt_mode: 'replace',
            },
        });
        const role = parseSpecialistJson('replacer', replaceMode, mainRepoRoot);
        expect(role.systemPrompt).toBe('ignore-base');
    });
});

describe('buildRoleTmuxPlan', () => {
    const role = parseSpecialistJson('chain-coordinator', SAMPLE_SPECIALIST);

    it('builds session name and metadata for role+bead', () => {
        const plan = buildRoleTmuxPlan({
            runtime: 'pi',
            systemPrompt: 'ignored — pi uses --append-system-prompt <file>',
            role,
            bead: 'xtmux-2i5',
            parentSessionId: '$3',
            promptFile: '/tmp/prompt.md',
        });
        expect(plan.sessionName).toBe('role-pi-chain-coordinator-xtmux-2i5');
        expect(plan.runtimeArgs.slice(0, 2)).toEqual(['--append-system-prompt', '/tmp/prompt.md']);
        expect(plan.runtimeArgs.filter((a) => a === '--skill')).toHaveLength(2);
        const bead = plan.paneOptions.find((o) => o.key === '@agent_bead');
        expect(bead?.value).toBe('xtmux-2i5');
        const task = plan.paneOptions.find((o) => o.key === '@agent_task');
        expect(task?.value).toBe('role:chain-coordinator');
        const parent = plan.paneOptions.find((o) => o.key === '@agent_parent_session');
        expect(parent?.value).toBe('$3');
        const state = plan.paneOptions.find((o) => o.key === '@agent_state');
        expect(state?.value).toBe('idle');
        const promptFile = plan.paneOptions.find((o) => o.key === '@agent_prompt_file');
        expect(promptFile?.value).toBe('/tmp/prompt.md');
    });

    it('omits @agent_bead and bead-slug when bead is not provided', () => {
        const plan = buildRoleTmuxPlan({
            runtime: 'pi',
            systemPrompt: 'ignored — pi uses --append-system-prompt <file>',
            role,
            parentSessionId: '',
            promptFile: '/tmp/prompt.md',
        });
        expect(plan.sessionName).toBe('role-pi-chain-coordinator');
        expect(plan.paneOptions.some((o) => o.key === '@agent_bead')).toBe(false);
        const parent = plan.paneOptions.find((o) => o.key === '@agent_parent_session');
        expect(parent?.value).toBe(''); // no-tmux fallback: empty, not omitted
    });

    it('shell-quotes the pi command string', () => {
        const plan = buildRoleTmuxPlan({
            runtime: 'pi',
            systemPrompt: 'ignored — pi uses --append-system-prompt <file>',
            role,
            parentSessionId: '',
            promptFile: "/tmp/it's-mine.md",
        });
        expect(plan.runtimeCmdString.startsWith("'pi' ")).toBe(true);
        expect(plan.runtimeCmdString).toContain("'/tmp/it'\\''s-mine.md'");
    });

    it('encodes runtime in the session name so pi/claude do not collide (xtmux-3h8)', () => {
        const piPlan = buildRoleTmuxPlan({
            runtime: 'pi',
            role,
            bead: 'xtmux-3h8',
            parentSessionId: '',
            promptFile: '/tmp/p.md',
            systemPrompt: SAMPLE_SPECIALIST,
        });
        const claudePlan = buildRoleTmuxPlan({
            runtime: 'claude',
            role,
            bead: 'xtmux-3h8',
            parentSessionId: '',
            promptFile: '/tmp/p.md',
            systemPrompt: SAMPLE_SPECIALIST,
        });
        expect(piPlan.sessionName).toBe('role-pi-chain-coordinator-xtmux-3h8');
        expect(claudePlan.sessionName).toBe('role-claude-chain-coordinator-xtmux-3h8');
        expect(piPlan.sessionName).not.toBe(claudePlan.sessionName);
    });

    it('slugifies bead ids with weird characters', () => {
        const plan = buildRoleTmuxPlan({
            runtime: 'pi',
            systemPrompt: 'ignored — pi uses --append-system-prompt <file>',
            role,
            bead: 'MY BEAD/1',
            parentSessionId: '',
            promptFile: '/tmp/prompt.md',
        });
        expect(plan.sessionName).toBe('role-pi-chain-coordinator-my-bead-1');
    });

    it('does not emit --no-extensions or -e — pi discovers its own extensions', () => {
        // xtmux-3rs: prior curated allow-list emitted `-e <name>` but pi -e
        // takes a filesystem path, not a registry name. Silent crash on
        // startup. Fix drops the policy; trust pi's own discovery.
        const plan = buildRoleTmuxPlan({
            runtime: 'pi',
            systemPrompt: 'ignored — pi uses --append-system-prompt <file>',
            role,
            parentSessionId: '',
            promptFile: '/tmp/prompt.md',
        });
        expect(plan.runtimeArgs).not.toContain('--no-extensions');
        expect(plan.runtimeArgs).not.toContain('-e');
    });

    it('forwards --model / --thinking CLI overrides', () => {
        const plan = buildRoleTmuxPlan({
            runtime: 'pi',
            systemPrompt: 'ignored — pi uses --append-system-prompt <file>',
            role,
            parentSessionId: '',
            promptFile: '/tmp/prompt.md',
            modelOverride: 'gemini/gemini-3-pro',
            thinkingOverride: 'high',
        });
        const modelIdx = plan.runtimeArgs.indexOf('--model');
        expect(modelIdx).toBeGreaterThan(-1);
        expect(plan.runtimeArgs[modelIdx + 1]).toBe('gemini/gemini-3-pro');
        const thinkIdx = plan.runtimeArgs.indexOf('--thinking');
        expect(thinkIdx).toBeGreaterThan(-1);
        expect(plan.runtimeArgs[thinkIdx + 1]).toBe('high');
    });

    it('appends passthrough argv verbatim after all other flags', () => {
        const plan = buildRoleTmuxPlan({
            runtime: 'pi',
            systemPrompt: 'ignored — pi uses --append-system-prompt <file>',
            role,
            parentSessionId: '',
            promptFile: '/tmp/prompt.md',
            passthrough: ['--gitnexus-cmd', 'foo bar'],
        });
        const idx = plan.runtimeArgs.indexOf('--gitnexus-cmd');
        expect(idx).toBeGreaterThan(-1);
        expect(plan.runtimeArgs[idx + 1]).toBe('foo bar');
    });

    it('CLI --model wins over specialist.execution.model', () => {
        const roleWithModel = parseSpecialistJson('withmodel', JSON.stringify({
            specialist: {
                prompt: { system: 'x' },
                execution: { model: 'default-model', thinking_level: 'medium' },
            },
        }));
        const plan = buildRoleTmuxPlan({
            runtime: 'pi',
            systemPrompt: 'ignored — pi uses --append-system-prompt <file>',
            role: roleWithModel,
            parentSessionId: '',
            promptFile: '/tmp/prompt.md',
            modelOverride: 'override-model',
        });
        const modelIdx = plan.runtimeArgs.indexOf('--model');
        expect(plan.runtimeArgs[modelIdx + 1]).toBe('override-model');
        // thinking still uses specialist default
        const thinkIdx = plan.runtimeArgs.indexOf('--thinking');
        expect(plan.runtimeArgs[thinkIdx + 1]).toBe('medium');
    });
});

describe('buildRoleTmuxPlan (claude runtime)', () => {
    const role = parseSpecialistJson('chain-coordinator', JSON.stringify({
        specialist: {
            prompt: { system: 'You are chain-coordinator.' },
            skills: { paths: ['.xtrm/skills/x/SKILL.md'] },
            execution: { model: 'claude-opus-4-8', thinking_level: 'medium' },
        },
    }));

    it('emits --append-system-prompt with the verbatim prompt (not a file path)', () => {
        const plan = buildRoleTmuxPlan({
            runtime: 'claude',
            role,
            systemPrompt: 'You are chain-coordinator.',
            parentSessionId: '$3',
            promptFile: '/tmp/prompt.md',
        });
        expect(plan.runtimeCmd).toBe('claude');
        const idx = plan.runtimeArgs.indexOf('--append-system-prompt');
        expect(idx).toBe(0);
        expect(plan.runtimeArgs[idx + 1]).toBe('You are chain-coordinator.');
    });

    it('emits --dangerously-skip-permissions and NO --skill flags', () => {
        const plan = buildRoleTmuxPlan({
            runtime: 'claude',
            role,
            systemPrompt: 'x',
            parentSessionId: '',
            promptFile: '/tmp/p',
        });
        expect(plan.runtimeArgs).toContain('--dangerously-skip-permissions');
        expect(plan.runtimeArgs).not.toContain('--skill');
    });

    it('forwards --model but silently drops --thinking (claude has no --thinking flag)', () => {
        const plan = buildRoleTmuxPlan({
            runtime: 'claude',
            role,
            systemPrompt: 'x',
            parentSessionId: '',
            promptFile: '/tmp/p',
            thinkingOverride: 'high',
        });
        const modelIdx = plan.runtimeArgs.indexOf('--model');
        expect(modelIdx).toBeGreaterThan(-1);
        expect(plan.runtimeArgs[modelIdx + 1]).toBe('claude-opus-4-8');
        expect(plan.runtimeArgs).not.toContain('--thinking');
    });

    it('shell-quotes with claude as the runtime prefix', () => {
        const plan = buildRoleTmuxPlan({
            runtime: 'claude',
            role,
            systemPrompt: 'x',
            parentSessionId: '',
            promptFile: '/tmp/p',
        });
        expect(plan.runtimeCmdString.startsWith("'claude' ")).toBe(true);
    });

    it('appends passthrough verbatim', () => {
        const plan = buildRoleTmuxPlan({
            runtime: 'claude',
            role,
            systemPrompt: 'x',
            parentSessionId: '',
            promptFile: '/tmp/p',
            passthrough: ['--add-dir', '/notes'],
        });
        const idx = plan.runtimeArgs.indexOf('--add-dir');
        expect(idx).toBeGreaterThan(-1);
        expect(plan.runtimeArgs[idx + 1]).toBe('/notes');
    });
});

describe('buildAgentEnv', () => {
    it('exports role + prompt file + parent session id', () => {
        const env = buildAgentEnv({
            role: 'chain-coordinator',
            promptFile: '/tmp/x.md',
            parentSessionId: '$5',
        });
        expect(env.XTMUX_AGENT_TASK).toBe('role:chain-coordinator');
        expect(env.XTMUX_AGENT_PROMPT_FILE).toBe('/tmp/x.md');
        expect(env.XTMUX_AGENT_PARENT_SESSION).toBe('$5');
        expect(env.XTMUX_AGENT_BEAD).toBeUndefined();
    });

    it('includes bead when provided', () => {
        const env = buildAgentEnv({
            role: 'r',
            promptFile: '/x',
            parentSessionId: '',
            bead: 'xtmux-1lb.5',
        });
        expect(env.XTMUX_AGENT_BEAD).toBe('xtmux-1lb.5');
    });
});

describe('chooseAttachCommand', () => {
    it('uses switch-client inside an existing tmux client', () => {
        expect(chooseAttachCommand('role-x-y', true)).toEqual([
            'switch-client', '-t', 'role-x-y',
        ]);
    });

    it('uses attach-session outside tmux', () => {
        expect(chooseAttachCommand('role-x-y', false)).toEqual([
            'attach-session', '-t', 'role-x-y',
        ]);
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

describe('resolveSkillPath', () => {
    // xtmux-1rn: relative skill paths must fall back to $HOME when the
    // per-repo file doesn't exist, so global-migrated skills resolve.
    // Use a tmpdir sandbox so we don't touch the real home / repo.
    const sandbox = path.join(os.tmpdir(), `xtmux-1rn-test-${process.pid}`);
    const fakeHome = path.join(sandbox, 'home');
    const fakeRepo = path.join(sandbox, 'repo');
    const rel = '.xtrm/skills/active/multiplexing/SKILL.md';

    function setup(): void {
        rmSync(sandbox, { recursive: true, force: true });
        mkdirSync(fakeHome, { recursive: true });
        mkdirSync(fakeRepo, { recursive: true });
    }

    function teardown(): void {
        rmSync(sandbox, { recursive: true, force: true });
    }

    function withHomeEnv(fn: () => void): void {
        const prev = process.env.HOME;
        process.env.HOME = fakeHome;
        try { fn(); } finally { process.env.HOME = prev; }
    }

    it('returns repo-resolved path when file exists in mainRepoRoot', () => {
        setup();
        const repoFile = path.join(fakeRepo, rel);
        mkdirSync(path.dirname(repoFile), { recursive: true });
        writeFileSync(repoFile, '# skill');
        withHomeEnv(() => {
            expect(resolveSkillPath(fakeRepo, rel)).toBe(repoFile);
        });
        teardown();
    });

    it('falls back to $HOME when repo path is missing but home has it', () => {
        setup();
        const homeFile = path.join(fakeHome, rel);
        mkdirSync(path.dirname(homeFile), { recursive: true });
        writeFileSync(homeFile, '# global skill');
        withHomeEnv(() => {
            expect(resolveSkillPath(fakeRepo, rel)).toBe(homeFile);
        });
        teardown();
    });

    it('returns repo-resolved path when both miss (pi produces the loud error)', () => {
        setup();
        withHomeEnv(() => {
            expect(resolveSkillPath(fakeRepo, rel)).toBe(path.resolve(fakeRepo, rel));
        });
        teardown();
    });

    it('honors absolute paths verbatim (no fallback)', () => {
        expect(resolveSkillPath(fakeRepo, '/etc/hosts')).toBe('/etc/hosts');
    });

    it('expands ~ and ~/ verbatim (no fallback)', () => {
        withHomeEnv(() => {
            expect(resolveSkillPath(fakeRepo, '~')).toBe(fakeHome);
            expect(resolveSkillPath(fakeRepo, '~/foo/bar.md'))
                .toBe(path.join(fakeHome, 'foo/bar.md'));
        });
    });
});
