import { Command } from 'commander';
import kleur from 'kleur';
import fs from 'fs-extra';
import path from 'node:path';
import { ensureGlobalSkillsBootstrapped, logBootstrapTrigger } from '../core/global-skills-bootstrap.js';
import { resolvePackageRoot } from '../core/registry-scaffold.js';
import { resolveGlobalSkillsRoot, resolveStateFilePath } from '../core/skills-layout.js';

interface BootstrapOptions {
    force?: boolean;
}

export function createBootstrapCommand(): Command {
    return new Command('bootstrap')
        .description('Populate ~/.xtrm/skills from running xt package payload')
        .option('--force', 'Re-copy global skills payload even when version matches', false)
        .action(async (opts: BootstrapOptions) => {
            try {
                const packageRoot = resolvePackageRoot();
                const pkgJson = await fs.readJson(path.join(packageRoot, 'package.json')) as { version?: string };
                const pkgVersion = pkgJson.version ?? '0.0.0';
                await logBootstrapTrigger({ command: 'bootstrap', cwd: process.cwd(), pkgVersion });

                const result = await ensureGlobalSkillsBootstrapped(packageRoot, opts.force ? { force: true } : {});
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
