import { validate } from '@xtrm/contracts';
import { describe, expect, it } from 'vitest';

import {
    buildCodexRuntimeArgs,
    buildCodexDetachedOutcome,
    checkCodexPassthrough,
    parseCodexSessionMeta,
} from '../core/codex-runtime.js';

describe('Codex runtime descriptor', () => {
    it('uses the managed YOLO profile by default without bypassing hook trust', () => {
        const result = buildCodexRuntimeArgs({
            yolo: true,
            profileName: 'xtrm-0123456789abcdef',
            model: 'gpt-5.6-codex',
            prompt: 'inspect the launcher',
            skillNames: ['multiplexing'],
            passthrough: ['--search'],
        });

        expect(result.safetyProfile).toEqual({
            name: 'codex-yolo',
            sandbox: 'disabled',
            approvals: 'bypassed',
            hook_trust: 'preserved',
        });
        expect(result.argv).toEqual([
            '--profile', 'xtrm-0123456789abcdef',
            '--dangerously-bypass-approvals-and-sandbox',
            '--model', 'gpt-5.6-codex',
            '--search',
            '$multiplexing\n\ninspect the launcher',
        ]);
        expect(result.argv).not.toContain('--dangerously-bypass-hook-trust');
    });

    it('maps --no-yolo to workspace-write with on-request approval', () => {
        const result = buildCodexRuntimeArgs({
            yolo: false,
            profileName: 'xtrm-0123456789abcdef',
        });

        expect(result.argv).toEqual([
            '--profile', 'xtrm-0123456789abcdef',
            '--sandbox', 'workspace-write',
            '--ask-for-approval', 'on-request',
        ]);
        expect(result.safetyProfile).toEqual({
            name: 'codex-workspace-write',
            sandbox: 'workspace-write',
            approvals: 'on-request',
            hook_trust: 'preserved',
        });
    });

    it('adds role instructions without replacing Codex built-ins', () => {
        const result = buildCodexRuntimeArgs({
            yolo: true,
            profileName: 'xtrm-0123456789abcdef',
            developerInstructions: 'Act as the release reviewer.',
        });

        expect(result.argv).toContain('-c');
        expect(result.argv).toContain('developer_instructions="Act as the release reviewer."');
        expect(result.argv.join(' ')).not.toContain('model_instructions_file');
    });

    it.each([
        ['--dangerously-bypass-hook-trust'],
        ['--dangerously-bypass-approvals-and-sandbox'],
        ['--sandbox', 'read-only'],
        ['--sandbox=danger-full-access'],
        ['-s', 'read-only'],
        ['-sread-only'],
        ['--ask-for-approval', 'never'],
        ['--ask-for-approval=never'],
        ['-a', 'never'],
        ['-anever'],
        ['--profile', 'foreign'],
        ['--profile=foreign'],
        ['-p', 'foreign'],
        ['-pforeign'],
    ])('rejects conflicting or trust-bypassing passthrough %j', (...argv) => {
        expect(checkCodexPassthrough(argv)).toMatchObject({ ok: false });
    });

    it('accepts unrelated Codex passthrough flags verbatim', () => {
        expect(checkCodexPassthrough(['--search', '--no-alt-screen'])).toEqual({
            ok: true,
            argv: ['--search', '--no-alt-screen'],
        });
    });

    it('parses only a fresh matching 0.146.0 session_meta identity', () => {
        const line = JSON.stringify({
            timestamp: '2026-08-02T18:29:30.251Z',
            type: 'session_meta',
            payload: {
                session_id: '019fc3bc-fb7a-7ae0-9536-125624bf726b',
                id: '019fc3bc-fb7a-7ae0-9536-125624bf726b',
                timestamp: '2026-08-02T18:29:30.106Z',
                cwd: '/srv/project/.xtrm/worktrees/project-xt-codex-demo',
                cli_version: '0.146.0',
            },
        });

        expect(parseCodexSessionMeta(line, {
            cwd: '/srv/project/.xtrm/worktrees/project-xt-codex-demo',
            launchedAfterMs: Date.parse('2026-08-02T18:29:29.000Z'),
        })).toEqual({
            threadId: '019fc3bc-fb7a-7ae0-9536-125624bf726b',
            cliVersion: '0.146.0',
            timestampMs: Date.parse('2026-08-02T18:29:30.106Z'),
        });

        expect(parseCodexSessionMeta(line, {
            cwd: '/srv/other',
            launchedAfterMs: 0,
        })).toBeNull();
        expect(parseCodexSessionMeta(line, {
            cwd: '/srv/project/.xtrm/worktrees/project-xt-codex-demo',
            launchedAfterMs: Date.parse('2026-08-02T18:29:31.000Z'),
        })).toBeNull();
    });

    it('builds a valid outcome with explicit UUID resume and argv-derived safety', () => {
        const outcome = buildCodexDetachedOutcome({
            runtimeVersion: 'codex-cli 0.146.0',
            threadId: '019fc3bc-fb7a-7ae0-9536-125624bf726b',
            sessionSlug: 'demo',
            sessionName: 'codex-demo',
            tmuxSessionId: '$42',
            paneId: '%17',
            worktreePath: '/srv/project/.xtrm/worktrees/project-xt-codex-demo',
            branchName: 'xt/demo',
            safetyProfile: {
                name: 'codex-workspace-write',
                sandbox: 'workspace-write',
                approvals: 'on-request',
                hook_trust: 'preserved',
            },
            profileName: 'xtrm-0123456789abcdef',
            insideTmux: false,
        });

        expect(validate('xtrm.command-outcome.v1', outcome)).toMatchObject({ valid: true, errors: [] });
        expect(outcome.identity?.thread_id).toBe('019fc3bc-fb7a-7ae0-9536-125624bf726b');
        expect(outcome.next_actions.map((next) => next.argv)).toEqual([
            ['tmux', 'attach-session', '-t', 'codex-demo'],
            [
                'codex', '--profile', 'xtrm-0123456789abcdef', 'resume',
                '--sandbox', 'workspace-write',
                '--ask-for-approval', 'on-request',
                '019fc3bc-fb7a-7ae0-9536-125624bf726b',
            ],
            ['xt', 'doctor'],
            ['xt', 'end'],
        ]);
        expect(outcome.next_actions.flatMap((next) => next.argv)).not.toContain('--last');
    });

    // Regression: xtrm-7edzx. A bare `xt codex` launches Codex into an idle TUI.
    // Codex writes no rollout record until its first turn, so there is no thread
    // id to discover. The launcher used to destroy the whole session over this,
    // making bare launch unusable. A live session with no resume handle is
    // degraded, not failed.
    it('degrades instead of failing when Codex has not opened a thread yet', () => {
        const outcome = buildCodexDetachedOutcome({
            runtimeVersion: 'codex-cli 0.147.0',
            threadId: null,
            sessionSlug: 'demo',
            sessionName: 'codex-demo',
            tmuxSessionId: '$42',
            paneId: '%17',
            worktreePath: '/srv/project/.xtrm/worktrees/project-xt-codex-demo',
            branchName: 'xt/demo',
            safetyProfile: {
                name: 'codex-yolo',
                sandbox: 'disabled',
                approvals: 'bypassed',
                hook_trust: 'preserved',
            },
            profileName: 'xtrm-0123456789abcdef',
            insideTmux: false,
        });

        expect(validate('xtrm.command-outcome.v1', outcome)).toMatchObject({ valid: true, errors: [] });
        expect(outcome.status).toBe('degraded');
        expect(outcome.reason_code).toBe('session_created_thread_id_unresolved');
        expect(outcome.identity?.thread_id).toBeNull();
        // Status and persistence must agree; a degraded outcome that claims
        // persistence completed would misreport on-disk state.
        expect(outcome.persistence).toMatchObject({ completed: false });
        // The session is real and still attachable — that is the whole point.
        expect(outcome.authoritative_mutation).toMatchObject({ completed: true });
        expect(outcome.next_actions.map((next) => next.kind)).toEqual(['attach', 'repair', 'end']);
    });

    // A resume command needs the exact thread id. Advertising one we cannot
    // fill would make the contract non-deterministic, so it must be absent.
    it('omits the resume action entirely when no thread id exists', () => {
        const outcome = buildCodexDetachedOutcome({
            runtimeVersion: null,
            threadId: null,
            sessionSlug: 'demo',
            sessionName: 'codex-demo',
            tmuxSessionId: '$42',
            paneId: '%17',
            worktreePath: '/srv/project/.xtrm/worktrees/project-xt-codex-demo',
            branchName: 'xt/demo',
            safetyProfile: {
                name: 'codex-yolo',
                sandbox: 'disabled',
                approvals: 'bypassed',
                hook_trust: 'preserved',
            },
            profileName: 'xtrm-0123456789abcdef',
            insideTmux: false,
        });

        expect(outcome.next_actions.some((next) => next.kind === 'resume')).toBe(false);
        expect(outcome.next_actions.flatMap((next) => next.argv)).not.toContain('resume');
        // Hook trust is never bargained away, degraded or not.
        expect(outcome.safety_profile?.hook_trust).toBe('preserved');
        expect(outcome.next_actions.flatMap((next) => next.argv))
            .not.toContain('--dangerously-bypass-hook-trust');
    });
});
