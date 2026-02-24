import { Command } from 'commander';
import kleur from 'kleur';
import ora from 'ora';
import { getContext } from '../core/context.js';
import { calculateDiff } from '../core/diff.js';
import { findRepoRoot } from '../utils/repo-root.js';
import { getManifestPath } from '../core/manifest.js';
import fs from 'fs-extra';
import path from 'path';

function formatRelativeTime(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;
    
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    return `${days} day${days > 1 ? 's' : ''} ago`;
}

export function createStatusCommand(): Command {
    return new Command('status')
        .description('Show diff between repo and target environments (read-only)')
        .action(async () => {
            const loadingSpinner = ora('Checking environments…').start();
            
            const repoRoot = await findRepoRoot();
            const ctx = await getContext();
            const { targets } = ctx;

            loadingSpinner.succeed('Status loaded');

            for (const target of targets) {
                console.log(kleur.bold(`\n📂 ${path.basename(target)}`));

                // Try to load manifest for last sync time
                try {
                    const manifestPath = getManifestPath(target);
                    if (await fs.pathExists(manifestPath)) {
                        const manifest = await fs.readJson(manifestPath);
                        if (manifest.lastSync) {
                            console.log(kleur.gray(`  Last synced: ${formatRelativeTime(new Date(manifest.lastSync).getTime())}`));
                        }
                        // Count items from manifest
                        const itemCounts: string[] = [];
                        if (manifest.skills) itemCounts.push(`${manifest.skills} skills`);
                        if (manifest.hooks) itemCounts.push(`${manifest.hooks} hooks`);
                        if (manifest.config) itemCounts.push(`${manifest.config} config`);
                        if (itemCounts.length > 0) {
                            console.log(kleur.gray(`  Manifest: ${itemCounts.join(', ')}`));
                        }
                    }
                } catch (e) {
                    // Manifest not found or invalid, skip
                }

                const changeSet = await calculateDiff(repoRoot, target);
                let hasChanges = false;
                let totalChanges = 0;

                for (const [category, cat] of Object.entries(changeSet)) {
                    const c = cat as any;
                    const categoryChanges = c.missing.length + c.outdated.length + c.drifted.length;
                    totalChanges += categoryChanges;
                    
                    if (categoryChanges === 0) continue;
                    hasChanges = true;

                    if (c.missing.length > 0) {
                        console.log(kleur.yellow(`  + ${c.missing.length} missing ${category}`));
                    }
                    if (c.outdated.length > 0) {
                        console.log(kleur.blue(`  ↑ ${c.outdated.length} outdated ${category}`));
                    }
                    if (c.drifted.length > 0) {
                        console.log(kleur.red(`  ✗ ${c.drifted.length} drifted ${category}`));
                    }
                }

                if (!hasChanges) {
                    console.log(kleur.green('  ✓ Up-to-date'));
                } else {
                    // Show health indicator
                    console.log(kleur.yellow(`\n  ⚠ Pending changes: ${totalChanges}`));
                }
            }

            console.log(kleur.gray('\n💡 Run `jaggers-config sync` to apply changes\n'));
        });
}
