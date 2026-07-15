import os from 'node:os';
import path from 'node:path';
import { chmodSync, mkdirSync, readFileSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createClaudeCommand } from '../commands/claude.js';
import { createPiCommand } from '../commands/pi.js';
import {
    buildAgentEnv,
    buildRoleTmuxPlan,
    checkByteCeiling,
    checkPositionZeroSlash,
    chooseAttachCommand,
    claudeExplicitSkillLines,
    guardRolePassthrough,
    parseSpecialistJson,
    probeSkillPrefixAvailable,
    renderRoleTask,
    renderSkillPrefix,
    resolveRequestedSkills,
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

describe('checkPositionZeroSlash', () => {
    it('accepts empty body', () => {
        expect(checkPositionZeroSlash('', 'pi').ok).toBe(true);
        expect(checkPositionZeroSlash('', 'claude').ok).toBe(true);
    });

    it('accepts body not starting with /', () => {
        expect(checkPositionZeroSlash('normal task', 'pi').ok).toBe(true);
        expect(checkPositionZeroSlash('normal task', 'claude').ok).toBe(true);
    });

    it('accepts /skill: prefix on pi', () => {
        expect(checkPositionZeroSlash('/skill:multiplexing\n\nbody', 'pi').ok).toBe(true);
    });

    it('accepts /skill- prefix on claude', () => {
        expect(checkPositionZeroSlash('/skill-multiplexing\n\nbody', 'claude').ok).toBe(true);
    });

    it('rejects unrelated / at position 0 on pi', () => {
        const result = checkPositionZeroSlash('/foo bar', 'pi');
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toContain('/skill:');
    });

    it('rejects claude-style prefix on pi (wrong surface)', () => {
        const result = checkPositionZeroSlash('/skill-x', 'pi');
        expect(result.ok).toBe(false);
    });

    it('rejects pi-style prefix on claude (wrong surface)', () => {
        const result = checkPositionZeroSlash('/skill:x', 'claude');
        expect(result.ok).toBe(false);
    });
});

describe('checkByteCeiling', () => {
    it('accepts small payloads', () => {
        expect(checkByteCeiling({ systemPrompt: 'small', body: 'small' }).ok).toBe(true);
    });

    it('accepts payloads at 40KB (well under ceiling)', () => {
        expect(checkByteCeiling({ systemPrompt: 'X'.repeat(20 * 1024), body: 'Y'.repeat(20 * 1024) }).ok).toBe(true);
    });

    it('rejects payloads over 50KB with an actionable error', () => {
        const result = checkByteCeiling({ systemPrompt: 'X'.repeat(30 * 1024), body: 'Y'.repeat(30 * 1024) });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toContain('61440'); // actual byte count
            expect(result.error).toContain('51200'); // 50 KB ceiling
            expect(result.error).toContain('--bead');
        }
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

describe('buildRoleTmuxPlan (pi runtime)', () => {
    const role = parseSpecialistJson('chain-coordinator', SAMPLE_SPECIALIST);

    it('inlines system prompt and emits --no-skills unconditionally', () => {
        const plan = buildRoleTmuxPlan({
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
    });

    it('omits @agent_bead and bead-slug when bead is not provided', () => {
        const plan = buildRoleTmuxPlan({
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
        const plan = buildRoleTmuxPlan({
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
        const plan = buildRoleTmuxPlan({
            runtime: 'pi',
            role,
            parentSessionId: '',
            turn1Body: "hello it's mine",
        });
        expect(plan.runtimeCmdString.startsWith("'pi' ")).toBe(true);
        expect(plan.runtimeCmdString).toContain("'hello it'\\''s mine'");
    });

    it('encodes runtime in the session name so pi/claude do not collide (xtmux-3h8)', () => {
        const piPlan = buildRoleTmuxPlan({
            runtime: 'pi',
            role,
            bead: 'xtmux-3h8',
            parentSessionId: '',
            turn1Body: '',
        });
        const claudePlan = buildRoleTmuxPlan({
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
        const plan = buildRoleTmuxPlan({
            runtime: 'pi',
            role,
            bead: 'MY BEAD/1',
            parentSessionId: '',
            turn1Body: '',
        });
        expect(plan.sessionName).toBe('role-pi-chain-coordinator-my-bead-1');
    });

    it('does not emit --no-extensions or -e — pi discovers its own extensions', () => {
        const plan = buildRoleTmuxPlan({
            runtime: 'pi',
            role,
            parentSessionId: '',
            turn1Body: '',
        });
        expect(plan.runtimeArgs).not.toContain('--no-extensions');
        expect(plan.runtimeArgs).not.toContain('-e');
    });

    it('forwards --model / --thinking CLI overrides', () => {
        const plan = buildRoleTmuxPlan({
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
        const plan = buildRoleTmuxPlan({
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
            const plan = buildRoleTmuxPlan({
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
        const plan = buildRoleTmuxPlan({
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

describe('buildRoleTmuxPlan (claude runtime)', () => {
    const role = parseSpecialistJson('chain-coordinator', JSON.stringify({
        specialist: {
            prompt: { system: 'You are chain-coordinator.' },
            skills: { paths: ['.xtrm/skills/x/SKILL.md'] },
            execution: { model: 'claude-opus-4-8', thinking_level: 'medium' },
        },
    }));

    it('inlines --append-system-prompt (xtrm-8zsi1 supersedes xtrm-osipt file transport)', () => {
        const plan = buildRoleTmuxPlan({
            runtime: 'claude',
            role,
            parentSessionId: '$3',
            turn1Body: '/skill-x\n\nbody',
        });
        expect(plan.runtimeCmd).toBe('claude');
        expect(plan.runtimeArgs[0]).toBe('--append-system-prompt');
        expect(plan.runtimeArgs[1]).toBe('You are chain-coordinator.');
        expect(plan.runtimeArgs).not.toContain('--append-system-prompt-file');
        expect(plan.runtimeArgs).toContain('--dangerously-skip-permissions');
    });

    it('emits `--` before positional turn-1 body (claude variadic-flag safety)', () => {
        const plan = buildRoleTmuxPlan({
            runtime: 'claude',
            role,
            parentSessionId: '',
            turn1Body: '/skill-x\n\nbody',
        });
        expect(plan.runtimeArgs.slice(-2)).toEqual(['--', '/skill-x\n\nbody']);
    });

    it('omits `--` and positional when turn1Body is empty (skills-only prime)', () => {
        const plan = buildRoleTmuxPlan({
            runtime: 'claude',
            role,
            parentSessionId: '',
            turn1Body: '',
        });
        expect(plan.runtimeArgs).not.toContain('--');
        expect(plan.runtimeArgs.at(-1)).not.toBe('');
    });

    it('emits NO --skill and NO --plugin-dir on claude (xtrm-8zsi1 drops ephemeral plugin)', () => {
        const plan = buildRoleTmuxPlan({
            runtime: 'claude',
            role,
            parentSessionId: '',
            turn1Body: 'x',
            explicitSkillPaths: ['/some/skill/SKILL.md'],
        });
        expect(plan.runtimeArgs).not.toContain('--skill');
        expect(plan.runtimeArgs).not.toContain('--plugin-dir');
    });

    it('forwards --model but silently drops --thinking (claude has no --thinking flag)', () => {
        const plan = buildRoleTmuxPlan({
            runtime: 'claude',
            role,
            parentSessionId: '',
            turn1Body: '',
            thinkingOverride: 'high',
        });
        const modelIdx = plan.runtimeArgs.indexOf('--model');
        expect(plan.runtimeArgs[modelIdx + 1]).toBe('claude-opus-4-8');
        expect(plan.runtimeArgs).not.toContain('--thinking');
    });

    it('shell-quotes with claude as the runtime prefix and inlines the system prompt safely', () => {
        const plan = buildRoleTmuxPlan({
            runtime: 'claude',
            role,
            parentSessionId: '',
            turn1Body: '',
        });
        expect(plan.runtimeCmdString.startsWith("'claude' ")).toBe(true);
        expect(plan.runtimeCmdString).toContain("'You are chain-coordinator.'");
    });

    it('appends passthrough verbatim (before positional body)', () => {
        const plan = buildRoleTmuxPlan({
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
        const plan = buildRoleTmuxPlan({
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
    it('exports role + parent session id (no more XTMUX_AGENT_PROMPT_FILE)', () => {
        const env = buildAgentEnv({
            role: 'chain-coordinator',
            parentSessionId: '$5',
        });
        expect(env.XTMUX_AGENT_TASK).toBe('role:chain-coordinator');
        expect(env.XTMUX_AGENT_PARENT_SESSION).toBe('$5');
        expect(env.XTMUX_AGENT_BEAD).toBeUndefined();
        expect(env.XTMUX_AGENT_PROMPT_FILE).toBeUndefined();
    });

    it('includes bead when provided', () => {
        const env = buildAgentEnv({
            role: 'r',
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

describe('claudeExplicitSkillLines', () => {
    it('derives skill name from SKILL.md path via parent dir', () => {
        expect(claudeExplicitSkillLines(['/home/u/.claude/skills/foo/SKILL.md']))
            .toBe('/skill-foo');
    });

    it('derives skill name from directory path via basename', () => {
        expect(claudeExplicitSkillLines(['/home/u/.claude/skills/bar']))
            .toBe('/skill-bar');
    });

    it('joins multiple skills with newlines in input order', () => {
        expect(claudeExplicitSkillLines([
            '/home/u/.claude/skills/a/SKILL.md',
            '/home/u/.claude/skills/b',
            '/home/u/.claude/skills/c/SKILL.md',
        ])).toBe('/skill-a\n/skill-b\n/skill-c');
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
