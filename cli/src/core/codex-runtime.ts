import type { CommandOutcomeAction, CommandOutcomeV1 } from '@xtrm/contracts';

import { renderOutcomeArgv } from './launch-outcome.js';

export type CodexSafetyProfile = {
    name: 'codex-yolo' | 'codex-workspace-write';
    sandbox: 'disabled' | 'workspace-write';
    approvals: 'bypassed' | 'on-request';
    hook_trust: 'preserved';
};

export interface CodexRuntimePlan {
    argv: string[];
    safetyProfile: CodexSafetyProfile;
}

const OWNED_OR_FORBIDDEN_FLAGS = new Set([
    '--dangerously-bypass-hook-trust',
    '--dangerously-bypass-approvals-and-sandbox',
    '--sandbox',
    '-s',
    '--ask-for-approval',
    '-a',
    '--profile',
    '-p',
]);

export function checkCodexPassthrough(argv: readonly string[]):
    | { ok: true; argv: string[] }
    | { ok: false; error: string } {
    for (const arg of argv) {
        const attachedShort = !arg.startsWith('--')
            ? (arg.startsWith('-s') ? '-s' : arg.startsWith('-a') ? '-a' : arg.startsWith('-p') ? '-p' : null)
            : null;
        const flag = attachedShort ?? arg.split('=', 1)[0] ?? arg;
        if (OWNED_OR_FORBIDDEN_FLAGS.has(flag)) {
            return {
                ok: false,
                error: flag === '--dangerously-bypass-hook-trust'
                    ? '--dangerously-bypass-hook-trust is forbidden; persisted hook trust is required'
                    : `${flag} conflicts with the xt codex safety profile`,
            };
        }
    }
    return { ok: true, argv: [...argv] };
}

function composeTurnOne(skillNames: readonly string[], prompt: string | undefined): string {
    const prefix = [...new Set(skillNames)].map((name) => `$${name}`).join('\n');
    if (!prefix) return prompt ?? '';
    return prompt ? `${prefix}\n\n${prompt}` : prefix;
}

export function buildCodexRuntimeArgs(input: {
    yolo: boolean;
    profileName: string;
    model?: string;
    developerInstructions?: string;
    prompt?: string;
    skillNames?: readonly string[];
    passthrough?: readonly string[];
}): CodexRuntimePlan {
    const guard = checkCodexPassthrough(input.passthrough ?? []);
    if (!guard.ok) throw new Error(guard.error);

    const safetyProfile: CodexSafetyProfile = input.yolo
        ? {
            name: 'codex-yolo',
            sandbox: 'disabled',
            approvals: 'bypassed',
            hook_trust: 'preserved',
        }
        : {
            name: 'codex-workspace-write',
            sandbox: 'workspace-write',
            approvals: 'on-request',
            hook_trust: 'preserved',
        };
    if (!/^xtrm-[0-9a-f]{16}$/.test(input.profileName)) throw new Error('invalid Codex profile name');
    const argv = ['--profile', input.profileName, ...(input.yolo
        ? ['--dangerously-bypass-approvals-and-sandbox']
        : ['--sandbox', 'workspace-write', '--ask-for-approval', 'on-request'])];

    if (input.model) argv.push('--model', input.model);
    if (input.developerInstructions) {
        argv.push('-c', `developer_instructions=${JSON.stringify(input.developerInstructions)}`);
    }
    argv.push(...guard.argv);

    const turnOne = composeTurnOne(input.skillNames ?? [], input.prompt);
    if (turnOne) argv.push(turnOne);
    return { argv, safetyProfile };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function buildCodexResumeArgs(
    threadId: string,
    safetyProfile: CodexSafetyProfile['name'],
    profileName: string,
): string[] {
    if (!UUID.test(threadId)) throw new Error('invalid Codex thread id');
    if (!/^xtrm-[0-9a-f]{16}$/.test(profileName)) throw new Error('invalid Codex profile name');
    const safetyArgs = safetyProfile === 'codex-yolo'
        ? ['--dangerously-bypass-approvals-and-sandbox']
        : ['--sandbox', 'workspace-write', '--ask-for-approval', 'on-request'];
    return ['--profile', profileName, 'resume', ...safetyArgs, threadId];
}

export function parseCodexSessionMeta(
    line: string,
    expected: { cwd: string; launchedAfterMs: number },
): { threadId: string; cliVersion: string | null; timestampMs: number } | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(line);
    } catch {
        return null;
    }
    if (!parsed || typeof parsed !== 'object') return null;
    const event = parsed as { type?: unknown; payload?: unknown };
    if (event.type !== 'session_meta' || !event.payload || typeof event.payload !== 'object') return null;
    const payload = event.payload as Record<string, unknown>;
    const threadId = typeof payload.session_id === 'string' ? payload.session_id : payload.id;
    const timestampMs = typeof payload.timestamp === 'string' ? Date.parse(payload.timestamp) : Number.NaN;
    if (typeof threadId !== 'string' || !UUID.test(threadId)) return null;
    if (payload.cwd !== expected.cwd || !Number.isFinite(timestampMs) || timestampMs < expected.launchedAfterMs) {
        return null;
    }
    return {
        threadId,
        cliVersion: typeof payload.cli_version === 'string' ? payload.cli_version : null,
        timestampMs,
    };
}

function outcomeAction(
    kind: CommandOutcomeAction['kind'],
    argv: string[],
    cwd: string,
    why: string,
): CommandOutcomeAction {
    return { kind, required: false, argv, display: renderOutcomeArgv(argv), cwd, why };
}

// threadId is null when Codex started but never opened a thread. An idle TUI
// session writes no rollout record until its first turn, so a bare `xt codex`
// has nothing to discover. That is a live, attachable session missing only its
// exact resume handle — degraded, not failed. Destroying it would throw away a
// working session over absent metadata. Mirrors buildDetachedLaunchOutcome.
export function buildCodexDetachedOutcome(input: {
    runtimeVersion: string | null;
    threadId: string | null;
    sessionSlug: string;
    sessionName: string;
    tmuxSessionId: string;
    paneId: string;
    worktreePath: string;
    branchName: string;
    safetyProfile: CodexSafetyProfile;
    profileName: string;
    insideTmux: boolean;
}): CommandOutcomeV1 {
    const threadId = input.threadId;
    return {
        schema_version: 'xtrm.command-outcome.v1',
        status: threadId ? 'ok' : 'degraded',
        reason_code: threadId
            ? 'session_created_readiness_unverified'
            : 'session_created_thread_id_unresolved',
        summary: threadId
            ? 'Detached codex session created with an explicit persisted thread id.'
            : 'Detached codex session created, but Codex has not opened a thread yet, so no exact resume handle exists.',
        runtime: { name: 'codex', version: input.runtimeVersion },
        identity: {
            thread_id: threadId,
            session_name: input.sessionName,
            tmux_session_id: input.tmuxSessionId,
            pane_id: input.paneId,
        },
        worktree: { path: input.worktreePath, branch: input.branchName, owner: 'core' },
        readiness: { status: 'unverified', source: 'tmux-pane' },
        safety_profile: input.safetyProfile,
        persistence: { completed: Boolean(threadId), kind: 'worktree.session-metadata' },
        authoritative_mutation: { completed: true, kind: 'interactive-session.created' },
        side_effects: [
            { kind: 'worktree.created', status: 'ok', id: input.sessionSlug },
            { kind: 'tmux.session.created', status: 'ok', id: input.tmuxSessionId },
            { kind: 'runtime.readiness', status: 'skipped', id: null },
        ],
        next_actions: [
            outcomeAction(
                'attach',
                ['tmux', input.insideTmux ? 'switch-client' : 'attach-session', '-t', input.sessionName],
                input.worktreePath,
                'Attach to the live detached Codex session.',
            ),
            // Omitted without a thread id: a resume command needs the exact
            // handle, and advertising one we cannot fill is non-deterministic.
            ...(threadId ? [outcomeAction(
                'resume',
                ['codex', ...buildCodexResumeArgs(threadId, input.safetyProfile.name, input.profileName)],
                input.worktreePath,
                'Resume this exact Codex thread after the tmux session ends.',
            )] : []),
            outcomeAction('repair', ['xt', 'doctor'], input.worktreePath, 'Inspect managed runtime drift.'),
            outcomeAction('end', ['xt', 'end'], input.worktreePath, 'Close the xt-owned worktree session.'),
        ],
    };
}
