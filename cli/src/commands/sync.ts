import { Command } from 'commander';
import kleur from 'kleur';
// @ts-ignore
import prompts from 'prompts';
import ora from 'ora';
import { getContext } from '../core/context.js';
import { calculateDiff, PruneModeReadError } from '../core/diff.js';
import { executeSync } from '../core/sync-executor.js';
import { findRepoRoot } from '../utils/repo-root.js';
import path from 'path';

export function createSyncCommand(): Command {
    return new Command('sync')
        .description('Sync agent tools (skills, hooks, config) to target environments')
        .option('--dry-run', 'Preview changes without making any modifications', false)
        .option('-y, --yes', 'Skip confirmation prompts', false)
        .option('--prune', 'Remove items not in the canonical repository', false)
        .option('--backport', 'Backport drifted local changes back to the repository', false)
        .action(async (opts) => {
            const { dryRun, yes, prune, backport } = opts;
            const actionType = backport ? 'backport' : 'sync';
            
            // Detect repo root dynamically
            const repoRoot = await findRepoRoot();

            const ctxSpinner = ora('Detecting environments…').start();
            const ctx = await getContext();
            ctxSpinner.succeed('Config loaded');
            
            const { targets, syncMode, config } = ctx;

            // Collect all changesets first
            interface TargetChanges {
                target: string;
                changeSet: any;
                totalChanges: number;
                skippedDrifted: string[];
            }
            
            const allChanges: TargetChanges[] = [];
            let totalCount = 0;

            for (const target of targets) {
                const diffSpinner = ora(`Calculating diff for ${path.basename(target)}…`).start();
                const changeSet = await calculateDiff(repoRoot, target, prune);
                const totalChanges = Object.values(changeSet).reduce((sum, cat: any) => {
                    return sum + cat.missing.length + cat.outdated.length + cat.drifted.length;
                }, 0);
                
                diffSpinner.succeed('Plan generated');

                if (totalChanges === 0) {
                    continue;
                }

                allChanges.push({ target, changeSet, totalChanges, skippedDrifted: [] });
            }

            if (allChanges.length === 0) {
                console.log(kleur.green('\n✓ All targets are up-to-date\n'));
                return;
            }

            // Display full plan
            console.log(kleur.bold('\n📋 Sync Plan:'));
            for (const { target, changeSet, totalChanges } of allChanges) {
                console.log(kleur.bold(`\n📂 ${path.basename(target)} → ${totalChanges} changes`));
                
                for (const [category, cat] of Object.entries(changeSet)) {
                    const c = cat as any;
                    if (c.missing.length > 0) {
                        console.log(kleur.yellow(`  + ${c.missing.length} missing ${category}: ${c.missing.join(', ')}`));
                    }
                    if (c.outdated.length > 0) {
                        console.log(kleur.blue(`  ↑ ${c.outdated.length} outdated ${category}: ${c.outdated.join(', ')}`));
                    }
                    if (c.drifted.length > 0) {
                        console.log(kleur.red(`  ✗ ${c.drifted.length} drifted ${category}: ${c.drifted.join(', ')}`));
                    }
                }
            }

            // Show dry-run notice after plan
            if (dryRun) {
                console.log(kleur.cyan('\n💡 Dry run — no changes written\n'));
            }

            // Ask for confirmation once
            if (!yes && !dryRun) {
                const totalChangesCount = allChanges.reduce((sum, c) => sum + c.totalChanges, 0);
                const { confirm } = await prompts({
                    type: 'confirm',
                    name: 'confirm',
                    message: `Proceed with ${actionType} (${totalChangesCount} total changes)?`,
                    initial: true,
                });

                if (!confirm) {
                    console.log(kleur.gray('  Sync cancelled.\n'));
                    return;
                }
            }

            // Execute sync for all targets
            for (const { target, changeSet, skippedDrifted } of allChanges) {
                console.log(kleur.bold(`\n📂 Target: ${path.basename(target)}`));
                
                const syncSpinner = ora('Syncing…').start();
                const count = await executeSync(repoRoot, target, changeSet, syncMode, actionType, dryRun);
                syncSpinner.succeed(`Synced ${count} items`);
                
                totalCount += count;
                
                // Track skipped drifted items
                for (const [category, cat] of Object.entries(changeSet)) {
                    const c = cat as any;
                    if (c.drifted.length > 0 && actionType === 'sync') {
                        skippedDrifted.push(...c.drifted.map((item: string) => `${category}/${item}`));
                    }
                }
            }

            // Report skipped drifted items
            const allSkipped = allChanges.flatMap(c => c.skippedDrifted);
            if (allSkipped.length > 0 && actionType === 'sync' && !dryRun) {
                console.log(kleur.yellow(`\n  ⚠ ${allSkipped.length} drifted item(s) skipped (local edits preserved):`));
                for (const item of allSkipped) {
                    console.log(kleur.yellow(`      ${item}`));
                }
                console.log(kleur.yellow(`  Run 'jaggers-config sync --backport' to push them back.\n`));
            }

            console.log(kleur.bold(kleur.green(`\n✓ Total: ${totalCount} items synced\n`)));
        });
}
