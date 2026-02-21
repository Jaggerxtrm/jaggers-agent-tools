import { Command } from 'commander';
import kleur from 'kleur';
// @ts-ignore
import prompts from 'prompts';
import { getContext } from '../core/context.js';
import { calculateDiff } from '../core/diff.js';
import { executeSync } from '../core/sync-executor.js';
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
            const repoRoot = path.resolve(process.cwd(), '..');

            if (dryRun) {
                console.log(kleur.cyan('\n  DRY RUN — no changes will be written\n'));
            }

            const ctx = await getContext();
            const { targets, syncMode, config } = ctx;

            let totalCount = 0;

            for (const target of targets) {
                console.log(kleur.bold(`\n📂 Target: ${target}`));

                const changeSet = await calculateDiff(repoRoot, target);
                const totalChanges = Object.values(changeSet).reduce((sum, cat: any) => {
                    return sum + cat.missing.length + cat.outdated.length + cat.drifted.length;
                }, 0);

                if (totalChanges === 0) {
                    console.log(kleur.green('  ✓ Already up-to-date'));
                    continue;
                }

                // Print change summary
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

                if (!yes && !dryRun) {
                    const { confirm } = await prompts({
                        type: 'confirm',
                        name: 'confirm',
                        message: `Proceed with ${actionType} (${totalChanges} changes)?`,
                        initial: true,
                    });

                    if (!confirm) {
                        console.log(kleur.gray('  Skipped.'));
                        continue;
                    }
                }

                const count = await executeSync(repoRoot, target, changeSet, syncMode, actionType, dryRun);
                totalCount += count;
                console.log(kleur.green(`  ✓ ${dryRun ? '[DRY RUN]' : ''} Synced ${count} items`));
            }

            console.log(kleur.bold(kleur.green(`\n✓ Total: ${totalCount} items synced\n`)));
        });
}
