import { describe, expect, it } from 'vitest';
import { validate } from '@xtrm/contracts';

import {
    buildDetachedLaunchOutcome,
    checkStructuredLaunchOptions,
    renderOutcomeArgv,
} from '../core/launch-outcome.js';

describe('detached launch command outcome', () => {
    it.each(['pi', 'claude'] as const)('builds a valid %s outcome with exact next actions', (runtime) => {
        const outcome = buildDetachedLaunchOutcome({
            runtime,
            runtimeVersion: runtime === 'pi' ? '0.74.2' : '2.1.0',
            sessionSlug: 'codex-k2',
            sessionName: `${runtime}-codex-k2`,
            tmuxSessionId: '$42',
            paneId: '%17',
            worktreePath: '/srv/project/.xtrm/worktrees/project-xt-codex-k2',
            branchName: 'xt/codex-k2',
        });

        expect(validate('xtrm.command-outcome.v1', outcome)).toMatchObject({ valid: true, errors: [] });
        expect(outcome).toMatchObject({
            schema_version: 'xtrm.command-outcome.v1',
            status: 'ok',
            reason_code: 'session_created_readiness_unverified',
            runtime: { name: runtime },
            identity: {
                thread_id: null,
                session_name: `${runtime}-codex-k2`,
                tmux_session_id: '$42',
                pane_id: '%17',
            },
            worktree: {
                path: '/srv/project/.xtrm/worktrees/project-xt-codex-k2',
                branch: 'xt/codex-k2',
                owner: 'core',
            },
            readiness: { status: 'unverified', source: 'tmux-pane' },
            persistence: { completed: true, kind: 'worktree.session-metadata' },
            authoritative_mutation: { completed: true, kind: 'interactive-session.created' },
        });

        expect(outcome.next_actions.map((action) => action.argv)).toEqual([
            ['tmux', 'attach-session', '-t', `${runtime}-codex-k2`],
            ['xt', 'attach', 'codex-k2'],
            ['xt', 'doctor'],
            ['xt', 'end'],
        ]);
        expect(outcome.next_actions.every((action) => action.display === renderOutcomeArgv(action.argv))).toBe(true);
        expect(JSON.stringify(outcome)).not.toMatch(/prompt|credential|transcript|terminal[_-]?capture/i);
    });

    it('keeps Pi and Claude safety profiles distinct without weakening hook trust', () => {
        const base = {
            runtimeVersion: null,
            sessionSlug: 'safe',
            tmuxSessionId: '$1',
            paneId: '%2',
            worktreePath: '/srv/project/.xtrm/worktrees/project-xt-safe',
            branchName: 'xt/safe',
        };
        const pi = buildDetachedLaunchOutcome({ ...base, runtime: 'pi', sessionName: 'pi-safe' });
        const claude = buildDetachedLaunchOutcome({ ...base, runtime: 'claude', sessionName: 'claude-safe' });

        expect(pi.safety_profile).toEqual({
            name: 'pi-native',
            sandbox: 'runtime-defined',
            approvals: 'runtime-defined',
            hook_trust: 'preserved',
        });
        expect(claude.safety_profile).toEqual({
            name: 'claude-bypass-permissions',
            sandbox: 'disabled',
            approvals: 'bypassed',
            hook_trust: 'preserved',
        });
    });

    it('switches the current tmux client instead of advertising a nested attach', () => {
        const outcome = buildDetachedLaunchOutcome({
            runtime: 'pi',
            runtimeVersion: '0.74.2',
            sessionSlug: 'inside-tmux',
            sessionName: 'pi-inside-tmux',
            tmuxSessionId: '$42',
            paneId: '%17',
            worktreePath: '/srv/project/.xtrm/worktrees/project-xt-inside-tmux',
            branchName: 'xt/inside-tmux',
            insideTmux: true,
        });

        expect(outcome.next_actions[0]?.argv).toEqual([
            'tmux', 'switch-client', '-t', 'pi-inside-tmux',
        ]);
    });

    it('shell-quotes display text while preserving argv as the authority', () => {
        expect(renderOutcomeArgv(['xt', 'attach', "name with 'quotes'"])).toBe(
            "xt attach 'name with '\"'\"'quotes'\"'\"''",
        );
        expect(renderOutcomeArgv(['printf', '$USER'])).toBe("printf '$USER'");
    });

    it('rejects structured output modes that cannot produce one deterministic result', () => {
        expect(checkStructuredLaunchOptions({ json: false, attach: true, reuse: true })).toEqual({ ok: true });
        expect(checkStructuredLaunchOptions({ json: true, attach: true, reuse: false })).toEqual({
            ok: false,
            error: '--json requires --no-attach',
        });
        expect(checkStructuredLaunchOptions({ json: true, attach: false, reuse: true })).toEqual({
            ok: false,
            error: '--json cannot be combined with --reuse',
        });
        expect(checkStructuredLaunchOptions({ json: true, attach: false, reuse: false })).toEqual({ ok: true });
    });

    it('rejects control characters instead of emitting an invalid or injectable outcome', () => {
        expect(() => buildDetachedLaunchOutcome({
            runtime: 'pi',
            runtimeVersion: '0.74.2\u001b[31m',
            sessionSlug: 'safe',
            sessionName: 'pi-safe',
            tmuxSessionId: '$1',
            paneId: '%2',
            worktreePath: '/srv/project/.xtrm/worktrees/project-xt-safe',
            branchName: 'xt/safe',
        })).toThrow(/xtrm\.command-outcome\.v1/);
    });
});
