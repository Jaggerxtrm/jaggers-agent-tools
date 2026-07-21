/**
 * `xt topology` — the aggregated topology projection (audit ~/dev/11.md P2-05).
 *
 * Read-only. Every invocation recomputes the snapshot from live sources; there
 * is no cache to go stale and no state to write back.
 */

import { Command } from 'commander';
import kleur from 'kleur';
import { collectProjection } from '../core/topology-projection.js';
import type { TopologyProjectionV1 } from '@xtrm/contracts';

/** Compact default output. Rendered views land with audit P2-06. */
function printSummary(projection: TopologyProjectionV1): void {
    const agentPanes = projection.panes.filter((p) => p.agent);
    const jobs = projection.panes.reduce((n, p) => n + p.jobs.length, 0);
    const collisions = projection.panes
        .map((p) => p.worktree)
        .filter((w): w is NonNullable<typeof w> => Boolean(w) && (w!.shared_by_pane_ids?.length ?? 0) > 1);

    console.log(kleur.bold('sources'));
    for (const s of projection.sources) {
        const mark = s.status === 'ok' ? kleur.green('ok') : s.status === 'unavailable' ? kleur.yellow('unavailable') : kleur.red('error');
        const detail = s.reason ? kleur.dim(` — ${s.reason}`) : '';
        console.log(`  ${s.name.padEnd(12)} ${mark}${detail} ${kleur.dim(`(${s.duration_ms}ms)`)}`);
    }

    console.log(kleur.bold('\nprojection'));
    console.log(`  panes            ${projection.panes.length} (${agentPanes.length} agent)`);
    console.log(`  specialist jobs  ${jobs} attached, ${projection.orphans.jobs.length} orphaned`);
    console.log(`  worktrees        ${projection.orphans.worktrees.length} unattached`);
    if (collisions.length > 0) {
        console.log(kleur.yellow(`  collisions       ${new Set(collisions.map((w) => w.path)).size} worktree(s) shared by >1 pane`));
    }

    // Degraded output must never read as an empty world.
    const degraded = projection.sources.filter((s) => s.status !== 'ok');
    if (degraded.length > 0) {
        console.log(kleur.dim(`\n${degraded.length} source(s) did not report; counts above are partial.`));
    }
    console.log(kleur.dim('\nFull snapshot: xt topology --json'));
}

export function createTopologyCommand(): Command {
    const cmd = new Command('topology');

    cmd
        .description('Read-only aggregated projection joining panes, roles, specialist jobs, beads, worktrees, branches and PRs')
        .option('--json', 'Print the machine-readable xtrm.topology.projection.v1 snapshot', false)
        .option('--no-github', 'Skip the GitHub query (slowest, rate-limited); PR evidence is omitted')
        .action(async (options: { json?: boolean; github?: boolean }) => {
            const projection = await collectProjection({
                includeGithub: options.github !== false,
            });

            if (options.json) {
                console.log(JSON.stringify(projection, null, 2));
                return;
            }
            printSummary(projection);
        });

    return cmd;
}
