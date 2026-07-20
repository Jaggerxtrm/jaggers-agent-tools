import { Command } from 'commander';
import kleur from 'kleur';
import fs from 'fs-extra';
import path from 'node:path';
import { ensureGlobalSkillsBootstrapped, logBootstrapTrigger } from '../core/global-skills-bootstrap.js';
import { ensureGlobalHooksBootstrapped } from '../core/global-hooks-bootstrap.js';
import { reconcileGlobalClaudeHooks } from '../core/claude-runtime-sync.js';
import { reconcileGlobalPiHooks } from '../core/pi-runtime-hooks.js';
import { shouldUseGlobalHooks } from '../core/global-hooks-flag.js';
import { resolvePackageRoot } from '../core/registry-scaffold.js';
import { resolveGlobalSkillsRoot, resolveStateFilePath } from '../core/skills-layout.js';

interface BootstrapOptions {
    force?: boolean;
}

const BOOTSTRAP_DEPRECATION = 'xt bootstrap is deprecated — use: xt update --apply --force (planned removal: v0.13.0)';

export function createBootstrapCommand(): Command {
    return new Command('bootstrap')
        .description('[deprecated] Populate global payloads; use xt update --apply --force (planned removal: v0.13.0)')
        .option('--force', 'Re-copy global skills payload even when version matches', false)
        .action(async (opts: BootstrapOptions) => {
            console.error(BOOTSTRAP_DEPRECATION);
            try {
                const packageRoot = resolvePackageRoot();
                const pkgJson = await fs.readJson(path.join(packageRoot, 'package.json')) as { version?: string };
                const pkgVersion = pkgJson.version ?? '0.0.0';
                await logBootstrapTrigger({ command: 'bootstrap', cwd: process.cwd(), pkgVersion });

                const result = await ensureGlobalSkillsBootstrapped(packageRoot, opts.force ? { force: true } : {});
                if (shouldUseGlobalHooks()) {
                    await ensureGlobalHooksBootstrapped(packageRoot, opts.force ? { force: true } : {});
                    await reconcileGlobalClaudeHooks();
                    await reconcileGlobalPiHooks();
                }
                const globalSkillsRoot = resolveGlobalSkillsRoot();
                const statePath = resolveStateFilePath(globalSkillsRoot);
                const state = await fs.readJson(statePath);

                if (result.changed) {
                    console.log(kleur.green(`✓ bootstrapped global skills @ version ${result.installedVersion}`));
                } else {
                    console.log(kleur.dim(`already up to date @ version ${result.installedVersion}`));
                }

                console.log(JSON.stringify({
                    skillsRoot: globalSkillsRoot,
                    statePath,
                    changed: result.changed,
                    state,
                }, null, 2));
                process.exitCode = 0;
            } catch (error) {
                console.error(kleur.red(`✗ ${error instanceof Error ? error.message : String(error)}`));
                process.exitCode = 1;
            }
        });
}
