import { Command } from 'commander';
import kleur from 'kleur';
import { spawn, spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { confirmDestructiveAction } from '../utils/confirmation.js';

/**
 * Identity of the pane running `xt merge`, as published by the launcher
 * (xtrm-6hey0.2). A pane that carries a role AND names a different session as
 * its parent is a *subordinate* — a coordinator or specialist session spawned
 * by someone else.
 *
 * Everything here degrades to "not subordinate" when tmux, the pane options, or
 * the launcher metadata are absent. That is deliberate: this is a UX guardrail
 * against the merge-authority mistake the audit names (P1-04), not a security
 * boundary. Anyone who can run `xt merge` can also run `gh pr merge`.
 *
 * Pure-ish — reads tmux only. Exported for unit testing.
 */
export function readSubordinateIdentity(
    query: (args: string[]) => string = (args) =>
        (spawnSync('tmux', args, { encoding: 'utf8', stdio: 'pipe' }).stdout ?? '').trim(),
    insideTmux: boolean = Boolean(process.env.TMUX),
): { subordinate: false } | { subordinate: true; role: string; parent: string } {
    if (!insideTmux) return { subordinate: false };
    const paneId = query(['display-message', '-p', '#{pane_id}']);
    if (!paneId) return { subordinate: false };
    const role = query(['show-options', '-p', '-t', paneId, '-qv', '@agent_role']);
    if (!role) return { subordinate: false };
    const parent = query(['show-options', '-p', '-t', paneId, '-qv', '@agent_parent_session']);
    const own = query(['display-message', '-p', '#{session_id}']);
    // A role session whose parent is itself (or unset) is not subordinate to
    // anyone — it is the operator having primed their own pane with a role.
    if (!parent || parent === own) return { subordinate: false };
    return { subordinate: true, role, parent };
}

export function createMergeCommand(): Command {
    return new Command('merge')
        .description('Drain the xt worktree PR merge queue via the xt-merge specialist')
        .option('--dry-run', 'List queue and CI status without merging', false)
        .option('-y, --yes', 'Skip confirmation prompt', false)
        .option('--no-beads', 'Skip creating a tracking bead for this run', false)
        .option('--override-authority', 'Run from a subordinate role session anyway (operator override — see docs/architecture/coordinator-branch-ancestry.md)', false)
        .action(async (opts: { dryRun: boolean; yes: boolean; beads: boolean; overrideAuthority: boolean }) => {
            const cwd = process.cwd();

            // Gate: merge authority (audit P1-04). `xt merge` is the one surface
            // in Core that merges into main, so it is where the authority ladder
            // is enforceable: a specialist may publish its own branch, a
            // coordinator may merge accepted specialist branches into its
            // coordinator branch, but only the main orchestrator merges into
            // main. A dry run inspects the queue without merging, so it is not
            // an authority act and stays allowed.
            const identity = readSubordinateIdentity();
            if (identity.subordinate && !opts.dryRun && !opts.overrideAuthority) {
                console.error(kleur.red(
                    '\n  ✗ xt merge is main-orchestrator authority.\n\n'
                    + `  This pane runs role '${identity.role}' and is subordinate to ${identity.parent}.\n`
                    + '  A subordinate session may publish its own branch and open a PR; merging\n'
                    + '  into main belongs to the orchestrator that owns the epic.\n\n'
                    + '  Instead:\n'
                    + '    • report readiness to your parent, and let it merge, or\n'
                    + '    • xt merge --dry-run          inspect the queue without merging, or\n'
                    + '    • xt merge --override-authority   operator override, if you are the operator\n',
                ));
                process.exit(1);
            }

            // Gate: must be inside a git repository
            const gitCheck = spawnSync('git', ['rev-parse', '--git-dir'], { cwd, encoding: 'utf8', stdio: 'pipe' });
            if (gitCheck.status !== 0) {
                console.error(kleur.red('\n  ✗ Not inside a git repository.\n'));
                process.exit(1);
            }

            // Gate: gh must be authenticated
            const ghAuth = spawnSync('gh', ['auth', 'status'], { cwd, encoding: 'utf8', stdio: 'pipe' });
            if (ghAuth.status !== 0) {
                console.error(kleur.red(
                    '\n  ✗ gh is not authenticated.\n' +
                    '  Run: gh auth login\n'
                ));
                process.exit(1);
            }

            // Gate: warn on uncommitted changes — rebase cascade checks out other branches.
            // Exclude .beads/ (runtime noise: dolt-monitor.pid, dolt-server.activity, etc.)
            const dirty = spawnSync('git', ['status', '--porcelain', '--', ':!.beads/', ':!.specialists/'], { cwd, encoding: 'utf8', stdio: 'pipe' });
            if (dirty.stdout.trim().length > 0) {
                console.error(kleur.yellow(
                    '\n  ⚠ Uncommitted changes detected.\n' +
                    '  The rebase cascade will check out other branches — a dirty tree\n' +
                    '  will either fail or carry changes onto the wrong branch.\n\n' +
                    '  Stash first:  git stash push -m "xt-merge cascade stash"\n' +
                    '  Then re-run:  xt merge\n'
                ));
                process.exit(1);
            }

            // Gate: specialists CLI must be available
            const check = spawnSync('specialists', ['--version'], { encoding: 'utf8', stdio: 'pipe' });
            if (check.status !== 0) {
                console.error(kleur.red(
                    '\n  ✗ specialists CLI not found.\n' +
                    '  Install with: npm install -g @jaggerxtrm/specialists\n'
                ));
                process.exit(1);
            }

            // Gate: xt-merge specialist must be discovered
            const list = spawnSync('specialists', ['list', '--json'], { cwd, encoding: 'utf8', stdio: 'pipe' });
            if (list.status === 0) {
                try {
                    const specialists: Array<{ name: string }> = JSON.parse(list.stdout);
                    if (!specialists.some(s => s.name === 'xt-merge')) {
                        console.error(kleur.red(
                            '\n  ✗ xt-merge specialist not found.\n' +
                            '  Run `specialists init` to install canonical specialists.\n'
                        ));
                        process.exit(1);
                    }
                } catch { /* non-fatal: proceed and let specialists run handle it */ }
            }

            if (!opts.dryRun) {
                const confirmed = await confirmDestructiveAction({
                    yes: opts.yes,
                    message: 'Drain and merge the xt PR queue?',
                    initial: false,
                });
                if (!confirmed) {
                    console.log(kleur.dim('  Cancelled\n'));
                    return;
                }
            }

            const prompt = opts.dryRun
                ? 'List all open xt/ PRs sorted by creation time and check CI status on each. Do not merge anything.'
                : 'Drain the xt worktree PR merge queue.';

            const args = ['run', 'xt-merge', '--prompt', prompt];
            if (!opts.beads) args.push('--no-beads');

            console.log(kleur.bold(`\n  xt merge${opts.dryRun ? ' (dry run)' : ''}\n`));

            // Snapshot job IDs before running so we can find the new one after
            const jobsDir = join(cwd, '.specialists', 'jobs');
            let jobsBefore: Set<string>;
            try {
                jobsBefore = new Set(
                    readdirSync(jobsDir, { withFileTypes: true })
                        .filter(d => d.isDirectory())
                        .map(d => d.name),
                );
            } catch {
                jobsBefore = new Set();
            }

            // Spawn detached so we can poll independently — stdio: 'ignore' avoids
            // the TTY-close hang that occurs with piped or inherited output.
            const runProc = spawn('specialists', args, { cwd, detached: true, stdio: 'ignore' });
            runProc.unref();

            // Wait for the new job directory to appear (created at job startup, not completion)
            const jobId = await (async () => {
                const deadline = Date.now() + 15_000;
                while (Date.now() < deadline) {
                    try {
                        const entries = readdirSync(jobsDir, { withFileTypes: true })
                            .filter(d => d.isDirectory())
                            .map(d => d.name);
                        const newId = entries.find(id => !jobsBefore.has(id));
                        if (newId) return newId;
                    } catch { /* dir not yet created */ }
                    await new Promise(r => setTimeout(r, 200));
                }
                return undefined;
            })();

            if (!jobId) {
                console.error(kleur.red('\n  ✗ Timed out waiting for xt-merge job to start.\n'));
                process.exit(1);
            }

            // Stream live events via feed, then print final specialist output.
            const feed = spawnSync('specialists', ['feed', '--job', jobId, '--follow'], { cwd, stdio: 'inherit' });
            if (feed.status !== 0) {
                process.exit(feed.status ?? 1);
            }

            const result = spawnSync('specialists', ['result', jobId, '--wait'], { cwd, stdio: 'inherit' });
            process.exit(result.status ?? 0);
        });
}
