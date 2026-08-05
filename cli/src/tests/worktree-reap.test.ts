import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
    dirtyPaths,
    evaluateWorktree,
    isExcludedPath,
    livePidsFor,
    parseDurationDays,
    readProcessCwds,
    scanWorktree,
    statusLinePath,
    summarize,
    unpushedCommits,
} from '../core/worktree-reap.js';

const DAY_MS = 86_400_000;
const created: string[] = [];

function git(args: string[], cwd: string): void {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
}

/** A real git repo — the predicate reads git state, so a mocked one would not exercise it. */
function makeRepo(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xt-reap-'));
    created.push(root);

    git(['init', '--quiet', '--initial-branch=main'], root);
    git(['config', 'user.email', 'test@example.invalid'], root);
    git(['config', 'user.name', 'test'], root);

    fs.writeFileSync(path.join(root, 'source.ts'), 'export const value = 1;\n', 'utf8');
    git(['add', '-A'], root);
    git(['commit', '--quiet', '-m', 'initial'], root);

    return root;
}

/** Age every work file so the worktree reads as idle without waiting for real time. */
function ageFiles(root: string, days: number): void {
    const when = new Date(Date.now() - days * DAY_MS);
    for (const entry of fs.readdirSync(root, { withFileTypes: true, encoding: 'utf8' })) {
        if (entry.isFile()) fs.utimesSync(path.join(root, entry.name), when, when);
    }
}

function evaluate(root: string, overrides: Partial<Parameters<typeof evaluateWorktree>[0]> = {}) {
    return evaluateWorktree({
        repoRoot: root,
        worktreePath: root,
        branch: 'xt/test',
        isMainWorktree: false,
        currentPath: os.tmpdir(),
        cwds: new Map(),
        artifactThresholdDays: 7,
        worktreeThresholdDays: 14,
        ...overrides,
    });
}

afterEach(() => {
    while (created.length > 0) {
        const dir = created.pop();
        if (dir) fs.rmSync(dir, { recursive: true, force: true });
    }
});

describe('parseDurationDays', () => {
    it('reads day, hour and minute suffixes and falls back on garbage', () => {
        expect(parseDurationDays('7d', 14)).toBe(7);
        expect(parseDurationDays('12h', 14)).toBe(0.5);
        expect(parseDurationDays('720m', 14)).toBe(0.5);
        expect(parseDurationDays('30', 14)).toBe(30);
        expect(parseDurationDays('later', 14)).toBe(14);
        expect(parseDurationDays(undefined, 14)).toBe(14);
    });
});

describe('status line parsing', () => {
    it('extracts the destination path of a rename and strips quoting', () => {
        expect(statusLinePath('R  old.ts -> new.ts')).toBe('new.ts');
        expect(statusLinePath('?? "spaced name.ts"')).toBe('spaced name.ts');
        expect(statusLinePath(' M src/index.ts')).toBe('src/index.ts');
    });

    it('excludes agent scaffolding at any depth', () => {
        expect(isExcludedPath('AGENTS.md')).toBe(true);
        expect(isExcludedPath('.beads/interactions.jsonl')).toBe(true);
        expect(isExcludedPath('nested/.claude/settings.json')).toBe(true);
        expect(isExcludedPath('src/index.ts')).toBe(false);
    });
});

describe('the exclusion list measures work, not scaffolding', () => {
    it('leaves a worktree dirty only in AGENTS.md / CLAUDE.md / .beads eligible', () => {
        const root = makeRepo();
        fs.writeFileSync(path.join(root, 'AGENTS.md'), 'churn\n', 'utf8');
        fs.writeFileSync(path.join(root, 'CLAUDE.md'), 'churn\n', 'utf8');
        fs.mkdirSync(path.join(root, '.beads'), { recursive: true });
        fs.writeFileSync(path.join(root, '.beads', 'interactions.jsonl'), '{}\n', 'utf8');

        expect(dirtyPaths(root)).toEqual([]);

        ageFiles(root, 30);
        const candidate = evaluate(root);

        expect(candidate.conditions.find(c => c.name === 'git-clean')?.pass).toBe(true);
        expect(candidate.conditions.find(c => c.name === 'no-recent-work')?.pass).toBe(true);
    });

    it('still reports a worktree dirty in real source', () => {
        const root = makeRepo();
        fs.writeFileSync(path.join(root, 'source.ts'), 'export const value = 2;\n', 'utf8');

        expect(dirtyPaths(root)).toEqual(['source.ts']);

        const candidate = evaluate(root);
        expect(candidate.reapable).toBe(false);
        expect(candidate.failed).toContain('git-clean');
    });
});

describe('safety conditions', () => {
    it('names every failing condition and never marks the worktree reapable', () => {
        const root = makeRepo();
        fs.writeFileSync(path.join(root, 'source.ts'), 'edited\n', 'utf8');

        const candidate = evaluate(root, { cwds: new Map([[root, [4242]]]) });

        expect(candidate.reapable).toBe(false);
        expect(candidate.failed).toEqual(expect.arrayContaining(['no-live-process', 'no-recent-work', 'git-clean']));
        expect(candidate.livePids).toEqual([4242]);
        expect(candidate.conditions.find(c => c.name === 'no-live-process')?.detail).toContain('4242');
    });

    it('holds the current worktree and the main worktree', () => {
        const root = makeRepo();
        ageFiles(root, 30);

        expect(evaluate(root, { currentPath: root }).failed).toContain('not-current-worktree');
        expect(evaluate(root, { isMainWorktree: true }).failed).toContain('not-current-worktree');
    });

    it('fails an unpushed branch that has no upstream and no origin', () => {
        const root = makeRepo();
        ageFiles(root, 30);

        const candidate = evaluate(root);
        expect(candidate.failed).toContain('no-unpushed-commits');
        expect(unpushedCommits(root).count).toBeNull();
    });

    it('passes a branch whose HEAD is an ancestor of origin/main', () => {
        const origin = makeRepo();
        const clone = fs.mkdtempSync(path.join(os.tmpdir(), 'xt-reap-clone-'));
        created.push(clone);
        spawnSync('git', ['clone', '--quiet', origin, clone], { encoding: 'utf8', stdio: 'pipe' });

        expect(unpushedCommits(clone).count).toBe(0);
    });
});

describe('process cwd scan', () => {
    it('finds a pid whose cwd is nested inside the worktree', () => {
        const cwds = new Map([['/a/wt/src/deep', [11, 12]], ['/a/other', [13]]]);
        expect(livePidsFor('/a/wt', cwds)).toEqual([11, 12]);
        expect(livePidsFor('/a/wt-sibling', cwds)).toEqual([]);
    });

    it('reads this process own cwd from /proc', () => {
        const cwds = readProcessCwds();
        expect(livePidsFor(process.cwd(), cwds)).toContain(process.pid);
    });
});

describe('tiered reclaim', () => {
    it('applies artifact and worktree thresholds independently', () => {
        const root = makeRepo();
        fs.mkdirSync(path.join(root, 'node_modules', 'pkg'), { recursive: true });
        fs.writeFileSync(path.join(root, 'node_modules', 'pkg', 'index.js'), 'x'.repeat(4096), 'utf8');
        ageFiles(root, 10); // older than artifacts (7d), younger than worktrees (14d)

        const candidate = evaluate(root);

        expect(candidate.reapable).toBe(false);
        expect(candidate.failed).toContain('no-recent-work');
        expect(candidate.artifactsReclaimable).toBe(true);
        expect(candidate.artifactBytes).toBeGreaterThan(0);
        expect(candidate.artifacts.map(a => path.basename(a.path))).toContain('node_modules');
    });

    it('refuses artifact reclaim while a process is live inside', () => {
        const root = makeRepo();
        fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
        fs.writeFileSync(path.join(root, 'node_modules', 'a.js'), 'x', 'utf8');
        ageFiles(root, 30);

        expect(evaluate(root, { cwds: new Map([[root, [99]]]) }).artifactsReclaimable).toBe(false);
    });

    it('does not count artifact contents as work', () => {
        const root = makeRepo();
        fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
        fs.writeFileSync(path.join(root, 'node_modules', 'fresh.js'), 'brand new', 'utf8');
        ageFiles(root, 30);

        const scan = scanWorktree(root);
        expect(scan.newestWorkPath).not.toContain('node_modules');
        expect(evaluate(root).conditions.find(c => c.name === 'no-recent-work')?.pass).toBe(true);
    });
});

describe('apply re-checks liveness', () => {
    it('holds a worktree that became live between planning and applying', async () => {
        const root = makeRepo();
        fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
        fs.writeFileSync(path.join(root, 'node_modules', 'a.js'), 'x', 'utf8');

        const { applyReap } = await import('../commands/worktree.js');

        // Planned as reapable while nothing was using it, but live by apply time. The apply
        // pass re-reads /proc rather than trusting the plan, so the candidate points at this
        // test process's own cwd — a genuinely live path, not an injected fake map.
        const plan = {
            component: 'xt.worktree_reap' as const,
            checked_at_ms: Date.now(),
            mode: 'dry_run' as const,
            artifact_threshold_days: 7,
            worktree_threshold_days: 14,
            repos: [root],
            candidates: [{
                component: 'xt.worktree_reap.candidate' as const,
                repo: root,
                path: process.cwd(), // a path that provably has this process's cwd inside it
                branch: 'xt/stale',
                isMainWorktree: false,
                conditions: [],
                failed: [],
                reapable: true,
                artifactsReclaimable: true,
                idleDays: 30,
                totalBytes: 100,
                artifactBytes: 50,
                artifacts: [],
                blockedBytes: 0,
                rootOwnedPaths: [],
                scanTruncated: false,
                livePids: [], // stale reading: empty at plan time
            }],
            summary: summarize([]),
        };

        const { outcomes } = applyReap(plan);

        expect(outcomes[0]?.action).toBe('held');
        expect(outcomes[0]?.detail).toContain('became live during the scan');
        expect(outcomes[0]?.freed_bytes).toBe(0);
    });
});

describe('summary accounting', () => {
    it('separates reclaimable bytes from bytes blocked by root-owned trees', () => {
        const base = {
            component: 'xt.worktree_reap.candidate' as const,
            repo: '/repo',
            branch: null,
            isMainWorktree: false,
            conditions: [],
            artifacts: [],
            rootOwnedPaths: [],
            scanTruncated: false,
            livePids: [],
            idleDays: 20,
        };

        const summary = summarize([
            { ...base, path: '/a', failed: [], reapable: true, artifactsReclaimable: true, totalBytes: 100, artifactBytes: 60, blockedBytes: 0 },
            { ...base, path: '/b', failed: ['git-clean'], reapable: false, artifactsReclaimable: true, totalBytes: 500, artifactBytes: 400, blockedBytes: 0 },
            { ...base, path: '/c', failed: ['git-clean'], reapable: false, artifactsReclaimable: false, totalBytes: 700, artifactBytes: 0, blockedBytes: 250, rootOwnedPaths: ['/c/node_modules/root-owned'] },
        ]);

        expect(summary.reapable).toBe(1);
        expect(summary.artifacts_only).toBe(1);
        expect(summary.held).toBe(1);
        expect(summary.reclaimable_bytes).toBe(500); // 100 whole + 400 artifacts, never the 700 held
        expect(summary.blocked_bytes).toBe(250);
        expect(summary.root_owned_trees).toBe(1);
    });

    it('never counts root-owned bytes as reclaimable', () => {
        const base = {
            component: 'xt.worktree_reap.candidate' as const,
            repo: '/repo',
            branch: null,
            isMainWorktree: false,
            conditions: [],
            artifacts: [],
            scanTruncated: false,
            livePids: [],
            idleDays: 20,
            rootOwnedPaths: ['/a/node_modules/rootbuild'],
        };

        const summary = summarize([
            { ...base, path: '/a', failed: [], reapable: true, artifactsReclaimable: true, totalBytes: 1000, artifactBytes: 800, blockedBytes: 300 },
        ]);

        expect(summary.reclaimable_bytes).toBe(700); // the 300 root-owned bytes are escalated, not promised
        expect(summary.blocked_bytes).toBe(300);
    });
});
