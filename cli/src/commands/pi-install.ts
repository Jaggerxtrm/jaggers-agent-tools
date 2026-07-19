/**
 * Non-interactive Pi install command.
 *
 * Used by `xt init` and `xt update --apply` for non-interactive runtime maintenance.
 * Delegates to the unified pi-runtime service.
 *
 * @see cli/src/core/pi-runtime.ts
 */

import kleur from 'kleur';
import path from 'path';
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { t } from '../utils/theme.js';
import { runPiRuntimeSync } from '../core/pi-runtime.js';
import { isPiInstalled, isPnpmInstalled } from '../core/machine-bootstrap.js';

const PI_AGENT_DIR = process.env.PI_AGENT_DIR || path.join(homedir(), '.pi', 'agent');

function ensurePnpm(dryRun: boolean): void {
    if (isPnpmInstalled()) {
        const v = spawnSync('pnpm', ['--version'], { encoding: 'utf8', stdio: 'pipe' });
        console.log(t.success(`  ✓ pnpm ${v.stdout.trim()} already installed`));
        return;
    }
    console.log(kleur.yellow('  pnpm not found — installing via npm...'));
    if (dryRun) {
        console.log(kleur.dim('  [DRY RUN] npm install -g pnpm'));
        return;
    }
    const r = spawnSync('npm', ['install', '-g', 'pnpm'], { stdio: 'inherit' });
    if (r.status !== 0) {
        console.log(kleur.yellow('  ⚠ Failed to install pnpm. Run: npm install -g pnpm'));
    } else {
        console.log(t.success('  ✓ pnpm installed'));
    }
}

/**
 * Non-interactive Pi install: syncs Pi runtime packages/extensions.
 * Used by `xt init` and `xt update --apply`.
 *
 * @param isGlobal - When true, installs to global Pi dirs (~/.pi/agent/). Default false = project-scoped.
 * @param projectRoot - Project root for project-scoped installs. Defaults to git root.
 */
export async function runPiInstall(dryRun: boolean = false, isGlobal: boolean = false, projectRoot?: string): Promise<void> {
    if (!projectRoot) {
        const r = spawnSync('git', ['rev-parse', '--show-toplevel'], {
            cwd: process.cwd(), encoding: 'utf8', stdio: 'pipe',
        });
        projectRoot = r.status === 0 ? (r.stdout ?? '').trim() : process.cwd();
    }

    console.log(t.bold('\n  ⚙  Pi extensions + packages'));

    // Ensure pi and pnpm are installed
    if (!isPiInstalled()) {
        console.log(kleur.yellow('  pi not found — installing oh-pi globally...'));
        if (!dryRun) {
            const r = spawnSync('npm', ['install', '-g', 'oh-pi'], { stdio: 'inherit' });
            if (r.status !== 0) {
                console.error(kleur.red('  ✗ Failed to install oh-pi. Run: npm install -g oh-pi\n'));
                return;
            }
        } else {
            console.log(kleur.dim('  [DRY RUN] npm install -g oh-pi'));
        }
        console.log(t.success('  ✓ pi installed'));
    } else {
        const v = spawnSync('pi', ['--version'], { encoding: 'utf8' });
        console.log(t.success(`  ✓ pi ${v.stdout.trim()} already installed`));
    }

    ensurePnpm(dryRun);

    // Run unified sync
    await runPiRuntimeSync({ dryRun, isGlobal, projectRoot });

    // Seed sane per-package defaults (idempotent — skips if user already has one)
    seedGitnexusDefaults(dryRun);

    // Detect unconfigured Pi — nudge to run setup
    const configFiles = ['models.json', 'auth.json', 'settings.json'];
    const missingConfig = configFiles.filter(f => !require('fs').existsSync(path.join(PI_AGENT_DIR, f)));
    if (missingConfig.length > 0) {
        console.log(kleur.yellow(`\n  ⚠ Pi is not fully configured (missing: ${missingConfig.join(', ')})`));
        console.log(kleur.yellow('    Run: xt pi setup   to complete first-time configuration'));
        console.log(kleur.dim('    (API keys, model defaults, OAuth providers)\n'));
    } else {
        console.log('');
    }
}

/**
 * Seed ~/.pi/pi-gitnexus.json with sane defaults on fresh installs.
 *
 * pi-gitnexus loads this file at session start; if absent, autoAugment defaults
 * ON, running up to 3 `gitnexus augment` subprocesses after every grep/read/bash
 * tool result — the dominant per-tool latency source on navigation-heavy
 * sessions. auto-augment off by default; on-demand MCP tools
 * (query/context/impact/detect_changes) remain available per AGENTS.md.
 *
 * Only writes when the file is absent — never clobbers user customisation.
 * (xtrm-e2vkn)
 */
function seedGitnexusDefaults(dryRun: boolean): void {
    const cfgPath = path.join(homedir(), '.pi', 'pi-gitnexus.json');
    if (existsSync(cfgPath)) return;
    if (dryRun) {
        console.log(kleur.dim(`  [DRY RUN] seed ${cfgPath} { autoAugment: false }`));
        return;
    }
    try {
        writeFileSync(cfgPath, `${JSON.stringify({ autoAugment: false }, null, 2)}\n`);
        console.log(kleur.dim(`  seeded ${cfgPath} (autoAugment: false)`));
    } catch {
        // non-fatal — pi-gitnexus will simply use its built-in default
    }
}
