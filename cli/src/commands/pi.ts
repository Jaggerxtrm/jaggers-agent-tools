import { Command } from 'commander';
import kleur from 'kleur';
import path from 'path';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import fs from 'fs-extra';
import { findRepoRoot } from '../utils/repo-root.js';
import { t } from '../utils/theme.js';
import { runPiInstall } from './pi-install.js';
import {
    ensureCorePackageSymlink,
    inventoryPiRuntime,
    remediateStalePiMcpAdapterOverride,
    resolveManagedPiCoreSourceDir,
    resolveManagedPiExtensionsSourceDir,
} from '../core/pi-runtime.js';
import { createInstallPiCommand } from './install-pi.js';
import { launchWorktreeSession } from '../utils/worktree-session.js';
import { confirmDestructiveAction } from '../utils/confirmation.js';

const PI_AGENT_DIR = process.env.PI_AGENT_DIR || path.join(homedir(), '.pi', 'agent');
const RETIRED_PI_COMMANDS = new Set(['install']);
const RETIRED_PI_INSTALL_REDIRECT = 'xt pi install is retired — run: xt update --apply --repo <path> (planned removal: v0.13.0)';

interface PiProjectPointer {
    hasProjectSettings: boolean;
    hasProjectExtensionPackage: boolean;
    pointsToXtrmExtensions: boolean;
}

function resolveProjectRoot(): string {
    const gitResult = spawnSync('git', ['rev-parse', '--show-toplevel'], {
        cwd: process.cwd(), encoding: 'utf8', stdio: 'pipe',
    });
    return gitResult.status === 0 ? (gitResult.stdout ?? '').trim() : process.cwd();
}

function hasSettingsEntry(entries: unknown, expectedEntry: string): boolean {
    if (!Array.isArray(entries)) return false;
    return entries.some((entry) => {
        if (typeof entry !== 'string') return false;
        return entry.replace(/\\/g, '/') === expectedEntry;
    });
}

async function getPiProjectPointer(projectRoot: string): Promise<PiProjectPointer> {
    const settingsPath = path.join(projectRoot, '.pi', 'settings.json');
    const hasSettingsFile = await fs.pathExists(settingsPath);

    if (!hasSettingsFile) {
        return { hasProjectSettings: false, hasProjectExtensionPackage: false, pointsToXtrmExtensions: false };
    }

    try {
        const settings = await fs.readJson(settingsPath) as { extensions?: unknown; packages?: unknown };
        const packageEntries = Array.isArray(settings.packages)
            ? settings.packages.filter((entry): entry is string => typeof entry === 'string')
            : [];

        return {
            hasProjectSettings: true,
            hasProjectExtensionPackage: packageEntries.includes('npm:@jaggerxtrm/pi-extensions'),
            pointsToXtrmExtensions: hasSettingsEntry(settings.extensions, '../.xtrm/extensions'),
        };
    } catch {
        return { hasProjectSettings: true, hasProjectExtensionPackage: false, pointsToXtrmExtensions: false };
    }
}

export function createPiCommand(): Command {
    const cmd = new Command('pi')
        .description('Launch a Pi session in a sandboxed worktree, or manage the Pi runtime')
        .argument('[name]', 'Optional session name — used as xt/<name> branch (random if omitted)')
        .option('--role <name>', 'Launch pi as a specialist role (resolved via `sp view <name>`); creates a named tmux session with @agent_task metadata')
        .option('--bead <id>', 'Render the tracked task as the initial user prompt and retain the id via @agent_bead/session slug (mutually exclusive with --prompt)')
        .option('--prompt <text>', 'Use <text> as the initial user prompt (mutually exclusive with --bead)')
        .option('--no-attach', 'Create tmux session detached; print `session_name:pane_id` on stdout and exit (default: attach)')
        .option('--model <name>', 'Forward `--model <name>` to pi; with --role, overrides specialist.execution.model')
        .option('--thinking <level>', 'Forward `--thinking <level>` to pi; with --role, overrides specialist.execution.thinking_level')
        .option('--skill <name-or-path>', 'Load an additional skill at startup (repeatable)', (value: string, previous: string[]) => [...previous, value], [])
        .option('--new-session', 'Inside $TMUX: force a fresh tmux session instead of running in the current pane (default outside $TMUX)')
        .option('--ns', 'Alias for --new-session')
        .option('--parent <target>', 'With --role: override @agent_parent_session on the target pane (target = tmux session name, id, or #{session_id})')
        .option('--child', 'With --role: explicit form of the auto-behavior — @agent_parent_session = current pane\'s session_id')
        .option('--reuse', 'With --role + --new-session (or outside $TMUX): if a session named role-<slug>[-<bead>] already exists, attach to it instead of auto-suffixing a fresh one')
        .allowExcessArguments(true)
        .allowUnknownOption(true)
        .addHelpText('after', `
Passthrough (requires --role):
  Everything after \`--\` is forwarded verbatim to the pi runtime. xt-owned
  flags (--session-dir, --name, --system-prompt, --append-system-prompt,
  --skill) are rejected; batch-mode flags (--print, --list-models, --export,
  --mode) are dropped with a warning.

Examples:
  $ xt pi demo --no-attach --prompt 'inspect the failing build' --model openai-codex/gpt-5.6-luna
  $ xt pi --role researcher --bead xyz -- --gitnexus-cmd 'foo bar'
  $ xt pi --role chain-coordinator --model openai-codex/gpt-5.4 -- --thinking medium
  $ xt pi --role reviewer --prompt 'review the auth changes in cli/src/auth/'
  $ xt pi --role planner                          # skills-only prime; pane idles
`)
        .action(async (name: string | undefined, opts: {
            role?: string;
            bead?: string;
            prompt?: string;
            attach?: boolean;
            model?: string;
            thinking?: string;
            skill?: string[];
            newSession?: boolean;
            ns?: boolean;
            parent?: string;
            child?: boolean;
            reuse?: boolean;
        }) => {
            // Everything after `--` is forwarded verbatim to pi (with guards
            // enforced in the launcher). This is the primary escape hatch for
            // any pi flag not first-classed here.
            const dashIdx = process.argv.indexOf('--');
            const passthrough = dashIdx >= 0 ? process.argv.slice(dashIdx + 1) : [];
            await launchWorktreeSession({
                runtime: 'pi',
                name,
                role: opts.role,
                bead: opts.bead,
                prompt: opts.prompt,
                attach: opts.attach,
                model: opts.model,
                thinking: opts.thinking,
                skills: opts.skill,
                newSession: Boolean(opts.newSession || opts.ns),
                parent: opts.parent,
                child: Boolean(opts.child),
                reuse: Boolean(opts.reuse),
                passthrough,
            });
        });

    for (const commandName of RETIRED_PI_COMMANDS) {
        const tombstone = new Command(commandName)
            .description('Retired maintenance token; use xt update --apply (planned removal: v0.13.0)')
            .helpOption(false)
            .allowUnknownOption(true)
            .allowExcessArguments(true)
            .action(() => {
                console.error(RETIRED_PI_INSTALL_REDIRECT);
                process.exitCode = 1;
            });
        cmd.addCommand(tombstone, { hidden: true });
    }

    // 'setup' = interactive first-time API key + OAuth config
    const piSetup = createInstallPiCommand();
    piSetup.name('setup');
    piSetup.description('Configure Pi credentials and complete first-time setup');
    cmd.addCommand(piSetup);

    cmd.command('status')
        .description('Check Pi version and extension deployment drift')
        .action(async () => {
            console.log(t.bold('\n  Pi Runtime Status\n'));

            const piResult = spawnSync('pi', ['--version'], { encoding: 'utf8', stdio: 'pipe' });
            if (piResult.status === 0) {
                console.log(t.success(`  ✓ pi ${piResult.stdout.trim()} installed`));
            } else {
                console.log(kleur.red('  ✗ pi not found — run: xt pi setup'));
                console.log('');
                return;
            }

            const projectRoot = resolveProjectRoot();
            const pointer = await getPiProjectPointer(projectRoot);

            const bundleRoot = await findRepoRoot();
            const sourceDir = resolveManagedPiExtensionsSourceDir(bundleRoot);
            const globalTargetDir = path.join(PI_AGENT_DIR, 'extensions');

            if (!sourceDir || !await fs.pathExists(sourceDir)) {
                console.log(kleur.dim('  ○ managed extensions not bundled in this install\n'));
                return;
            }

            const plan = await inventoryPiRuntime(sourceDir, globalTargetDir);
            const pkgOk = plan.packages.filter(s => s.installed).length;
            const projectScoped = pointer.hasProjectExtensionPackage || pointer.pointsToXtrmExtensions;

            if (projectScoped) {
                console.log(kleur.dim('  Scope:      project'));
                console.log(kleur.dim(`  Extensions: package mode (npm:@jaggerxtrm/pi-extensions${pointer.hasProjectExtensionPackage ? '' : ' missing'})`));
            } else {
                console.log(kleur.dim('  Scope:      global'));
                const extOk = plan.extensions.filter(s => s.installed && !s.stale).length;
                console.log(kleur.dim(`  Extensions: ${extOk}/${plan.extensions.length} up-to-date`));
            }

            console.log(kleur.dim(`  Packages:   ${pkgOk}/${plan.packages.length} installed`));

            if (plan.missingPackages.length > 0) {
                const names = plan.missingPackages.map(s => s.pkg.displayName).join(', ');
                console.log(kleur.yellow(`  Packages:   ${names}`));
            }

            if (!projectScoped) {
                if (plan.missingExtensions.length > 0) {
                    const names = plan.missingExtensions.map(s => s.ext.displayName).join(', ');
                    console.log(kleur.yellow(`  Missing:    ${names}`));
                }
                if (plan.staleExtensions.length > 0) {
                    const names = plan.staleExtensions.map(s => s.ext.displayName).join(', ');
                    console.log(kleur.yellow(`  Stale:      ${names}`));
                }
                if (plan.orphanedExtensions.length > 0) {
                    console.log(kleur.red(`  Orphaned:   ${plan.orphanedExtensions.join(', ')}`));
                }
            }

            const hasProjectSettingsDrift = !pointer.hasProjectSettings || !pointer.hasProjectExtensionPackage;
            const hasGlobalDrift = !projectScoped && !plan.allPresent;
            const hasPackageDrift = plan.missingPackages.length > 0;

            if (!hasProjectSettingsDrift && !hasGlobalDrift && !hasPackageDrift) {
                console.log(t.success('\n  ✓ Pi runtime configuration looks healthy\n'));
                return;
            }

            if (hasProjectSettingsDrift) {
                console.log(kleur.yellow('  Settings:   .pi/settings.json missing managed npm:@jaggerxtrm/pi-extensions entry'));
            }

            console.log(kleur.dim('\n  → run: xt update --apply --repo <path>\n'));
        });

    cmd.command('doctor')
        .description('[deprecated] Use xt doctor for runtime diagnosis (planned removal: v0.13.0)')
        .action(async () => {
            console.error('xt pi doctor is deprecated — use: xt doctor (planned removal: v0.13.0)');
            console.log(t.bold('\n  Pi Doctor\n'));

            let allOk = true;

            const piResult = spawnSync('pi', ['--version'], { encoding: 'utf8', stdio: 'pipe' });
            if (piResult.status === 0) {
                console.log(t.success(`  ✓ pi ${piResult.stdout.trim()} installed`));
            } else {
                console.log(kleur.red('  ✗ pi not found — run: xt pi setup'));
                allOk = false;
            }

            const pnpmResult = spawnSync('pnpm', ['--version'], { encoding: 'utf8', stdio: 'pipe' });
            if (pnpmResult.status === 0) {
                console.log(t.success(`  ✓ pnpm ${pnpmResult.stdout.trim()} installed`));
            } else {
                console.log(kleur.yellow('  ⚠ pnpm not found'));
                allOk = false;
            }

            const configFiles = ['models.json', 'auth.json', 'settings.json'];
            const missingConfig = configFiles.filter(f => !fs.existsSync(path.join(PI_AGENT_DIR, f)));
            if (missingConfig.length === 0) {
                console.log(t.success('  ✓ config files present'));
            } else {
                console.log(kleur.yellow(`  ⚠ missing config: ${missingConfig.join(', ')}`));
                allOk = false;
            }

            const projectRoot = resolveProjectRoot();
            const pointer = await getPiProjectPointer(projectRoot);
            const bundleRoot = await findRepoRoot();
            const sourceDir = resolveManagedPiExtensionsSourceDir(bundleRoot);
            const coreSourceDir = resolveManagedPiCoreSourceDir(bundleRoot);
            const globalTargetDir = path.join(PI_AGENT_DIR, 'extensions');

            try {
                const staleOverride = await remediateStalePiMcpAdapterOverride(false);
                if (staleOverride.stale && staleOverride.remediated) {
                    console.log(t.success('  ✓ removed stale ~/.pi/agent/extensions/pi-mcp-adapter override'));
                } else if (staleOverride.stale) {
                    console.log(kleur.yellow('  ⚠ stale ~/.pi/agent/extensions/pi-mcp-adapter override detected'));
                    allOk = false;
                } else {
                    console.log(t.success('  ✓ pi-mcp-adapter override check passed'));
                }
            } catch (error) {
                console.log(kleur.yellow(`  ⚠ failed to remediate pi-mcp-adapter override: ${error}`));
                allOk = false;
            }

            try {
                const coreStatus = coreSourceDir
                    ? await ensureCorePackageSymlink(coreSourceDir, projectRoot, false)
                    : 'missing-source';
                if (coreStatus === 'repaired' || coreStatus === 'created') {
                    console.log(t.success('  ✓ repaired .xtrm/extensions/node_modules/@xtrm/pi-core symlink'));
                } else if (coreStatus === 'ok') {
                    console.log(t.success('  ✓ @xtrm/pi-core symlink is healthy'));
                } else if (coreStatus === 'missing-source') {
                    console.log(kleur.dim('  ○ @xtrm/pi-core source not bundled in this install'));
                }
            } catch (error) {
                console.log(kleur.yellow(`  ⚠ failed to ensure @xtrm/pi-core symlink: ${error}`));
                allOk = false;
            }

            if (!sourceDir || !await fs.pathExists(sourceDir)) {
                console.log(kleur.dim('  ○ managed extensions not bundled in this install'));
            } else {
                const plan = await inventoryPiRuntime(sourceDir, globalTargetDir);

                const projectScoped = pointer.hasProjectExtensionPackage || pointer.pointsToXtrmExtensions;
                if (!pointer.hasProjectSettings) {
                    console.log(kleur.yellow('  ⚠ missing .pi/settings.json; run xt pi reload to bootstrap project Pi settings'));
                    allOk = false;
                } else if (projectScoped) {
                    if (pointer.hasProjectExtensionPackage) {
                        console.log(t.success('  ✓ project runtime uses npm:@jaggerxtrm/pi-extensions'));
                    } else {
                        console.log(kleur.yellow('  ⚠ legacy project extension pointer detected; run xt pi reload to migrate'));
                        allOk = false;
                    }
                } else if (plan.missingExtensions.length === 0 && plan.staleExtensions.length === 0 && plan.orphanedExtensions.length === 0) {
                    console.log(t.success(`  ✓ global extensions deployed (${plan.extensions.length})`));
                } else {
                    if (plan.missingExtensions.length > 0 || plan.staleExtensions.length > 0) {
                        console.log(kleur.yellow(`  ⚠ extension drift (${plan.missingExtensions.length} missing, ${plan.staleExtensions.length} stale)`));
                        allOk = false;
                    }
                    if (plan.orphanedExtensions.length > 0) {
                        console.log(kleur.red(`  ✗ orphaned extensions: ${plan.orphanedExtensions.join(', ')}`));
                        allOk = false;
                    }
                }

                if (plan.missingPackages.length === 0) {
                    console.log(t.success(`  ✓ packages installed (${plan.packages.length})`));
                } else {
                    console.log(kleur.yellow(`  ⚠ ${plan.missingPackages.length} package(s) missing`));
                    allOk = false;
                }
            }

            console.log('');
            if (allOk) {
                console.log(t.boldGreen('  ✓ All checks passed\n'));
            } else {
                console.log(kleur.yellow('  ⚠ Some checks failed — run: xt pi reload\n'));
            }
        });

    cmd.command('reload')
        .description('[deprecated] Re-sync Pi runtime; use xt update --apply --repo <path> (planned removal: v0.13.0)')
        .option('-y, --yes', 'Skip confirmation prompt', false)
        .action(async (opts: { yes: boolean }) => {
            console.error('xt pi reload is deprecated — use: xt update --apply --repo <path> (planned removal: v0.13.0)');
            const confirmed = await confirmDestructiveAction({
                yes: opts.yes,
                message: 'Re-sync Pi runtime and remove orphaned extensions?',
                initial: true,
            });
            if (!confirmed) {
                console.log(kleur.dim('  Cancelled\n'));
                return;
            }

            await runPiInstall(false, false, resolveProjectRoot());
        });

    return cmd;
}
