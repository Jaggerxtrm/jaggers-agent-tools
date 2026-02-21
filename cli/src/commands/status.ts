import { Command } from 'commander';
import kleur from 'kleur';
import { getContext } from '../core/context.js';
import { calculateDiff } from '../core/diff.js';
import path from 'path';

export function createStatusCommand(): Command {
    return new Command('status')
        .description('Show diff between repo and target environments (read-only)')
        .action(async () => {
            const repoRoot = path.resolve(process.cwd(), '..');
            const ctx = await getContext();
            const { targets } = ctx;

            for (const target of targets) {
                console.log(kleur.bold(`\n📂 ${target}`));

                const changeSet = await calculateDiff(repoRoot, target);
                let hasChanges = false;

                for (const [category, cat] of Object.entries(changeSet)) {
                    const c = cat as any;
                    if (c.missing.length === 0 && c.outdated.length === 0 && c.drifted.length === 0) continue;
                    hasChanges = true;

                    console.log(kleur.bold(`  ${category}:`));
                    for (const item of c.missing) {
                        console.log(kleur.yellow(`    + ${item} (missing)`));
                    }
                    for (const item of c.outdated) {
                        console.log(kleur.blue(`    ↑ ${item} (outdated)`));
                    }
                    for (const item of c.drifted) {
                        console.log(kleur.red(`    ✗ ${item} (drifted — local ahead)`));
                    }
                }

                if (!hasChanges) {
                    console.log(kleur.green('  ✓ Up-to-date'));
                }
            }

            console.log();
        });
}
