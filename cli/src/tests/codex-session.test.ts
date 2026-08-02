import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
    findCodexSession,
    readCodexWorktreeSession,
    writeCodexWorktreeSession,
} from '../core/codex-session.js';

const roots: string[] = [];

afterEach(() => {
    for (const root of roots.splice(0)) fs.removeSync(root);
});

describe('Codex thread persistence', () => {
    it('finds the newest fresh session for the exact worktree cwd', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xtrm-codex-sessions-'));
        roots.push(root);
        const nested = path.join(root, '2026', '08', '02');
        fs.ensureDirSync(nested);
        const cwd = '/srv/project/.xtrm/worktrees/project-xt-codex-demo';
        const line = (id: string, timestamp: string, valueCwd: string) => JSON.stringify({
            type: 'session_meta',
            payload: { session_id: id, id, timestamp, cwd: valueCwd, cli_version: '0.146.0' },
        });
        fs.writeFileSync(path.join(nested, 'wrong.jsonl'), `${line(
            '019fc3bc-fb7a-7ae0-9536-125624bf726a',
            '2026-08-02T18:29:31.000Z',
            '/srv/other',
        )}\n`);
        fs.writeFileSync(path.join(nested, 'match.jsonl'), `${line(
            '019fc3bc-fb7a-7ae0-9536-125624bf726b',
            '2026-08-02T18:29:30.106Z',
            cwd,
        )}\n`);

        expect(findCodexSession({
            sessionsRoot: root,
            cwd,
            launchedAfterMs: Date.parse('2026-08-02T18:29:29.000Z'),
        })).toMatchObject({
            threadId: '019fc3bc-fb7a-7ae0-9536-125624bf726b',
            cliVersion: '0.146.0',
        });
    });

    it('persists and validates an explicit UUID for deterministic resume', () => {
        const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'xtrm-codex-worktree-'));
        roots.push(worktree);
        const session = {
            runtime: 'codex' as const,
            launchedAt: '2026-08-02T18:29:29.000Z',
            threadId: '019fc3bc-fb7a-7ae0-9536-125624bf726b',
            safetyProfile: 'codex-yolo' as const,
        };

        expect(writeCodexWorktreeSession(worktree, session)).toBe(true);
        expect(readCodexWorktreeSession(worktree)).toEqual(session);
        expect(fs.readJsonSync(path.join(worktree, '.xtrm', 'session-meta.json'))).toEqual(session);
    });

    it('rejects missing, malformed, and non-Codex metadata', () => {
        const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'xtrm-codex-worktree-'));
        roots.push(worktree);
        expect(readCodexWorktreeSession(worktree)).toBeNull();

        fs.ensureDirSync(path.join(worktree, '.xtrm'));
        fs.writeJsonSync(path.join(worktree, '.xtrm', 'session-meta.json'), {
            runtime: 'pi',
            launchedAt: '2026-08-02T18:29:29.000Z',
        });
        expect(readCodexWorktreeSession(worktree)).toBeNull();
    });
});
