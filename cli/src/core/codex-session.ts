import path from 'node:path';
import {
    closeSync,
    existsSync,
    mkdirSync,
    openSync,
    readFileSync,
    readSync,
    readdirSync,
    renameSync,
    unlinkSync,
    writeFileSync,
} from 'node:fs';

import { parseCodexSessionMeta } from './codex-runtime.js';

export interface CodexWorktreeSession {
    runtime: 'codex';
    launchedAt: string;
    threadId: string;
    safetyProfile: 'codex-yolo' | 'codex-workspace-write';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_SESSION_FILES = 4_096;
const MAX_DIRECTORY_DEPTH = 8;
const FIRST_LINE_BYTES = 64 * 1024;

function sessionMetaPath(worktreePath: string): string {
    return path.join(worktreePath, '.xtrm', 'session-meta.json');
}

function readFirstLine(filePath: string): string | null {
    let fd: number | undefined;
    try {
        fd = openSync(filePath, 'r');
        const buffer = Buffer.allocUnsafe(FIRST_LINE_BYTES);
        const bytes = readSync(fd, buffer, 0, buffer.length, 0);
        return buffer.subarray(0, bytes).toString('utf8').split(/\r?\n/, 1)[0] ?? null;
    } catch {
        return null;
    } finally {
        if (fd !== undefined) closeSync(fd);
    }
}

function collectSessionFiles(root: string): string[] {
    if (!existsSync(root)) return [];
    const files: string[] = [];
    const pending: Array<{ directory: string; depth: number }> = [{ directory: root, depth: 0 }];
    while (pending.length > 0 && files.length < MAX_SESSION_FILES) {
        const current = pending.pop();
        if (!current) break;
        let entries;
        try {
            entries = readdirSync(current.directory, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            if (files.length >= MAX_SESSION_FILES) break;
            const entryPath = path.join(current.directory, entry.name);
            if (entry.isDirectory() && current.depth < MAX_DIRECTORY_DEPTH) {
                pending.push({ directory: entryPath, depth: current.depth + 1 });
            } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
                files.push(entryPath);
            }
        }
    }
    return files;
}

export function findCodexSession(input: {
    sessionsRoot: string;
    cwd: string;
    launchedAfterMs: number;
}): { threadId: string; cliVersion: string | null; timestampMs: number; filePath: string } | null {
    let newest: ReturnType<typeof findCodexSession> = null;
    for (const filePath of collectSessionFiles(input.sessionsRoot)) {
        const line = readFirstLine(filePath);
        if (!line) continue;
        const parsed = parseCodexSessionMeta(line, input);
        if (!parsed || (newest && newest.timestampMs >= parsed.timestampMs)) continue;
        newest = { ...parsed, filePath };
    }
    return newest;
}

export function writeCodexWorktreeSession(worktreePath: string, session: CodexWorktreeSession): boolean {
    const destination = sessionMetaPath(worktreePath);
    const temporary = `${destination}.${process.pid}.tmp`;
    try {
        mkdirSync(path.dirname(destination), { recursive: true });
        writeFileSync(temporary, JSON.stringify(session, null, 2));
        renameSync(temporary, destination);
        return true;
    } catch {
        try { unlinkSync(temporary); } catch { /* best effort */ }
        return false;
    }
}

export function readCodexWorktreeSession(worktreePath: string): CodexWorktreeSession | null {
    try {
        const parsed = JSON.parse(readFileSync(sessionMetaPath(worktreePath), 'utf8')) as Record<string, unknown>;
        if (parsed.runtime !== 'codex'
            || typeof parsed.launchedAt !== 'string'
            || !Number.isFinite(Date.parse(parsed.launchedAt))
            || typeof parsed.threadId !== 'string'
            || !UUID.test(parsed.threadId)
            || (parsed.safetyProfile !== 'codex-yolo' && parsed.safetyProfile !== 'codex-workspace-write')) {
            return null;
        }
        return parsed as unknown as CodexWorktreeSession;
    } catch {
        return null;
    }
}
