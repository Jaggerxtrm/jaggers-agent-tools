import { Command } from 'commander';
import kleur from 'kleur';
import ora from 'ora';
import { execSync } from 'child_process';
import { findRepoRoot } from '../utils/repo-root.js';
import { getContext } from '../core/context.js';
import { runPreflight } from '../core/preflight.js';
import { interactivePlan } from '../core/interactive-plan.js';
import { executeSync } from '../core/sync-executor.js';
import path from 'path';

export function createSyncCommand(): Command {
    return new Command('sync')
        .description('Sync skills, hooks, config, and MCP servers to all agent environments')
        .option('--dry-run', 'Preview the plan without making any changes', false)
        .option('-y, --yes', 'Skip interactive plan, apply all defaults', false)
        .option('--prune', 'Also remove items not present in the canonical repository', false)
        .option('--backport', 'Reverse direction: copy local edits back into the repository', false)
        .action(async (opts) => {
            const { dryRun, yes, prune, backport } = opts;
            const actionType: 'sync' | 'backport' = backport ? 'backport' : 'sync';
            const repoRoot = await findRepoRoot();

            // ── Phase 1: Preflight (all parallel) ──────────────────────────
            const spinner = ora('Checking environments…').start();
            let plan;
            try {
                if (!yes && !dryRun) {
                    spinner.stop();
                    const ctx = await getContext();
                    spinner.start('Running preflight checks…');
                    plan = await runPreflight(repoRoot, prune);
                    // Filter to user-selected targets only
                    plan = {
                        ...plan,
                        targets: plan.targets.filter(t => ctx.targets.includes(t.target)),
                    };
                } else {
                    plan = await runPreflight(repoRoot, prune);
                }

                const totalChanges = plan.targets.reduce(
                    (sum, t) => sum + t.files.length + t.mcpCore.filter(m => !m.installed).length, 0
                ) + plan.optionalServers.length;

                spinner.succeed(`Ready — ${totalChanges} potential change(s) across ${plan.targets.length} target(s)`);
            } catch (err: any) {
                spinner.fail(`Preflight failed: ${err.message}`);
                process.exit(1);
            }

            // ── Phase 2: Interactive plan ───────────────────────────────────
            const selected = await interactivePlan(plan, { dryRun, yes });
            if (!selected) return; // dry-run or cancelled

            if (selected.files.length === 0 && selected.mcpCore.length === 0 && selected.optionalServers.length === 0) {
                console.log(kleur.green('\n✓ Nothing to do\n'));
                return;
            }

            // ── Phase 3: Execute ────────────────────────────────────────────

            // 3a. Prerequisite installs for selected optional servers
            const postInstallMessages: string[] = [];
            for (const optServer of selected.optionalServers) {
                if (optServer.installCmd) {
                    const installSpinner = ora(`Installing: ${optServer.installCmd}`).start();
                    try {
                        execSync(optServer.installCmd, { stdio: 'pipe' });
                        installSpinner.succeed(kleur.green(`Installed: ${optServer.installCmd}`));
                    } catch (err: any) {
                        const stderr = (err.stderr as Buffer | undefined)?.toString() || err.message;
                        installSpinner.fail(kleur.red(`Failed: ${optServer.installCmd}`));
                        console.log(kleur.dim(`  ${stderr.trim()}`));
                    }
                }
                if (optServer.postInstallMessage) {
                    postInstallMessages.push(`[${optServer.name}]\n  ${optServer.postInstallMessage}`);
                }
            }

            // 3b. File sync per target
            const { syncMode } = plan;
            const targetPaths = [...new Set([
                ...selected.files.map(f => f.target),
                ...selected.mcpCore.map(m => m.target),
            ])];

            let totalSynced = 0;
            const skippedDrifted: string[] = [];

            for (const targetPath of targetPaths) {
                console.log(kleur.bold(`\n📂 ${path.basename(targetPath)}`));

                // Reconstruct a partial ChangeSet from selected file items
                const targetFiles = selected.files.filter(f => f.target === targetPath);
                const partialChangeSet: any = {
                    skills:                   { missing: [], outdated: [], drifted: [], total: 0 },
                    hooks:                    { missing: [], outdated: [], drifted: [], total: 0 },
                    config:                   { missing: [], outdated: [], drifted: [], total: 0 },
                    commands:                 { missing: [], outdated: [], drifted: [], total: 0 },
                    'qwen-commands':          { missing: [], outdated: [], drifted: [], total: 0 },
                    'antigravity-workflows':  { missing: [], outdated: [], drifted: [], total: 0 },
                };
                for (const f of targetFiles) {
                    if (partialChangeSet[f.category]) {
                        partialChangeSet[f.category][f.status].push(f.name);
                    }
                }

                const selectedOptionalNames = selected.optionalServers.map(s => s.name);
                const count = await executeSync(
                    repoRoot, targetPath, partialChangeSet, syncMode, actionType, false, selectedOptionalNames
                );
                totalSynced += count;

                // Track drifted files (user selected them — they won't be overwritten since executeSync respects drifted)
                for (const f of targetFiles) {
                    if (f.status === 'drifted') {
                        skippedDrifted.push(`${path.basename(targetPath)}/${f.category}/${f.name}`);
                    }
                }
            }

            // 3c. Summary
            console.log(kleur.bold(kleur.green(`\n✓ Synced ${totalSynced} item(s)\n`)));

            if (skippedDrifted.length > 0) {
                console.log(kleur.yellow(`  ⚠ ${skippedDrifted.length} drifted item(s) were preserved (local edits kept)`));
                console.log(kleur.yellow(`  Run 'jaggers-config sync --backport' to push them back to the repo.\n`));
            }

            // 3d. Post-install messages
            if (postInstallMessages.length > 0) {
                console.log(kleur.yellow().bold('⚠️  Next Steps Required:\n'));
                for (const msg of postInstallMessages) {
                    console.log(kleur.yellow(`  ${msg}`));
                }
                console.log('');
            }
        });
}
