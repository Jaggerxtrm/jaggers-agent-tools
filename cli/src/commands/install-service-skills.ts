import { Command } from 'commander';
import kleur from 'kleur';
import path from 'path';
import fs from 'fs-extra';
import { spawnSync } from 'child_process';

// CJS: __dirname = cli/dist/ — two levels up = package root
declare const __dirname: string;
const PKG_ROOT = path.resolve(__dirname, '../..');
const SKILLS_SRC = path.join(PKG_ROOT, 'project-skills', 'service-skills-set', '.claude');

const TRINITY = [
    'creating-service-skills',
    'using-service-skills',
    'updating-service-skills',
    'scoping-service-skills',
];

const SETTINGS_HOOKS: Record<string, unknown[]> = {
    SessionStart: [
        {
            hooks: [{
                type: 'command',
                command: 'python3 "$CLAUDE_PROJECT_DIR/.claude/skills/using-service-skills/scripts/cataloger.py"',
            }],
        },
    ],
    PreToolUse: [
        {
            matcher: 'Read|Write|Edit|Glob|Grep|Bash',
            hooks: [{
                type: 'command',
                command: 'python3 "$CLAUDE_PROJECT_DIR/.claude/skills/using-service-skills/scripts/skill_activator.py"',
            }],
        },
    ],
    PostToolUse: [
        {
            matcher: 'Write|Edit',
            hooks: [{
                type: 'command',
                command: 'python3 "$CLAUDE_PROJECT_DIR/.claude/skills/updating-service-skills/scripts/drift_detector.py" check-hook',
                timeout: 10,
            }],
        },
    ],
};

const MARKER_DOC = '# [jaggers] doc-reminder';
const MARKER_STALENESS = '# [jaggers] skill-staleness';

// ─── Pure functions (exported for testing) ───────────────────────────────────

export function mergeSettingsHooks(existing: Record<string, unknown>): {
    result: Record<string, unknown>;
    added: string[];
    skipped: string[];
} {
    const result = { ...existing };
    const hooks = (result.hooks ?? {}) as Record<string, unknown>;
    result.hooks = hooks;

    const added: string[] = [];
    const skipped: string[] = [];

    for (const [event, config] of Object.entries(SETTINGS_HOOKS)) {
        if (event in hooks) {
            skipped.push(event);
        } else {
            hooks[event] = config;
            added.push(event);
        }
    }

    return { result, added, skipped };
}

export async function installSkills(projectRoot: string, skillsSrc: string = SKILLS_SRC): Promise<{ skill: string; status: 'installed' | 'updated' }[]> {
    const results: { skill: string; status: 'installed' | 'updated' }[] = [];
    for (const skill of TRINITY) {
        const src = path.join(skillsSrc, skill);
        const dest = path.join(projectRoot, '.claude', 'skills', skill);
        const existed = await fs.pathExists(dest);
        if (existed) {
            await fs.remove(dest);
        }
        await fs.copy(src, dest, {
            filter: (src: string) => !src.includes('.Zone.Identifier'),
        });
        results.push({ skill, status: existed ? 'updated' : 'installed' });
    }
    return results;
}

export async function installGitHooks(projectRoot: string, skillsSrc: string = SKILLS_SRC): Promise<{
    hookFiles: { name: string; status: 'added' | 'already-present' }[];
}> {
    // Copy git-hook scripts into target project (no back-reference to jaggers package path)
    const gitHooksSrc = path.join(skillsSrc, 'git-hooks');
    const gitHooksDest = path.join(projectRoot, '.claude', 'git-hooks');
    await fs.copy(gitHooksSrc, gitHooksDest, { overwrite: true });

    const docScript = path.join(projectRoot, '.claude', 'git-hooks', 'doc_reminder.py');
    const stalenessScript = path.join(projectRoot, '.claude', 'git-hooks', 'skill_staleness.py');

    const preCommit = path.join(projectRoot, '.githooks', 'pre-commit');
    const prePush = path.join(projectRoot, '.githooks', 'pre-push');

    for (const hookPath of [preCommit, prePush]) {
        if (!await fs.pathExists(hookPath)) {
            await fs.mkdirp(path.dirname(hookPath));
            await fs.writeFile(hookPath, '#!/usr/bin/env bash\n', { mode: 0o755 });
        }
    }

    const snippets: [string, string, string][] = [
        [
            preCommit,
            MARKER_DOC,
            `\n${MARKER_DOC}\nif command -v python3 &>/dev/null && [ -f "${docScript}" ]; then\n    python3 "${docScript}" || true\nfi\n`,
        ],
        [
            prePush,
            MARKER_STALENESS,
            `\n${MARKER_STALENESS}\nif command -v python3 &>/dev/null && [ -f "${stalenessScript}" ]; then\n    python3 "${stalenessScript}" || true\nfi\n`,
        ],
    ];

    const hookFiles: { name: string; status: 'added' | 'already-present' }[] = [];
    let anyAdded = false;

    for (const [hookPath, marker, snippet] of snippets) {
        const content = await fs.readFile(hookPath, 'utf8');
        const name = path.basename(hookPath);
        if (!content.includes(marker)) {
            await fs.writeFile(hookPath, content + snippet);
            hookFiles.push({ name, status: 'added' });
            anyAdded = true;
        } else {
            hookFiles.push({ name, status: 'already-present' });
        }
    }

    if (anyAdded) {
        const gitHooksDir = path.join(projectRoot, '.git', 'hooks');
        await fs.mkdirp(gitHooksDir);
        for (const [src, name] of [[preCommit, 'pre-commit'], [prePush, 'pre-push']] as const) {
            if (await fs.pathExists(src)) {
                const dest = path.join(gitHooksDir, name);
                await fs.copy(src, dest, { overwrite: true });
                await fs.chmod(dest, 0o755);
            }
        }
    }

    return { hookFiles };
}

export async function installSettings(projectRoot: string): Promise<{ added: string[]; skipped: string[] }> {
    const settingsPath = path.join(projectRoot, '.claude', 'settings.json');
    await fs.mkdirp(path.dirname(settingsPath));

    let existing: Record<string, unknown> = {};
    if (await fs.pathExists(settingsPath)) {
        try {
            existing = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
        } catch {
            // malformed JSON — start fresh
        }
    }

    const { result, added, skipped } = mergeSettingsHooks(existing);
    await fs.writeFile(settingsPath, JSON.stringify(result, null, 2) + '\n');
    return { added, skipped };
}

export function getProjectRoot(pkgRoot: string): string {
    const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
        encoding: 'utf8',
        timeout: 5000,
    });
    if (result.status !== 0) {
        throw new Error('Not inside a git repository. Run this command from your target project directory.');
    }
    const root = path.resolve(result.stdout.trim());
    if (root === path.resolve(pkgRoot)) {
        throw new Error('Run this from inside your TARGET project, not the jaggers-agent-tools repo itself.');
    }
    return root;
}

export function createInstallServiceSkillsCommand(): Command {
    return new Command('install-service-skills')
        .description('Install the Service Skill Trinity into the current project')
        .action(async () => {
            let projectRoot: string;
            try {
                projectRoot = getProjectRoot(PKG_ROOT);
            } catch (err) {
                console.error(kleur.red(`\n✗ ${(err as Error).message}\n`));
                process.exit(1);
            }

            console.log(kleur.dim(`\n  Installing into: ${projectRoot}\n`));

            console.log(kleur.bold('── Skills ──────────────────────────────'));
            const skillResults = await installSkills(projectRoot);
            for (const { skill, status } of skillResults) {
                const icon = status === 'installed' ? kleur.green('  ✓') : kleur.yellow('  ↺');
                console.log(`${icon} .claude/skills/${skill}/`);
            }

            console.log(kleur.bold('\n── settings.json ───────────────────────'));
            const { added, skipped } = await installSettings(projectRoot);
            for (const event of added) {
                console.log(`${kleur.green('  ✓')} added hook: ${event}`);
            }
            for (const event of skipped) {
                console.log(`${kleur.yellow('  ○')} already present: ${event} (not overwritten)`);
            }

            console.log(kleur.bold('\n── Git hooks ───────────────────────────'));
            const { hookFiles } = await installGitHooks(projectRoot);
            for (const { name, status } of hookFiles) {
                if (status === 'added') {
                    console.log(`${kleur.green('  ✓')} .githooks/${name}`);
                } else {
                    console.log(`${kleur.yellow('  ○')} already installed: ${name}`);
                }
            }
            if (hookFiles.some(h => h.status === 'added')) {
                console.log(`${kleur.green('  ✓')} activated in .git/hooks/`);
            }
            console.log(`${kleur.green('  ✓')} scripts → .claude/git-hooks/`);

            console.log(kleur.green('\n  Done.'));
            console.log(kleur.dim('  Hooks active: SessionStart · PreToolUse · PostToolUse · pre-commit · pre-push\n'));
        });
}
