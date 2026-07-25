/**
 * Aggregated topology projection — audit ~/dev/11.md P2-05.
 *
 * Joins tmux pane -> interactive runtime -> role -> coordinator -> specialist
 * jobs -> bead -> worktree -> branch -> integration target -> pull request, and
 * emits one `xtrm.topology.projection.v1` snapshot.
 *
 * READ-ONLY, BY CONSTRUCTION. Every fact is read live at invocation from the
 * owning system's published CLI surface; nothing is cached, materialized, or
 * written back, and this module holds no state between calls. The audit's
 * non-goal — "do not persist a duplicate mutable graph" — is met by there being
 * no store to persist into: `collectProjection()` is a pure function of the
 * world plus a command runner.
 *
 * The only commands this module may issue are the ones in READ_ONLY_COMMANDS
 * below. Argv is built exclusively from that table, so there is no code path
 * that can issue a mutating command — the guarantee is structural, and the test
 * suite asserts the recorded argv against the same table.
 *
 * Why the source CLIs and not the databases: `sp ps --json` and `xtmux
 * topology --json` are published contracts; .specialists/db/observability.db and
 * the xtmux state DB are private schemas owned by other repos. Reading them
 * directly would couple Core to another project's internals and would add a
 * native sqlite dependency to a CLI that has none.
 */

import { execFile } from 'node:child_process';
import { hostname } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type {
    TopologyBead,
    TopologyJob,
    TopologyPane,
    TopologyPaneAgent,
    TopologyProjectionV1,
    TopologyPullRequest,
    TopologySource,
    TopologySourceName,
    TopologyWorktree,
} from '@xtrm/contracts';

const execFileAsync = promisify(execFile);

/**
 * Field separator for the tmux format string.
 *
 * Tab, not the "obvious" ASCII unit separator: tmux escapes non-printable bytes
 * in format output as a literal backslash-octal sequence, so U+001F arrives as
 * the four characters \037 and every row fails to split. Tab passes through
 * verbatim, and git forbids control characters in ref names, so a branch can
 * never contain one.
 */
const SEP = '\t';

/**
 * tmux format fields, in argv order. `@agent_*` are the lineage pane options
 * Core's launcher writes (PR #465); tmux expands user options inside format
 * strings, so one `list-panes -a` call retrieves the whole fleet plus its
 * lineage instead of N `show-options` round trips.
 */
const PANE_FIELDS = [
    'pane_id',
    'session_id',
    'session_name',
    'window_id',
    'pane_current_command',
    'pane_current_path',
    '@agent_state',
    '@agent_role',
    '@agent_task',
    '@agent_bead',
    '@agent_worktree',
    '@agent_branch',
    '@agent_parent_session',
    '@agent_parent_pane',
    '@agent_instance_id',
] as const;

const PANE_FORMAT = PANE_FIELDS.map((f) => `#{${f}}`).join(SEP);

/**
 * Every command this module is permitted to run. Argv is taken from here rather
 * than assembled ad hoc, which is what makes "this never mutates anything" a
 * property of the code instead of a property of the review.
 */
export const READ_ONLY_COMMANDS = {
    xtmux: { bin: 'xtmux', args: ['topology', '--json'], timeoutMs: 5_000 },
    tmux: { bin: 'tmux', args: ['list-panes', '-a', '-F', PANE_FORMAT], timeoutMs: 5_000 },
    specialists: { bin: 'sp', args: ['ps', '--json'], timeoutMs: 10_000 },
    beads: { bin: 'bd', args: ['list', '--all', '--json'], timeoutMs: 10_000 },
    git: { bin: 'git', args: ['worktree', 'list', '--porcelain'], timeoutMs: 5_000 },
    github: {
        bin: 'gh',
        args: [
            'pr', 'list', '--state', 'all', '--limit', '100', '--json',
            'number,state,url,title,headRefName,baseRefName,isDraft,mergedAt',
        ],
        timeoutMs: 15_000,
    },
} as const satisfies Record<TopologySourceName, { bin: string; args: readonly string[]; timeoutMs: number }>;

export type RunOutcome =
    | { kind: 'ok'; stdout: string }
    /** Binary is not on PATH. Not a bug — the host simply does not have it. */
    | { kind: 'missing' }
    | { kind: 'timeout' }
    | { kind: 'failed'; reason: string };

export type CommandRunner = (
    bin: string,
    args: readonly string[],
    opts: { timeoutMs: number; cwd?: string },
) => Promise<RunOutcome>;

/**
 * Default runner. Bounded on both axes: `timeout` kills a hung source, and
 * `maxBuffer` caps a runaway one. Neither can take down the projection — a
 * failing source degrades to one `sources[]` entry.
 */
export const defaultRunner: CommandRunner = async (bin, args, { timeoutMs, cwd }) => {
    try {
        const { stdout } = await execFileAsync(bin, [...args], {
            timeout: timeoutMs,
            cwd,
            encoding: 'utf8',
            maxBuffer: 16 * 1024 * 1024,
            // Inherit nothing on stdin: a source CLI that decides to prompt must
            // fail fast rather than hang the projection waiting for a keystroke.
            windowsHide: true,
        } as Parameters<typeof execFileAsync>[2]);
        return { kind: 'ok', stdout: String(stdout) };
    } catch (error) {
        const err = error as NodeJS.ErrnoException & { killed?: boolean; stderr?: string };
        if (err.code === 'ENOENT') return { kind: 'missing' };
        if (err.killed) return { kind: 'timeout' };
        return { kind: 'failed', reason: firstLine(err.stderr) || err.message || 'unknown failure' };
    }
};

/** Keep `sources[].reason` to one line and free of command output / secrets. */
function firstLine(text: string | undefined): string {
    if (!text) return '';
    const line = text.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
    return line.length > 200 ? `${line.slice(0, 197)}...` : line;
}

export interface CollectOptions {
    /** Repo root for git/gh queries. Defaults to process.cwd(). */
    cwd?: string;
    /** Skip GitHub — the slowest, rate-limited source. Recorded as unavailable. */
    includeGithub?: boolean;
    runner?: CommandRunner;
    now?: () => number;
}

/** One source's raw result plus the ledger entry describing how it went. */
interface SourceRead<T> {
    entry: TopologySource;
    data: T | null;
}

async function readSource<T>(
    name: TopologySourceName,
    parse: (stdout: string) => T,
    opts: { runner: CommandRunner; cwd?: string; now: () => number },
): Promise<SourceRead<T>> {
    const { bin, args, timeoutMs } = READ_ONLY_COMMANDS[name];
    const started = opts.now();
    const outcome = await opts.runner(bin, args, { timeoutMs, cwd: opts.cwd });
    const duration_ms = Math.max(0, opts.now() - started);

    if (outcome.kind === 'missing') {
        return { entry: { name, status: 'unavailable', reason: `${bin} not found on PATH`, duration_ms }, data: null };
    }
    if (outcome.kind === 'timeout') {
        return { entry: { name, status: 'error', reason: `${bin} timed out after ${timeoutMs}ms`, duration_ms }, data: null };
    }
    if (outcome.kind === 'failed') {
        return { entry: { name, status: 'error', reason: outcome.reason, duration_ms }, data: null };
    }
    try {
        return { entry: { name, status: 'ok', reason: null, duration_ms }, data: parse(outcome.stdout) };
    } catch (error) {
        // Parsed-but-unusable is an error, not unavailability: the binary is
        // present and answered, so a shape mismatch is a real signal.
        const reason = error instanceof Error ? error.message : 'unparseable output';
        return { entry: { name, status: 'error', reason: firstLine(reason), duration_ms }, data: null };
    }
}

// ── source parsers ──────────────────────────────────────────────────────────

interface RawPane {
    pane_id: string;
    session_id: string;
    session_name: string;
    window_id: string | null;
    current_command: string;
    current_path: string;
    agent: TopologyPaneAgent | null;
}

export function parsePanes(stdout: string): RawPane[] {
    const panes: RawPane[] = [];
    for (const line of stdout.split('\n')) {
        if (!line.trim()) continue;
        const cols = line.split(SEP);
        if (cols.length < PANE_FIELDS.length) continue;
        const [
            pane_id, session_id, session_name, window_id, current_command, current_path,
            state, role, task, bead_id, worktree, branch, parent_session_id, parent_pane_id, instance_id,
        ] = cols;
        // A pane is an xtrm-launched agent only if it carries lineage. A plain
        // shell gets `agent: null` rather than an object of empty strings —
        // "not an agent" and "an agent with no role" are different facts.
        const lineage = [state, role, task, bead_id, worktree, branch, parent_session_id];
        const agent: TopologyPaneAgent | null = lineage.some(Boolean)
            ? {
                state: blankToNull(state),
                role: blankToNull(role),
                task: blankToNull(task),
                bead_id: blankToNull(bead_id),
                worktree: blankToNull(worktree),
                branch: blankToNull(branch),
                parent_session_id: blankToNull(parent_session_id),
                parent_pane_id: blankToNull(parent_pane_id),
                instance_id: blankToNull(instance_id),
            }
            : null;
        panes.push({
            pane_id,
            session_id,
            session_name,
            window_id: blankToNull(window_id),
            current_command,
            current_path,
            agent,
        });
    }
    return panes;
}

const blankToNull = (v: string | undefined): string | null => (v && v.length > 0 ? v : null);

/** Host identity from the xtmux topology snapshot; panes come from tmux. */
export function parseXtmuxHost(stdout: string): { host_id: string; tmux_server_id: string | null } {
    const parsed = JSON.parse(stdout) as { host?: { host_id?: string; tmux_server_id?: string } };
    return {
        host_id: parsed.host?.host_id || hostname(),
        tmux_server_id: parsed.host?.tmux_server_id ?? null,
    };
}

export function parseJobs(stdout: string): TopologyJob[] {
    const parsed = JSON.parse(stdout) as { flat?: unknown[] };
    const rows = Array.isArray(parsed.flat) ? parsed.flat : [];
    return rows.map((row) => {
        const r = row as Record<string, unknown>;
        const job_id = String(r.id ?? '');
        return {
            job_id,
            specialist: str(r.specialist) ?? '',
            // Specialists owns this vocabulary; Core passes it through rather
            // than remapping it into a Core-flavoured enum that would drift.
            status: str(r.status) ?? 'unknown',
            bead_id: str(r.bead_id),
            epic_id: str(r.epic_id),
            chain_id: str(r.chain_id),
            chain_root_job_id: str(r.chain_root_job_id),
            is_chain_root: r.chain_root_job_id ? String(r.chain_root_job_id) === job_id : true,
            branch: str(r.branch),
            worktree_path: str(r.worktree_path),
            integration_target_branch: null,
            started_at_ms: typeof r.started_at_ms === 'number' ? r.started_at_ms : null,
            owning_pane_id: null,
        } satisfies TopologyJob;
    }).filter((j) => j.job_id.length > 0);
}

/**
 * Beads resolve from the INVOKING repo's database only. A pane sitting in a
 * different project reports its bead id with status `unknown` rather than a
 * wrong status — the projection will not guess across repo boundaries.
 */
export function parseBeads(stdout: string): Map<string, TopologyBead> {
    const rows = JSON.parse(stdout) as unknown;
    const map = new Map<string, TopologyBead>();
    if (!Array.isArray(rows)) return map;
    for (const row of rows) {
        const r = row as Record<string, unknown>;
        const id = str(r.id);
        if (!id) continue;
        map.set(id, {
            id,
            status: str(r.status) ?? 'unknown',
            title: str(r.title),
            issue_type: str(r.issue_type) ?? str(r.type),
            priority: typeof r.priority === 'number' ? r.priority : null,
            parent_id: str(r.parent_id) ?? str(r.parent),
        });
    }
    return map;
}

export function parseWorktrees(stdout: string): TopologyWorktree[] {
    const trees: TopologyWorktree[] = [];
    let current: Partial<TopologyWorktree> & { path?: string } = {};
    const flush = () => {
        if (current.path) {
            trees.push({
                path: current.path,
                branch: current.branch ?? null,
                head_sha: current.head_sha ?? null,
                detached: current.detached ?? false,
                shared_by_pane_ids: [],
            });
        }
        current = {};
    };
    for (const line of stdout.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) { flush(); continue; }
        if (trimmed.startsWith('worktree ')) { flush(); current.path = trimmed.slice('worktree '.length); }
        else if (trimmed.startsWith('HEAD ')) current.head_sha = trimmed.slice('HEAD '.length);
        else if (trimmed.startsWith('branch ')) current.branch = trimmed.slice('branch '.length).replace(/^refs\/heads\//, '');
        else if (trimmed === 'detached') current.detached = true;
    }
    flush();
    return trees;
}

export function parsePullRequests(stdout: string): Map<string, TopologyPullRequest> {
    const rows = JSON.parse(stdout) as unknown;
    const byBranch = new Map<string, TopologyPullRequest>();
    if (!Array.isArray(rows)) return byBranch;
    for (const row of rows) {
        const r = row as Record<string, unknown>;
        const head_branch = str(r.headRefName);
        const number = typeof r.number === 'number' ? r.number : null;
        if (!head_branch || number === null) continue;
        const pr: TopologyPullRequest = {
            number,
            state: str(r.state) ?? 'UNKNOWN',
            url: str(r.url),
            title: str(r.title),
            head_branch,
            base_branch: str(r.baseRefName),
            is_draft: typeof r.isDraft === 'boolean' ? r.isDraft : null,
            merged_at: str(r.mergedAt),
            checks_state: null,
        };
        // Newest PR per branch wins: a recycled branch name would otherwise
        // report a stale closed PR as the branch's current state.
        const existing = byBranch.get(head_branch);
        if (!existing || pr.number > existing.number) byBranch.set(head_branch, pr);
    }
    return byBranch;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

function mergeWorktreeReads(reads: SourceRead<TopologyWorktree[]>[]): SourceRead<TopologyWorktree[]> {
    const trees = new Map<string, TopologyWorktree>();
    for (const read of reads) {
        for (const tree of read.data ?? []) trees.set(tree.path, tree);
    }

    const failures = reads.filter((read) => read.entry.status !== 'ok');
    const allUnavailable = failures.length === reads.length && failures.every((read) => read.entry.status === 'unavailable');
    return {
        entry: {
            name: 'git',
            status: failures.length === 0 ? 'ok' : allUnavailable ? 'unavailable' : 'error',
            reason: failures.length === 0
                ? null
                : failures.map((read) => read.entry.reason).filter(Boolean).join('; '),
            duration_ms: reads.reduce((total, read) => total + read.entry.duration_ms, 0),
        },
        data: trees.size > 0 || failures.length < reads.length ? [...trees.values()] : null,
    };
}

// ── the join ────────────────────────────────────────────────────────────────

/** Longest-prefix match: the most specific worktree containing this path. */
function worktreeForPath(trees: TopologyWorktree[], target: string | null): TopologyWorktree | null {
    if (!target) return null;
    let best: TopologyWorktree | null = null;
    for (const tree of trees) {
        if (target === tree.path || target.startsWith(tree.path + path.sep)) {
            if (!best || tree.path.length > best.path.length) best = tree;
        }
    }
    return best;
}

export async function collectProjection(options: CollectOptions = {}): Promise<TopologyProjectionV1> {
    const runner = options.runner ?? defaultRunner;
    const now = options.now ?? (() => Date.now());
    const cwd = options.cwd ?? process.cwd();
    const includeGithub = options.includeGithub ?? true;
    const ctx = { runner, cwd, now };

    // The pane list is server-wide, so first read it alongside the other
    // independent sources. Git worktrees are then queried from the invocation
    // repository and from any pane path outside that initial inventory; this
    // keeps the common case to one git call while making cross-repo panes
    // visible instead of silently treating their worktrees as missing.
    const [xtmuxRead, paneRead, jobRead, beadRead, prRead] = await Promise.all([
        readSource('xtmux', parseXtmuxHost, ctx),
        readSource('tmux', parsePanes, ctx),
        readSource('specialists', parseJobs, ctx),
        readSource('beads', parseBeads, ctx),
        includeGithub
            ? readSource('github', parsePullRequests, ctx)
            : Promise.resolve<SourceRead<Map<string, TopologyPullRequest>>>({
                entry: { name: 'github', status: 'unavailable', reason: 'skipped by --no-github', duration_ms: 0 },
                data: null,
            }),
    ]);

    const rawPanes = paneRead.data ?? [];
    const initialTreeRead = await readSource('git', parseWorktrees, ctx);
    const knownTrees = initialTreeRead.data ?? [];
    const extraRepoPaths = [...new Set(rawPanes.flatMap((pane) => [
        pane.current_path,
        pane.agent?.worktree,
    ].filter((candidate): candidate is string => Boolean(candidate))))]
        .filter((candidate) => !worktreeForPath(knownTrees, candidate));
    const extraTreeReads = await Promise.all(extraRepoPaths.map((repoPath) =>
        readSource('git', parseWorktrees, { ...ctx, cwd: repoPath })));
    const treeRead = mergeWorktreeReads([initialTreeRead, ...extraTreeReads]);

    const jobs = jobRead.data ?? [];
    const beads = beadRead.data ?? new Map<string, TopologyBead>();
    const worktrees = treeRead.data ?? [];
    const prs = prRead.data ?? new Map<string, TopologyPullRequest>();

    // Worktree collisions: every pane whose cwd resolves into a worktree. Length
    // > 1 is the shared-checkout hazard the multiplexing doctrine warns about.
    for (const pane of rawPanes) {
        const tree = worktreeForPath(worktrees, pane.current_path);
        if (tree) tree.shared_by_pane_ids = [...(tree.shared_by_pane_ids ?? []), pane.pane_id];
    }

    const claimedJobs = new Set<string>();
    const usedWorktrees = new Set<string>();

    const panes: TopologyPane[] = rawPanes.map((raw) => {
        const agent = raw.agent;
        const worktree = worktreeForPath(worktrees, agent?.worktree ?? raw.current_path);
        if (worktree) usedWorktrees.add(worktree.path);

        // A job belongs to a pane when they share a bead (directly or via the
        // pane's bead being the job's epic), or when the pane is sitting IN the
        // job's own worktree.
        //
        // The worktree test is exact equality, deliberately. "Job worktree is
        // nested under the pane's" looks more generous but is wrong: specialist
        // worktrees live under the repo root, so any pane sitting at the root
        // would claim every running job in the repo regardless of ownership.
        // Observed on a live host — a plain `diff` shell at the repo root
        // adopted an unrelated reviewer job. Bead identity is the real key;
        // this only catches a pane parked inside the job's checkout.
        const paneBeadId = agent?.bead_id ?? null;
        const paneWorktreePath = worktree?.path ?? null;
        const paneJobs = jobs
            .filter((job) => {
                if (claimedJobs.has(job.job_id)) return false;
                if (paneBeadId && (job.bead_id === paneBeadId || job.epic_id === paneBeadId)) return true;
                if (paneWorktreePath && job.worktree_path === paneWorktreePath) return true;
                return false;
            })
            .map((job) => {
                claimedJobs.add(job.job_id);
                return {
                    ...job,
                    owning_pane_id: raw.pane_id,
                    // The coordinator's branch IS the integration target its
                    // chains derive from (audit P1-03).
                    integration_target_branch: agent?.branch ?? null,
                } satisfies TopologyJob;
            });

        const branch = agent?.branch ?? worktree?.branch ?? null;

        return {
            pane_id: raw.pane_id,
            session_id: raw.session_id,
            session_name: raw.session_name,
            window_id: raw.window_id,
            current_command: raw.current_command,
            current_path: raw.current_path,
            agent,
            jobs: paneJobs,
            bead: paneBeadId ? beads.get(paneBeadId) ?? { id: paneBeadId, status: 'unknown' } : null,
            worktree,
            pull_request: branch ? prs.get(branch) ?? null : null,
        } satisfies TopologyPane;
    });

    return {
        schema_version: 'xtrm.topology.projection.v1',
        generated_at_ms: now(),
        host: {
            host_id: xtmuxRead.data?.host_id ?? hostname(),
            tmux_server_id: xtmuxRead.data?.tmux_server_id ?? null,
        },
        sources: [xtmuxRead.entry, paneRead.entry, jobRead.entry, beadRead.entry, treeRead.entry, prRead.entry],
        panes,
        // Anything no live pane claimed. Without this a job whose coordinator
        // pane died, or a worktree whose session was killed, silently vanishes.
        orphans: {
            jobs: jobs.filter((job) => !claimedJobs.has(job.job_id)),
            worktrees: worktrees.filter((tree) => !usedWorktrees.has(tree.path)),
        },
    };
}
