import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { createClaudeCommand } from '../commands/claude.js';
import { createPiCommand } from '../commands/pi.js';
import {
    assertClaudeSkillsDiscoverable,
    buildAgentEnv,
    buildBufferedRuntimeCommand,
    buildBareTmuxPlan,
    buildRoleTmuxPlan,
    checkByteCeiling,
    checkPositionZeroSlash,
    chooseAttachCommand,
    createRuntimeBufferName,
    effectiveModel,
    claudeExplicitSkillLines,
    guardRolePassthrough,
    isForeignProviderModel,
    parseSpecialistJson,
    passthroughModels,
    probeSkillPrefixAvailable,
    renderDeclaredSkillPrefix,
    renderRoleTask,
    renderSkillPrefix,
    resolveRequestedSkills,
    resolveRole,
    resolveSkillPath,
} from '../utils/worktree-session.js';

// Every plan carries the worktree + branch it publishes as lineage metadata
// (audit P1-02), so the builders require both. Tests whose subject is not
// lineage spread these in rather than restating them. xtrm-6hey0.2.
const WT = {
    worktreePath: '/repo/.xtrm/worktrees/repo-xt-pi-demo',
    branchName: 'xt/demo',
} as const;

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

// Helpers to spawn a temp sandbox with a fake `sp` binary of the caller's
// choosing. Individual tests decide how the fake responds. Keeps process env
// clean.
function withFakeSp(script: string, run: () => void): void {
    const sandbox = path.join(os.tmpdir(), `xtrm-sp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
    const bin = path.join(sandbox, 'bin');
    rmSync(sandbox, { recursive: true, force: true });
    mkdirSync(bin, { recursive: true });
    writeFileSync(path.join(bin, 'sp'), script);
    chmodSync(path.join(bin, 'sp'), 0o755);
    const previousPath = process.env.PATH;
    process.env.PATH = `${bin}:${previousPath ?? ''}`;
    try { run(); } finally {
        process.env.PATH = previousPath;
        rmSync(sandbox, { recursive: true, force: true });
    }
}

describe('renderRoleTask', () => {
    const capture = path.join(os.tmpdir(), `xtrm-render-task-capture-${process.pid}`);

    function withRenderTaskSp(fail: boolean, run: () => void): void {
        const script = `#!/usr/bin/env node
const fs = require('node:fs');
fs.writeFileSync(process.env.XTRM_RENDER_CAPTURE, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }));
if (process.env.XTRM_RENDER_FAIL === '1') {
  process.stdout.write(JSON.stringify({ ok: false, error: { code: 'bead_not_found', message: 'missing bead' } }));
  process.exit(1);
}
process.stdout.write(JSON.stringify({
  ok: true,
  initial_prompt: "line one\\n$vars and 'quotes' survive",
  prompt_hash: '0123456789abcdef',
  components: [{ kind: 'task_template', name: 'task_template', tokens: 8, bytes: 32 }],
  skills: ['~/.xtrm/skills/default/multiplexing/SKILL.md']
}));
`;
        const previousCapture = process.env.XTRM_RENDER_CAPTURE;
        const previousFail = process.env.XTRM_RENDER_FAIL;
        process.env.XTRM_RENDER_CAPTURE = capture;
        process.env.XTRM_RENDER_FAIL = fail ? '1' : '0';
        try {
            withFakeSp(script, run);
        } finally {
            process.env.XTRM_RENDER_CAPTURE = previousCapture;
            process.env.XTRM_RENDER_FAIL = previousFail;
            rmSync(capture, { force: true });
        }
    }

    it('calls the specialists renderer in the original cwd and preserves prompt bytes', () => {
        withRenderTaskSp(false, () => {
            const result = renderRoleTask({
                role: 'chain-coordinator',
                bead: 'xtrm-k2ufi',
                cwd: os.tmpdir(),
                runtime: 'claude',
            });
            expect(result.initialPrompt).toBe("line one\n$vars and 'quotes' survive");
            expect(result.promptHash).toBe('0123456789abcdef');
            const invocation = JSON.parse(readFileSync(capture, 'utf8'));
            expect(invocation.cwd).toBe(os.tmpdir());
            expect(invocation.argv).toEqual([
                'render-task', 'chain-coordinator', '--bead', 'xtrm-k2ufi',
                '--cwd', os.tmpdir(), '--context-depth', '3', '--surface', 'claude',
            ]);
        });
    });

    it('surfaces stable renderer failures before provisioning', () => {
        withRenderTaskSp(true, () => {
            expect(() => renderRoleTask({
                role: 'chain-coordinator', bead: 'missing', cwd: os.tmpdir(), runtime: 'pi',
            })).toThrow(/bead_not_found.*missing bead/);
        });
    });
});

describe('probeSkillPrefixAvailable', () => {
    it('returns ok when sp supports render-skill-prefix', () => {
        const script = `#!/usr/bin/env node
process.stdout.write("Usage: sp render-skill-prefix <name> --surface pi|claude");
process.exit(0);
`;
        withFakeSp(script, () => {
            expect(probeSkillPrefixAvailable()).toEqual({ ok: true });
        });
    });

    it('returns actionable upgrade hint when the command is missing', () => {
        const script = `#!/usr/bin/env node
process.stderr.write("error: unknown command 'render-skill-prefix'");
process.exit(1);
`;
        withFakeSp(script, () => {
            const result = probeSkillPrefixAvailable();
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error).toContain('sp render-skill-prefix not available');
                expect(result.error).toContain('@jaggerxtrm/specialists@latest');
            }
        });
    });
});

describe('renderSkillPrefix', () => {
    it('parses skill_prefix out of a success envelope', () => {
        const script = `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ ok: true, skill_prefix: '/skill:multiplexing /skill:pr-reviewer\\n\\n' }));
`;
        withFakeSp(script, () => {
            expect(renderSkillPrefix({ role: 'reviewer', runtime: 'pi' }).skillPrefix)
                .toBe('/skill:multiplexing /skill:pr-reviewer\n\n');
        });
    });

    it('returns empty string when the specialist declares no skills', () => {
        const script = `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ ok: true, skill_prefix: '' }));
`;
        withFakeSp(script, () => {
            expect(renderSkillPrefix({ role: 'blank', runtime: 'claude' }).skillPrefix).toBe('');
        });
    });

    it('throws on structured error payload', () => {
        const script = `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ ok: false, error: { code: 'not_found', message: 'no such specialist' } }));
process.exit(1);
`;
        withFakeSp(script, () => {
            expect(() => renderSkillPrefix({ role: 'ghost', runtime: 'pi' }))
                .toThrow(/not_found.*no such specialist/);
        });
    });

    it('throws on invalid JSON', () => {
        const script = `#!/usr/bin/env node
process.stdout.write("not json");
`;
        withFakeSp(script, () => {
            expect(() => renderSkillPrefix({ role: 'x', runtime: 'pi' }))
                .toThrow(/invalid JSON/);
        });
    });
});

describe('renderDeclaredSkillPrefix', () => {
    const paths = ['/skills/a/SKILL.md', '/skills/b'];

    it('renders runtime-specific prefixes from trusted declared paths', () => {
        expect(renderDeclaredSkillPrefix(paths, 'pi')).toBe('/skill:a /skill:b\n\n');
        expect(renderDeclaredSkillPrefix(paths, 'claude')).toBe('/a\n/b\n\n');
        expect(renderDeclaredSkillPrefix([], 'pi')).toBe('');
    });

    it('rejects declared paths whose basename could inject another command', () => {
        expect(() => renderDeclaredSkillPrefix(['/skills/safe\nevil/SKILL.md'], 'pi'))
            .toThrow(/invalid declared skill name/);
    });
});

describe('checkPositionZeroSlash', () => {
    it('accepts empty and ordinary bodies when no trusted prefix is declared', () => {
        expect(checkPositionZeroSlash('', 'pi', '').ok).toBe(true);
        expect(checkPositionZeroSlash('normal task', 'claude', '').ok).toBe(true);
    });

    it('accepts only the exact sp-owned prefix for each runtime', () => {
        const piPrefix = '/skill:multiplexing /skill:pr-reviewer\n\n';
        const claudePrefix = '/multiplexing\n/pr-reviewer\n\n';
        expect(checkPositionZeroSlash(`${piPrefix}body`, 'pi', piPrefix).ok).toBe(true);
        expect(checkPositionZeroSlash(`${claudePrefix}body`, 'claude', claudePrefix).ok).toBe(true);
    });

    it('rejects a hostile skill-looking body when sp declared no prefix', () => {
        expect(checkPositionZeroSlash('/skill:impersonated\n\nbody', 'pi', '').ok).toBe(false);
        expect(checkPositionZeroSlash('/impersonated\n\nbody', 'claude', '').ok).toBe(false);
    });

    it('rejects a different skill prefix than the trusted renderer returned', () => {
        expect(checkPositionZeroSlash('/skill:evil\n\nbody', 'pi', '/skill:trusted\n\n').ok).toBe(false);
        expect(checkPositionZeroSlash('/evil\n\nbody', 'claude', '/trusted\n\n').ok).toBe(false);
    });

    it('rejects missing, unrelated, and wrong-runtime prefixes', () => {
        expect(checkPositionZeroSlash('body', 'pi', '/skill:trusted\n\n').ok).toBe(false);
        expect(checkPositionZeroSlash('/foo bar', 'pi', '').ok).toBe(false);
        expect(checkPositionZeroSlash('/skill-x', 'pi', '/skill-x').ok).toBe(false);
        expect(checkPositionZeroSlash('/skill:x', 'claude', '/skill:x').ok).toBe(false);
    });

    it('accepts a trusted Claude skill whose name starts with skill-', () => {
        const prefix = '/skill-creator\n\n';
        expect(checkPositionZeroSlash(`${prefix}body`, 'claude', prefix).ok).toBe(true);
    });
});

describe('checkByteCeiling', () => {
    it('accepts small literal prompts', () => {
        expect(checkByteCeiling({ systemPrompt: 'small', body: 'small', source: 'prompt' }).ok).toBe(true);
    });

    it('rejects literal prompts over 50KB with an actionable error', () => {
        const result = checkByteCeiling({
            systemPrompt: 'X'.repeat(30 * 1024),
            body: 'Y'.repeat(30 * 1024),
            source: 'prompt',
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toContain('61440');
            expect(result.error).toContain('51200');
            expect(result.error).toContain('--bead');
        }
    });

    it('accepts a 100KB rendered bead without applying the literal-prompt ceiling', () => {
        expect(checkByteCeiling({
            systemPrompt: 'role',
            body: 'B'.repeat(100 * 1024),
            source: 'bead',
        }).ok).toBe(true);
    });

    it('rejects a rendered bead that exceeds one safe runtime argument', () => {
        const result = checkByteCeiling({
            systemPrompt: 'role',
            body: 'B'.repeat(128 * 1024),
            source: 'bead',
        });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toContain('runtime argument ceiling');
    });

    it('rejects NUL bytes before spawning a runtime', () => {
        const result = checkByteCeiling({ systemPrompt: 'role', body: 'a\0b', source: 'bead' });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toContain('NUL');
    });
});

describe('role command flags', () => {
    it.each([
        ['pi', createPiCommand],
        ['claude', createClaudeCommand],
    ] as const)('documents repeatable --skill for xt %s', (_runtime, createCommand) => {
        const command = createCommand();
        const help = command.helpInformation();
        expect(help).toContain('--skill <name-or-path>');
        expect(help).toContain('repeatable');
        command.parseOptions(['--role', 'reviewer', '--skill', 'one', '--skill', 'two']);
        expect(command.opts().skill).toEqual(['one', 'two']);

        const passthroughCommand = createCommand().exitOverride().action(() => undefined);
        expect(() => passthroughCommand.parse([
            'node', 'xt', 'session', '--role', 'reviewer', '--', '--no-tools',
        ])).not.toThrow();
    });

    it.each([
        ['pi', createPiCommand],
        ['claude', createClaudeCommand],
    ] as const)('documents --prompt on xt %s', (_runtime, createCommand) => {
        const command = createCommand();
        const help = command.helpInformation();
        expect(help).toContain('--prompt <text>');
        // commander may wrap 'mutually\n  exclusive' — match tolerant of whitespace
        expect(help).toMatch(/mutually\s+exclusive/);
        command.parseOptions(['--role', 'reviewer', '--prompt', 'do the thing']);
        expect(command.opts().prompt).toBe('do the thing');
    });
});

describe('resolveRole surface model contract', () => {
    const capture = path.join(os.tmpdir(), `xtrm-role-view-capture-${process.pid}`);

    afterEach(() => rmSync(capture, { force: true }));

    it('requests Claude surface resolution and leaves a null role model unset', () => {
        const script = `#!/usr/bin/env node
const fs = require('node:fs');
fs.writeFileSync(process.env.XTRM_ROLE_VIEW_CAPTURE, JSON.stringify(process.argv.slice(2)));
process.stdout.write(JSON.stringify({ specialist: { prompt: { system: 'role' }, execution: { model: null } } }));
`;
        const previousCapture = process.env.XTRM_ROLE_VIEW_CAPTURE;
        process.env.XTRM_ROLE_VIEW_CAPTURE = capture;
        try {
            withFakeSp(script, () => {
                const role = resolveRole('chain-coordinator', '/repo/root', 'claude');
                expect(role.model).toBeUndefined();
            });
            expect(JSON.parse(readFileSync(capture, 'utf8'))).toEqual([
                'view', 'chain-coordinator', '--raw', '--surface', 'claude',
            ]);
        } finally {
            process.env.XTRM_ROLE_VIEW_CAPTURE = previousCapture;
        }
    });

    it('keeps Pi legacy resolution when an older Specialists lacks --surface', () => {
        const script = `#!/usr/bin/env node
if (process.argv.includes('--surface')) {
  process.stderr.write("unknown option '--surface'");
  process.exit(1);
}
process.stdout.write(JSON.stringify({ specialist: { prompt: { system: 'role' }, execution: { model: 'openai-codex/gpt-5.6-luna' } } }));
`;
        withFakeSp(script, () => {
            const role = resolveRole('chain-coordinator', '/repo/root', 'pi');
            expect(role.model).toBe('openai-codex/gpt-5.6-luna');
        });
    });

    it('fails clearly instead of falling back for old Claude Specialists', () => {
        const script = `#!/usr/bin/env node
process.stderr.write("unknown option '--surface'");
process.exit(1);
`;
        withFakeSp(script, () => {
            expect(() => resolveRole('chain-coordinator', '/repo/root', 'claude'))
                .toThrow(/surface-aware Claude model resolution.*upgrade/);
        });
    });

    it('allows an explicit Claude model to use legacy Specialists resolution', () => {
        const script = `#!/usr/bin/env node
if (process.argv.includes('--surface')) {
  process.stderr.write("unknown option '--surface'");
  process.exit(1);
}
process.stdout.write(JSON.stringify({ specialist: { prompt: { system: 'role' }, execution: { model: 'openai-codex/gpt-5.6-luna' } } }));
`;
        withFakeSp(script, () => {
            const role = resolveRole('chain-coordinator', '/repo/root', 'claude', true);
            expect(role.model).toBe('openai-codex/gpt-5.6-luna');
        });
    });
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

describe('buildBareTmuxPlan', () => {
    it('forwards prompt and model to Claude without role metadata', () => {
        const plan = buildBareTmuxPlan({ ...WT,
            runtime: 'claude',
            sessionSlug: 'demo',
            parentSessionId: '',
            turn1Body: 'echo hi',
            modelOverride: 'claude-opus-4-8',
            thinkingOverride: 'high',
        });

        expect(plan.sessionName).toBe('claude-demo');
        expect(plan.runtimeArgs).toEqual([
            '--dangerously-skip-permissions',
            '--model', 'claude-opus-4-8',
            '--', 'echo hi',
        ]);
    });

    it('emits no --append-system-prompt and no --no-skills for pi', () => {
        const plan = buildBareTmuxPlan({ ...WT,
            runtime: 'pi',
            sessionSlug: 'demo',
            parentSessionId: '',
            turn1Body: 'hi',
            thinkingOverride: 'high',
        });

        expect(plan.sessionName).toBe('pi-demo');
        expect(plan.runtimeArgs).not.toContain('--append-system-prompt');
        expect(plan.runtimeArgs).not.toContain('--no-skills');
        // pi takes the positional without a `--` delimiter.
        expect(plan.runtimeArgs).toEqual(['--thinking', 'high', 'hi']);
    });

    it('pushes explicit --skill paths to pi argv (bare mode)', () => {
        const plan = buildBareTmuxPlan({ ...WT,
            runtime: 'pi',
            sessionSlug: 'demo',
            parentSessionId: '',
            turn1Body: '',
            explicitSkillPaths: ['/skills/multiplexing', '/skills/multiplexing', '/skills/planning'],
        });

        // Deduped, order preserved, no turn-1 positional when the body is empty.
        expect(plan.runtimeArgs).toEqual([
            '--skill', '/skills/multiplexing',
            '--skill', '/skills/planning',
        ]);
    });

    it('binds --bead as pane + session metadata without touching the session name', () => {
        const plan = buildBareTmuxPlan({ ...WT,
            runtime: 'claude',
            sessionSlug: 'demo',
            bead: 'xtrm-3xgs5',
            parentSessionId: '$7',
            turn1Body: 'hi',
        });

        // Bare session identity is the slug alone — the bead does not enter it.
        expect(plan.sessionName).toBe('claude-demo');
        expect(plan.paneOptions).toEqual([
            { key: '@agent_parent_session', value: '$7' },
            { key: '@agent_task', value: 'session:demo' },
            { key: '@agent_state', value: 'idle' },
            { key: '@agent_worktree', value: WT.worktreePath },
            { key: '@agent_branch', value: WT.branchName },
            { key: '@agent_bead', value: 'xtrm-3xgs5' },
        ]);
        // A bare session has no role to publish.
        expect(plan.paneOptions.some((o) => o.key === '@agent_role')).toBe(false);
    });

    it('appends guard-checked passthrough before the turn-1 positional', () => {
        const plan = buildBareTmuxPlan({ ...WT,
            runtime: 'claude',
            sessionSlug: 'demo',
            parentSessionId: '',
            turn1Body: 'hi',
            passthrough: ['--add-dir', '/notes'],
        });

        expect(plan.runtimeArgs).toEqual([
            '--dangerously-skip-permissions',
            '--add-dir', '/notes',
            '--', 'hi',
        ]);
    });
});

describe('buildRoleTmuxPlan (pi runtime)', () => {
    const role = parseSpecialistJson('chain-coordinator', SAMPLE_SPECIALIST);

    it('inlines system prompt and emits --no-skills unconditionally', () => {
        const plan = buildRoleTmuxPlan({ ...WT,
            runtime: 'pi',
            role,
            bead: 'xtmux-2i5',
            parentSessionId: '$3',
            turn1Body: '/skill:a /skill:b\n\ntask body',
        });
        expect(plan.sessionName).toBe('role-pi-chain-coordinator-xtmux-2i5');
        // Inline system prompt — first two args
        expect(plan.runtimeArgs[0]).toBe('--append-system-prompt');
        expect(plan.runtimeArgs[1]).toContain('chain coordinator');
        expect(plan.runtimeArgs).toContain('--no-skills');
        // Pool isolation combined with explicit skills from role
        expect(plan.runtimeArgs.filter((a) => a === '--skill')).toHaveLength(2);
        // Turn-1 body is the last positional (pi convention: no `--` delimiter)
        expect(plan.runtimeArgs.at(-1)).toBe('/skill:a /skill:b\n\ntask body');
        expect(plan.runtimeArgs).not.toContain('--');
        const bead = plan.paneOptions.find((o) => o.key === '@agent_bead');
        expect(bead?.value).toBe('xtmux-2i5');
        const task = plan.paneOptions.find((o) => o.key === '@agent_task');
        expect(task?.value).toBe('role:chain-coordinator');
        const parent = plan.paneOptions.find((o) => o.key === '@agent_parent_session');
        expect(parent?.value).toBe('$3');
        const state = plan.paneOptions.find((o) => o.key === '@agent_state');
        expect(state?.value).toBe('idle');
        // xtrm-8zsi1: no more prompt-file transport
        expect(plan.paneOptions.some((o) => o.key === '@agent_prompt_file')).toBe(false);
        // xtrm-6hey0.2: lineage the P1-02 invariant guarantees but nothing
        // downstream could observe before.
        const worktree = plan.paneOptions.find((o) => o.key === '@agent_worktree');
        expect(worktree?.value).toBe(WT.worktreePath);
        const branch = plan.paneOptions.find((o) => o.key === '@agent_branch');
        expect(branch?.value).toBe(WT.branchName);
        const roleOption = plan.paneOptions.find((o) => o.key === '@agent_role');
        expect(roleOption?.value).toBe('chain-coordinator');
    });

    it('omits @agent_bead and bead-slug when bead is not provided', () => {
        const plan = buildRoleTmuxPlan({ ...WT,
            runtime: 'pi',
            role,
            parentSessionId: '',
            turn1Body: '',
        });
        expect(plan.sessionName).toBe('role-pi-chain-coordinator');
        expect(plan.paneOptions.some((o) => o.key === '@agent_bead')).toBe(false);
        const parent = plan.paneOptions.find((o) => o.key === '@agent_parent_session');
        expect(parent?.value).toBe('');
    });

    it('omits positional when turn1Body is empty (skills-only prime)', () => {
        const plan = buildRoleTmuxPlan({ ...WT,
            runtime: 'pi',
            role,
            parentSessionId: '',
            turn1Body: '',
        });
        // No trailing positional at all
        expect(plan.runtimeArgs.every((a) => a.startsWith('--') || plan.runtimeArgs.indexOf(a) === plan.runtimeArgs.indexOf('--append-system-prompt') + 1 || plan.runtimeArgs.indexOf(a) > 0)).toBe(true);
        expect(plan.runtimeArgs).not.toContain('');
    });

    it('shell-quotes the pi command string including single quotes in body', () => {
        const plan = buildRoleTmuxPlan({ ...WT,
            runtime: 'pi',
            role,
            parentSessionId: '',
            turn1Body: "hello it's mine",
        });
        expect(plan.runtimeCmdString.startsWith("'pi' ")).toBe(true);
        expect(plan.runtimeCmdString).toContain("'hello it'\\''s mine'");
    });

    it('encodes runtime in the session name so pi/claude do not collide (xtmux-3h8)', () => {
        const piPlan = buildRoleTmuxPlan({ ...WT,
            runtime: 'pi',
            role,
            bead: 'xtmux-3h8',
            parentSessionId: '',
            turn1Body: '',
        });
        const claudePlan = buildRoleTmuxPlan({ ...WT,
            runtime: 'claude',
            role,
            bead: 'xtmux-3h8',
            parentSessionId: '',
            turn1Body: '',
        });
        expect(piPlan.sessionName).toBe('role-pi-chain-coordinator-xtmux-3h8');
        expect(claudePlan.sessionName).toBe('role-claude-chain-coordinator-xtmux-3h8');
    });

    it('slugifies bead ids with weird characters', () => {
        const plan = buildRoleTmuxPlan({ ...WT,
            runtime: 'pi',
            role,
            bead: 'MY BEAD/1',
            parentSessionId: '',
            turn1Body: '',
        });
        expect(plan.sessionName).toBe('role-pi-chain-coordinator-my-bead-1');
    });

    it('does not emit --no-extensions or -e — pi discovers its own extensions', () => {
        const plan = buildRoleTmuxPlan({ ...WT,
            runtime: 'pi',
            role,
            parentSessionId: '',
            turn1Body: '',
        });
        expect(plan.runtimeArgs).not.toContain('--no-extensions');
        expect(plan.runtimeArgs).not.toContain('-e');
    });

    it('keeps the Pi surface-resolved provider model unchanged', () => {
        const plan = buildRoleTmuxPlan({ ...WT,
            runtime: 'pi',
            role: { ...role, model: 'openai-codex/gpt-5.6-luna' },
            parentSessionId: '',
            turn1Body: '',
        });
        const modelIdx = plan.runtimeArgs.indexOf('--model');
        expect(plan.runtimeArgs[modelIdx + 1]).toBe('openai-codex/gpt-5.6-luna');
    });

    it('forwards --model / --thinking CLI overrides', () => {
        const plan = buildRoleTmuxPlan({ ...WT,
            runtime: 'pi',
            role,
            parentSessionId: '',
            turn1Body: '',
            modelOverride: 'gemini/gemini-3-pro',
            thinkingOverride: 'high',
        });
        const modelIdx = plan.runtimeArgs.indexOf('--model');
        expect(plan.runtimeArgs[modelIdx + 1]).toBe('gemini/gemini-3-pro');
        const thinkIdx = plan.runtimeArgs.indexOf('--thinking');
        expect(plan.runtimeArgs[thinkIdx + 1]).toBe('high');
    });

    it('appends passthrough argv verbatim after all other flags', () => {
        const plan = buildRoleTmuxPlan({ ...WT,
            runtime: 'pi',
            role,
            parentSessionId: '',
            turn1Body: 'body',
            passthrough: ['--gitnexus-cmd', 'foo bar'],
        });
        const idx = plan.runtimeArgs.indexOf('--gitnexus-cmd');
        expect(plan.runtimeArgs[idx + 1]).toBe('foo bar');
        // passthrough sits before the positional body
        expect(plan.runtimeArgs.at(-1)).toBe('body');
    });

    it('deduplicates explicit skills against declared skills (symlink aware)', () => {
        const sandbox = path.join(os.tmpdir(), `xtrm-plan-skill-${process.pid}`);
        const skillRoot = path.join(sandbox, 'skill');
        const aliasRoot = path.join(sandbox, 'alias');
        rmSync(sandbox, { recursive: true, force: true });
        mkdirSync(skillRoot, { recursive: true });
        writeFileSync(path.join(skillRoot, 'SKILL.md'), '# skill');
        symlinkSync(skillRoot, aliasRoot, 'dir');
        try {
            const plan = buildRoleTmuxPlan({ ...WT,
                runtime: 'pi',
                role: { ...role, skillPaths: [path.join(aliasRoot, 'SKILL.md')] },
                explicitSkillPaths: [path.join(skillRoot, 'SKILL.md')],
                parentSessionId: '',
                turn1Body: '',
            });
            expect(plan.runtimeArgs.filter((arg) => arg === '--skill')).toHaveLength(1);
        } finally {
            rmSync(sandbox, { recursive: true, force: true });
        }
    });

    it('CLI --model wins over specialist.execution.model', () => {
        const roleWithModel = parseSpecialistJson('withmodel', JSON.stringify({
            specialist: {
                prompt: { system: 'x' },
                execution: { model: 'default-model', thinking_level: 'medium' },
            },
        }));
        const plan = buildRoleTmuxPlan({ ...WT,
            runtime: 'pi',
            role: roleWithModel,
            parentSessionId: '',
            turn1Body: '',
            modelOverride: 'override-model',
        });
        const modelIdx = plan.runtimeArgs.indexOf('--model');
        expect(plan.runtimeArgs[modelIdx + 1]).toBe('override-model');
        const thinkIdx = plan.runtimeArgs.indexOf('--thinking');
        expect(plan.runtimeArgs[thinkIdx + 1]).toBe('medium');
    });
});

describe('isForeignProviderModel', () => {
    it.each([
        'qwencloud/qwen3.8-max-preview', 'openai-codex/gpt-5.4', 'gemini/gemini-3-pro',
        'Qwen-CLI/qwen3-coder', 'zai-coding-cn/glm-5', 'nano-gpt/moonshotai/kimi-k2.6',
        // Outer provider decides — a nested anthropic model is still an
        // OpenRouter id claude cannot run (Codex P1 on PR #511).
        'openrouter/anthropic/claude-sonnet-4.6',
    ])('flags the pi provider/model shape: %s', (model) => {
        expect(isForeignProviderModel(model)).toBe(true);
    });

    it.each([
        // Claude ids, aliases and vendor forms.
        'opus', 'sonnet[1m]', 'claude-opus-5', 'claude-opus-4-1@20250805',
        'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
        // Bedrock application-inference-profile ARN — a valid --model with no
        // 'claude' in it. Must never be refused (Codex P1 on PR #511).
        'arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/abc123',
        // Custom / unrecognised gateways stay the operator's call, slash or not
        // (docs/xt-pi-role.md: explicit custom-provider identifiers win).
        'anthropic/claude-sonnet-5', 'acme/production', 'my-custom-model', '', '   ',
        // Vendor-prefixed gateway names are not the vendor (Codex P2 on PR #511).
        'openai-compatible/production', 'google-proxy/claude',
    ])('leaves %s alone', (model) => {
        expect(isForeignProviderModel(model)).toBe(false);
    });
});

describe('passthroughModels', () => {
    it.each([
        [['--model', 'qwencloud/qwen3.8-max-preview'], ['qwencloud/qwen3.8-max-preview']],
        [['--add-dir', '~/n', '--model=opus'], ['opus']],
        [['--add-dir', '~/notes'], []],
        [['--model'], []],
        // Every occurrence, not the first: the tail is forwarded verbatim, so a
        // later value wins at the runtime (Codex P2 on PR #511).
        [['--model', 'opus', '--model=qwencloud/qwen3.8-max-preview'], ['opus', 'qwencloud/qwen3.8-max-preview']],
        // After the operator's own `--`, `--model` is positional text.
        [['--', '--model', 'qwencloud/qwen3.8-max-preview'], []],
    ])('reads %s', (passthrough, expected) => {
        expect(passthroughModels(passthrough as string[])).toEqual(expected);
    });
});

// Last --model wins at the runtime; only that one is worth validating.
describe('effectiveModel', () => {
    it.each([
        [undefined, [], undefined],
        ['opus', [], 'opus'],
        [undefined, ['--model', 'opus'], 'opus'],
        // Tail overrides the native flag (Codex P2: safe native must not mask it).
        ['opus', ['--model', 'qwencloud/qwen3.8-max-preview'], 'qwencloud/qwen3.8-max-preview'],
        // ...and an overridden foreign value must not block a valid launch.
        [undefined, ['--model', 'qwencloud/qwen3.8-max-preview', '--model', 'opus'], 'opus'],
    ])('resolves (%s, %s)', (model, passthrough, expected) => {
        expect(effectiveModel(model as string | undefined, passthrough as string[])).toBe(expected);
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

    it('inlines --append-system-prompt (xtrm-8zsi1 supersedes xtrm-osipt file transport)', () => {
        const plan = buildRoleTmuxPlan({ ...WT,
            runtime: 'claude',
            role,
            parentSessionId: '$3',
            turn1Body: '/x\n\nbody',
        });
        expect(plan.runtimeCmd).toBe('claude');
        expect(plan.runtimeArgs[0]).toBe('--append-system-prompt');
        expect(plan.runtimeArgs[1]).toBe('You are chain-coordinator.');
        expect(plan.runtimeArgs).not.toContain('--append-system-prompt-file');
        expect(plan.runtimeArgs).toContain('--dangerously-skip-permissions');
    });

    it('emits `--` before positional turn-1 body (claude variadic-flag safety)', () => {
        const plan = buildRoleTmuxPlan({ ...WT,
            runtime: 'claude',
            role,
            parentSessionId: '',
            turn1Body: '/x\n\nbody',
        });
        expect(plan.runtimeArgs.slice(-2)).toEqual(['--', '/x\n\nbody']);
    });

    it('omits `--` and positional when turn1Body is empty (skills-only prime)', () => {
        const plan = buildRoleTmuxPlan({ ...WT,
            runtime: 'claude',
            role,
            parentSessionId: '',
            turn1Body: '',
        });
        expect(plan.runtimeArgs).not.toContain('--');
        expect(plan.runtimeArgs.at(-1)).not.toBe('');
    });

    it('emits NO --skill and NO --plugin-dir on claude (xtrm-8zsi1 drops ephemeral plugin)', () => {
        const plan = buildRoleTmuxPlan({ ...WT,
            runtime: 'claude',
            role,
            parentSessionId: '',
            turn1Body: 'x',
            explicitSkillPaths: ['/some/skill/SKILL.md'],
        });
        expect(plan.runtimeArgs).not.toContain('--skill');
        expect(plan.runtimeArgs).not.toContain('--plugin-dir');
    });

    it('preserves an explicit Claude model override over a cross-provider role default', () => {
        const plan = buildRoleTmuxPlan({ ...WT,
            runtime: 'claude',
            role: { ...role, model: 'openai-codex/gpt-5.6-luna' },
            parentSessionId: '',
            turn1Body: '',
            modelOverride: 'opus',
            thinkingOverride: 'high',
        });
        const modelIdx = plan.runtimeArgs.indexOf('--model');
        expect(plan.runtimeArgs[modelIdx + 1]).toBe('opus');
        expect(plan.runtimeArgs).not.toContain('openai-codex/gpt-5.6-luna');
        expect(plan.runtimeArgs).not.toContain('--thinking');
    });

    // xtrm-wiy5n.4.19: sp view --surface claude falls back to the pi-surface
    // execution.model when no surface_models.claude is declared, so a role
    // default like qwencloud/… reaches the launcher. Forwarding it spawned a
    // live session that died at turn 1.
    it('drops a cross-provider role default so claude inherits the parent model', () => {
        const plan = buildRoleTmuxPlan({ ...WT,
            runtime: 'claude',
            role: { ...role, model: 'qwencloud/qwen3.8-max-preview' },
            parentSessionId: '',
            turn1Body: '',
        });
        expect(plan.runtimeArgs).not.toContain('--model');
        expect(plan.runtimeArgs).not.toContain('qwencloud/qwen3.8-max-preview');
    });

    it('keeps a Bedrock inference-profile ARN role default', () => {
        const arn = 'arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/abc123';
        const plan = buildRoleTmuxPlan({ ...WT,
            runtime: 'claude',
            role: { ...role, model: arn },
            parentSessionId: '',
            turn1Body: '',
        });
        const modelIdx = plan.runtimeArgs.indexOf('--model');
        expect(plan.runtimeArgs[modelIdx + 1]).toBe(arn);
    });

    it('keeps a Claude role default', () => {
        const plan = buildRoleTmuxPlan({ ...WT,
            runtime: 'claude',
            role,
            parentSessionId: '',
            turn1Body: '',
        });
        const modelIdx = plan.runtimeArgs.indexOf('--model');
        expect(plan.runtimeArgs[modelIdx + 1]).toBe('claude-opus-4-8');
    });

    it('omits --model for a surface-resolved Claude default', () => {
        const plan = buildRoleTmuxPlan({ ...WT,
            runtime: 'claude',
            role: { ...role, model: undefined },
            parentSessionId: '',
            turn1Body: '',
        });
        expect(plan.runtimeArgs).not.toContain('--model');
    });

    it('shell-quotes with claude as the runtime prefix and inlines the system prompt safely', () => {
        const plan = buildRoleTmuxPlan({ ...WT,
            runtime: 'claude',
            role,
            parentSessionId: '',
            turn1Body: '',
        });
        expect(plan.runtimeCmdString.startsWith("'claude' ")).toBe(true);
        expect(plan.runtimeCmdString).toContain("'You are chain-coordinator.'");
    });

    it('appends passthrough verbatim (before positional body)', () => {
        const plan = buildRoleTmuxPlan({ ...WT,
            runtime: 'claude',
            role,
            parentSessionId: '',
            turn1Body: 'body',
            passthrough: ['--add-dir', '/notes'],
        });
        const idx = plan.runtimeArgs.indexOf('--add-dir');
        expect(plan.runtimeArgs[idx + 1]).toBe('/notes');
        // positional body is still last
        expect(plan.runtimeArgs.at(-1)).toBe('body');
    });

    it('keeps runtimeCmdString bounded when body is under the byte ceiling', () => {
        const almostFull = 'X'.repeat(40 * 1024);
        const plan = buildRoleTmuxPlan({ ...WT,
            runtime: 'claude',
            role,
            parentSessionId: '',
            turn1Body: almostFull,
        });
        // The 40KB body IS inline now (unlike the xtrm-osipt stopgap which
        // wrote it to a file). This is fine because launchWorktreeSession
        // enforces the byte ceiling before we ever reach here.
        expect(plan.runtimeCmdString.length).toBeGreaterThan(40 * 1024);
        expect(plan.runtimeCmdString.length).toBeLessThan(50 * 1024);
    });
});

describe('buildAgentEnv', () => {
    const role = parseSpecialistJson('chain-coordinator', SAMPLE_SPECIALIST);

    it('exports role + parent session id (no more XTMUX_AGENT_PROMPT_FILE)', () => {
        const env = buildAgentEnv(buildRoleTmuxPlan({
            ...WT,
            runtime: 'pi',
            role,
            parentSessionId: '$5',
            turn1Body: '',
        }).paneOptions);
        expect(env.XTMUX_AGENT_TASK).toBe('role:chain-coordinator');
        expect(env.XTMUX_AGENT_PARENT_SESSION).toBe('$5');
        expect(env.XTMUX_AGENT_BEAD).toBeUndefined();
        expect(env.XTMUX_AGENT_PROMPT_FILE).toBeUndefined();
    });

    it('includes bead when provided', () => {
        const env = buildAgentEnv(buildRoleTmuxPlan({
            ...WT,
            runtime: 'pi',
            role,
            parentSessionId: '',
            bead: 'xtmux-1lb.5',
            turn1Body: '',
        }).paneOptions);
        expect(env.XTMUX_AGENT_BEAD).toBe('xtmux-1lb.5');
    });

    // Env is derived from the pane options so the two can never drift; the
    // pair that used to be built by hand in two places is what this proves.
    it('mirrors every pane option except the launcher-local @agent_state', () => {
        const env = buildAgentEnv(buildRoleTmuxPlan({
            ...WT,
            runtime: 'pi',
            role,
            parentSessionId: '$5',
            bead: 'xtrm-6hey0',
            turn1Body: '',
        }).paneOptions);
        expect(env).toEqual({
            XTMUX_AGENT_PARENT_SESSION: '$5',
            XTMUX_AGENT_TASK: 'role:chain-coordinator',
            XTMUX_AGENT_WORKTREE: WT.worktreePath,
            XTMUX_AGENT_BRANCH: WT.branchName,
            XTMUX_AGENT_BEAD: 'xtrm-6hey0',
            XTMUX_AGENT_ROLE: 'chain-coordinator',
        });
        expect(env.XTMUX_AGENT_STATE).toBeUndefined();
    });

    it('omits XTMUX_AGENT_ROLE for a bare session', () => {
        const env = buildAgentEnv(buildBareTmuxPlan({
            ...WT,
            runtime: 'claude',
            sessionSlug: 'demo',
            parentSessionId: '$5',
            turn1Body: '',
        }).paneOptions);
        expect(env.XTMUX_AGENT_TASK).toBe('session:demo');
        expect(env.XTMUX_AGENT_ROLE).toBeUndefined();
        expect(env.XTMUX_AGENT_WORKTREE).toBe(WT.worktreePath);
        expect(env.XTMUX_AGENT_BRANCH).toBe(WT.branchName);
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

    it('rejects passthrough --skill so validation cannot be bypassed', () => {
        const r = guardRolePassthrough(['--skill', 'missing']);
        expect(r.guardedError).toMatch(/--skill/);
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

describe('resolveRequestedSkills', () => {
    const sandbox = path.join(os.tmpdir(), `xtrm-requested-skills-${process.pid}`);
    const fakeHome = path.join(sandbox, 'home');
    const fakeRepo = path.join(sandbox, 'repo');

    it('resolves installed names and explicit paths, deduplicated in request order', () => {
        rmSync(sandbox, { recursive: true, force: true });
        const installed = path.join(fakeHome, '.pi', 'agent', 'skills', 'multiplexing', 'SKILL.md');
        const explicit = path.join(fakeRepo, 'skills', 'local', 'SKILL.md');
        mkdirSync(path.dirname(installed), { recursive: true });
        mkdirSync(path.dirname(explicit), { recursive: true });
        writeFileSync(installed, '# global');
        writeFileSync(explicit, '# local');
        const previousHome = process.env.HOME;
        process.env.HOME = fakeHome;
        try {
            expect(resolveRequestedSkills(fakeRepo, ['multiplexing', explicit, 'multiplexing']))
                .toEqual([installed, explicit]);
        } finally {
            process.env.HOME = previousHome;
            rmSync(sandbox, { recursive: true, force: true });
        }
    });

    it('deduplicates symlink aliases of the same skill', () => {
        rmSync(sandbox, { recursive: true, force: true });
        const skill = path.join(fakeHome, '.xtrm', 'skills', 'default', 'multiplexing');
        const alias = path.join(fakeHome, '.pi', 'agent', 'skills', 'multiplexing');
        mkdirSync(skill, { recursive: true });
        mkdirSync(path.dirname(alias), { recursive: true });
        writeFileSync(path.join(skill, 'SKILL.md'), '# global');
        symlinkSync(skill, alias, 'dir');
        const previousHome = process.env.HOME;
        process.env.HOME = fakeHome;
        try {
            expect(resolveRequestedSkills(fakeRepo, ['multiplexing', path.join(skill, 'SKILL.md')]))
                .toEqual([path.join(skill, 'SKILL.md')]);
        } finally {
            process.env.HOME = previousHome;
            rmSync(sandbox, { recursive: true, force: true });
        }
    });

    it('fails clearly when a requested skill is not installed', () => {
        rmSync(sandbox, { recursive: true, force: true });
        mkdirSync(fakeHome, { recursive: true });
        mkdirSync(fakeRepo, { recursive: true });
        const previousHome = process.env.HOME;
        process.env.HOME = fakeHome;
        try {
            expect(() => resolveRequestedSkills(fakeRepo, ['missing-skill']))
                .toThrow(/skill 'missing-skill' not found/);
        } finally {
            process.env.HOME = previousHome;
            rmSync(sandbox, { recursive: true, force: true });
        }
    });

    it('rejects an existing path that is not a skill before provisioning', () => {
        rmSync(sandbox, { recursive: true, force: true });
        mkdirSync(fakeRepo, { recursive: true });
        const notSkill = path.join(fakeRepo, 'README.md');
        writeFileSync(notSkill, '# not a skill');
        try {
            expect(() => resolveRequestedSkills(fakeRepo, [notSkill]))
                .toThrow(/not a skill/);
        } finally {
            rmSync(sandbox, { recursive: true, force: true });
        }
    });
});

describe('assertClaudeSkillsDiscoverable', () => {
    const sandbox = path.join(os.tmpdir(), `claude-skill-discovery-${process.pid}`);
    const fakeHome = path.join(sandbox, 'home');
    const fakeRepo = path.join(sandbox, 'repo');

    it('accepts a requested skill only when Claude discovers the same canonical path', () => {
        const skill = path.join(fakeHome, '.xtrm', 'skills', 'default', 'foo');
        const pointer = path.join(fakeHome, '.claude', 'skills', 'foo');
        mkdirSync(skill, { recursive: true });
        mkdirSync(path.dirname(pointer), { recursive: true });
        writeFileSync(path.join(skill, 'SKILL.md'), '# foo');
        symlinkSync(skill, pointer, 'dir');
        const previousHome = process.env.HOME;
        process.env.HOME = fakeHome;
        try {
            expect(() => assertClaudeSkillsDiscoverable(fakeRepo, [path.join(skill, 'SKILL.md')]))
                .not.toThrow();
        } finally {
            process.env.HOME = previousHome;
            rmSync(sandbox, { recursive: true, force: true });
        }
    });

    it('rejects a discoverable path whose name could inject another slash command', () => {
        const skill = path.join(fakeHome, '.xtrm', 'skills', 'default', 'safe\nevil');
        const pointer = path.join(fakeHome, '.claude', 'skills', 'safe\nevil');
        mkdirSync(skill, { recursive: true });
        mkdirSync(path.dirname(pointer), { recursive: true });
        writeFileSync(path.join(skill, 'SKILL.md'), '# unsafe name');
        symlinkSync(skill, pointer, 'dir');
        const previousHome = process.env.HOME;
        process.env.HOME = fakeHome;
        try {
            expect(() => assertClaudeSkillsDiscoverable(fakeRepo, [path.join(skill, 'SKILL.md')]))
                .toThrow(/invalid Claude skill name/);
        } finally {
            process.env.HOME = previousHome;
            rmSync(sandbox, { recursive: true, force: true });
        }
    });

    it('rejects a same-name skill whose canonical path differs', () => {
        const requested = path.join(sandbox, 'external', 'foo');
        const discovered = path.join(fakeHome, '.claude', 'skills', 'foo');
        mkdirSync(requested, { recursive: true });
        mkdirSync(discovered, { recursive: true });
        writeFileSync(path.join(requested, 'SKILL.md'), '# requested');
        writeFileSync(path.join(discovered, 'SKILL.md'), '# discovered');
        const previousHome = process.env.HOME;
        process.env.HOME = fakeHome;
        try {
            expect(() => assertClaudeSkillsDiscoverable(fakeRepo, [path.join(requested, 'SKILL.md')]))
                .toThrow(/not discoverable by Claude as '\/foo'/);
        } finally {
            process.env.HOME = previousHome;
            rmSync(sandbox, { recursive: true, force: true });
        }
    });

    it('rejects an arbitrary path that Claude cannot discover', () => {
        const skill = path.join(sandbox, 'external', 'foo');
        mkdirSync(skill, { recursive: true });
        writeFileSync(path.join(skill, 'SKILL.md'), '# foo');
        const previousHome = process.env.HOME;
        process.env.HOME = fakeHome;
        try {
            expect(() => assertClaudeSkillsDiscoverable(fakeRepo, [path.join(skill, 'SKILL.md')]))
                .toThrow(/not discoverable by Claude as '\/foo'/);
        } finally {
            process.env.HOME = previousHome;
            rmSync(sandbox, { recursive: true, force: true });
        }
    });
});

describe('buildBufferedRuntimeCommand', () => {
    it('keeps untrusted runtime content out of the command and cleans up on consume or signal', () => {
        const command = buildBufferedRuntimeCommand('xtrm-role-safe');
        expect(command).toContain('consumer-ready');
        expect(command).toContain('timeout: 5000');
        expect(command).toContain('show-buffer');
        expect(command).toContain('delete-buffer');
        expect(command).toContain('SIGINT');
        expect(command).toContain('SIGTERM');
        expect(command).toContain('SIGHUP');
        expect(command).toContain('node:path');
        expect(command).toContain('path.basename(payload.runtimeCmd)');
        expect(command).toContain('xtrm-role-safe');
        expect(command).not.toContain('rendered bead body');
    });

    it.each([false, true])('times out and deletes the buffer when the parent disappears (loaded=%s)', (loaded) => {
        const sandbox = path.join(os.tmpdir(), `xtrm-wrapper-timeout-${process.pid}-${loaded}`);
        const bin = path.join(sandbox, 'bin');
        const log = path.join(sandbox, 'tmux.log');
        const bufferFile = path.join(sandbox, 'buffer');
        const buffer = 'xtrm-role-timeout-test';
        rmSync(sandbox, { recursive: true, force: true });
        mkdirSync(bin, { recursive: true });
        writeFileSync(path.join(bin, 'tmux'), `#!/usr/bin/env node
const fs = require('node:fs');
const [command, ...args] = process.argv.slice(2);
fs.appendFileSync(process.env.XTRM_TMUX_LOG, [command, ...args].join(' ') + '\\n');
if (command === 'wait-for' && args[0] === '-S') process.exit(0);
if (command === 'wait-for') {
  setInterval(() => {}, 1000);
} else if (command === 'delete-buffer') {
  fs.rmSync(process.env.XTRM_BUFFER_FILE, { force: true });
  process.exit(0);
} else {
  process.exit(2);
}
`);
        chmodSync(path.join(bin, 'tmux'), 0o755);
        if (loaded) writeFileSync(bufferFile, 'payload');

        const started = Date.now();
        const result = spawnSync('sh', ['-c', buildBufferedRuntimeCommand(buffer, 250)], {
            encoding: 'utf8',
            timeout: 2_000,
            env: {
                ...process.env,
                PATH: `${bin}:${process.env.PATH ?? ''}`,
                XTRM_TMUX_LOG: log,
                XTRM_BUFFER_FILE: bufferFile,
            },
        });

        expect(result.status).not.toBe(0);
        expect(Date.now() - started).toBeLessThan(1_500);
        expect(readFileSync(log, 'utf8').trim().split('\n')).toEqual([
            `wait-for -S ${buffer}-consumer-ready`,
            `wait-for ${buffer}-ready`,
            `delete-buffer -b ${buffer}`,
        ]);
        expect(existsSync(bufferFile)).toBe(false);
        rmSync(sandbox, { recursive: true, force: true });
    });
});

describe('createRuntimeBufferName', () => {
    it('uses a collision-resistant 128-bit random suffix', () => {
        const names = new Set(Array.from({ length: 100 }, createRuntimeBufferName));
        expect(names.size).toBe(100);
        for (const name of names) expect(name).toMatch(/^xtrm-role-[0-9a-f]{32}$/);
    });
});

describe('claudeExplicitSkillLines', () => {
    it('derives skill name from SKILL.md path via parent dir', () => {
        expect(claudeExplicitSkillLines(['/home/u/.claude/skills/foo/SKILL.md']))
            .toBe('/foo');
    });

    it('derives skill name from directory path via basename', () => {
        expect(claudeExplicitSkillLines(['/home/u/.claude/skills/bar']))
            .toBe('/bar');
    });

    it('joins multiple skills with newlines in input order', () => {
        expect(claudeExplicitSkillLines([
            '/home/u/.claude/skills/a/SKILL.md',
            '/home/u/.claude/skills/b',
            '/home/u/.claude/skills/c/SKILL.md',
        ])).toBe('/a\n/b\n/c');
    });

    it('returns empty string when no paths given', () => {
        expect(claudeExplicitSkillLines([])).toBe('');
    });
});

describe('resolveSkillPath', () => {
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

    it('maps retired active paths to the migrated global default tree', () => {
        setup();
        const migrated = path.join(fakeHome, '.xtrm', 'skills', 'default', 'multiplexing', 'SKILL.md');
        mkdirSync(path.dirname(migrated), { recursive: true });
        writeFileSync(migrated, '# migrated global skill');
        withHomeEnv(() => {
            expect(resolveSkillPath(fakeRepo, rel)).toBe(migrated);
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
