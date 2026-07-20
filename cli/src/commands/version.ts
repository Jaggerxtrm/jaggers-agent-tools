import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Command } from 'commander';
import kleur from 'kleur';

// __dirname is available in CJS output (tsup target: cjs). Matches
// the same pattern used at src/index.ts to resolve the shipped
// package.json.
declare const __dirname: string;

interface VersionInfo {
    package: string;
    version: string;
    commit: string | null;
    dirty: boolean | null;
    source: 'npm' | 'local';
    built_at: string | null;
    runtime: {
        node: string;
    };
}

function readInstallPackageJson(): { name: string; version: string; root: string } {
    // In built layout: __dirname = <install>/xtrm-tools/cli/dist
    // Root package.json ships with the tarball at <install>/xtrm-tools/package.json.
    // cli/package.json (workspace) sits at <install>/xtrm-tools/cli/package.json.
    // Prefer root so `package` matches the npm-published name.
    const candidates = [
        resolve(__dirname, '..', '..', 'package.json'),
        resolve(__dirname, '..', 'package.json'),
    ];
    for (const candidate of candidates) {
        try {
            const parsed = JSON.parse(readFileSync(candidate, 'utf8'));
            if (parsed?.name && parsed?.version) {
                return { name: parsed.name, version: parsed.version, root: dirname(candidate) };
            }
        } catch {
            /* try next */
        }
    }
    return { name: 'xtrm-tools', version: '0.0.0', root: resolve(__dirname, '..', '..') };
}

function detectSource(installRoot: string): 'npm' | 'local' {
    return installRoot.split(sep).includes('node_modules') ? 'npm' : 'local';
}

function readGitCommit(installRoot: string): string | null {
    if (!existsSync(resolve(installRoot, '.git'))) return null;
    const result = spawnSync('git', ['rev-parse', 'HEAD'], {
        cwd: installRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (result.status !== 0) return null;
    return result.stdout.trim() || null;
}

function readGitDirty(installRoot: string): boolean | null {
    if (!existsSync(resolve(installRoot, '.git'))) return null;
    const result = spawnSync('git', ['status', '--porcelain'], {
        cwd: installRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (result.status !== 0) return null;
    return result.stdout.trim().length > 0;
}

function readBuiltAt(installRoot: string): string | null {
    // tsup doesn't emit a build-timestamp file today. Reserved for a
    // follow-up that adds a `define: { __BUILD_AT__: ... }` at build.
    // For now, best-effort: try `cli/dist/index.cjs` mtime.
    const distPath = resolve(installRoot, 'cli', 'dist', 'index.cjs');
    if (!existsSync(distPath)) return null;
    try {
        const stats = require('node:fs').statSync(distPath);
        return new Date(stats.mtime).toISOString();
    } catch {
        return null;
    }
}

export function collectVersionInfo(): VersionInfo {
    const pkg = readInstallPackageJson();
    return {
        package: pkg.name === 'xtrm-cli' ? 'xtrm-tools' : pkg.name,
        version: pkg.version,
        commit: readGitCommit(pkg.root),
        dirty: readGitDirty(pkg.root),
        source: detectSource(pkg.root),
        built_at: readBuiltAt(pkg.root),
        runtime: {
            node: process.versions.node,
        },
    };
}

function formatHuman(info: VersionInfo): string {
    const commitStr = info.commit ? info.commit.slice(0, 7) + (info.dirty ? '-dirty' : '') : 'unknown';
    return [
        `${kleur.bold(info.package)} ${info.version}`,
        `  commit:   ${commitStr}`,
        `  source:   ${info.source}`,
        `  built at: ${info.built_at ?? 'unknown'}`,
        `  runtime:  node ${info.runtime.node}`,
    ].join('\n');
}

export function createVersionCommand(): Command {
    return new Command('version')
        .description('Print xtrm-tools build identity (package, version, commit, source, node runtime)')
        .option('--json', 'Emit machine-readable JSON', false)
        .action((opts: { json?: boolean }) => {
            const info = collectVersionInfo();
            if (opts.json) {
                process.stdout.write(JSON.stringify(info) + '\n');
            } else {
                process.stdout.write(formatHuman(info) + '\n');
            }
        });
}
