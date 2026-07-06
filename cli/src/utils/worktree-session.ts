import kleur from 'kleur';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, unlinkSync, lstatSync, readlinkSync, rmSync } from 'node:fs';

import { ensureAgentsSkillsSymlink } from '../core/skills-scaffold.js';
import { runPiLaunchPreflight } from '../core/pi-runtime.js';

export interface WorktreeSessionOptions {
    runtime: 'claude' | 'pi';
    name?: string;
    role?: string;
    bead?: string;
    attach?: boolean;
}

export interface ResolvedRole {
    name: string;
    systemPrompt: string;
    skillPaths: string[];
}

// Exposed for unit testing. sp view <name> --raw is the source of truth for
// specialist resolution — do not reimplement its .specialists/user + installed
// package precedence here.
export function parseSpecialistJson(name: string, raw: string): ResolvedRole {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error(`sp view ${name} --raw did not return JSON`);
    }
    const spec = (parsed as { specialist?: Record<string, unknown> } | null)?.specialist;
    if (!spec || typeof spec !== 'object') {
        throw new Error(`role '${name}': missing 'specialist' key in sp output`);
    }
    const promptSection = (spec as { prompt?: unknown }).prompt as { system?: unknown } | undefined;
    const systemPrompt = promptSection?.system;
    if (typeof systemPrompt !== 'string' || !systemPrompt.trim()) {
        throw new Error(`role '${name}': specialist.prompt.system is empty`);
    }
    const skillsSection = (spec as { skills?: unknown }).skills as { paths?: unknown } | undefined;
    const rawPaths = skillsSection?.paths;
    const skillPaths = Array.isArray(rawPaths)
        ? rawPaths.filter((p): p is string => typeof p === 'string' && p.length > 0)
        : [];
    const mode = (spec as { system_prompt_mode?: unknown }).system_prompt_mode;
    if (mode === 'replace') {
        // Interactive pi must keep AGENTS.md + coding base. Warn and force append.
        process.stderr.write(kleur.yellow(
            `  ⚠ role '${name}': system_prompt_mode=replace ignored; forcing append\n`,
        ));
    }
    return { name, systemPrompt, skillPaths };
}

export function resolveRole(name: string): ResolvedRole {
    const r = spawnSync('sp', ['view', name, '--raw'], {
        encoding: 'utf8',
        stdio: 'pipe',
    });
    if (r.status !== 0) {
        const stderr = (r.stderr ?? '').trim() || 'unknown error';
        throw new Error(`role '${name}' not found via sp view (${stderr})`);
    }
    return parseSpecialistJson(name, r.stdout ?? '');
}

function slugifyForSession(input: string): string {
    const s = input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return s.slice(0, 32) || 'x';
}

function shellQuote(s: string): string {
    return `'${s.replace(/'/g, `'\\''`)}'`;
}

export interface RoleTmuxPlan {
    sessionName: string;
    piArgs: string[];
    piCmdString: string;
    paneOptions: Array<{ key: string; value: string }>;
}

// Pure — no I/O. Exported for unit testing.
export function buildRoleTmuxPlan(args: {
    role: ResolvedRole;
    bead?: string;
    parentSessionId: string;
    promptFile: string;
}): RoleTmuxPlan {
    const { role, bead, parentSessionId, promptFile } = args;
    const roleSlug = slugifyForSession(role.name);
    const sessionName = bead
        ? `role-${roleSlug}-${slugifyForSession(bead)}`
        : `role-${roleSlug}`;

    const piArgs = ['--append-system-prompt', promptFile];
    for (const skill of role.skillPaths) {
        piArgs.push('--skill', skill);
    }

    const piCmdString = ['pi', ...piArgs].map(shellQuote).join(' ');

    const paneOptions: Array<{ key: string; value: string }> = [
        { key: '@agent_parent_session', value: parentSessionId },
        { key: '@agent_task', value: `role:${role.name}` },
    ];
    if (bead) paneOptions.push({ key: '@agent_bead', value: bead });

    return { sessionName, piArgs, piCmdString, paneOptions };
}

function currentTmuxSessionId(): string {
    if (!process.env.TMUX) return '';
    const r = spawnSync('tmux', ['display-message', '-p', '-F', '#{session_id}'], {
        encoding: 'utf8',
        stdio: 'pipe',
    });
    return r.status === 0 ? (r.stdout ?? '').trim() : '';
}

function randomSlug(len: number = 4): string {
    return Math.random().toString(36).slice(2, 2 + len);
}

function gitRepoRoot(cwd: string): string | null {
    const r = spawnSync('git', ['rev-parse', '--show-toplevel'], {
        cwd, stdio: 'pipe', encoding: 'utf8',
    });
    return r.status === 0 ? (r.stdout ?? '').trim() : null;
}

function gitMainRepoRoot(cwd: string): string | null {
    const common = spawnSync('git', ['rev-parse', '--git-common-dir'], {
        cwd,
        stdio: 'pipe',
        encoding: 'utf8',
    });

    if (common.status !== 0) return null;

    const raw = (common.stdout ?? '').trim();
    if (!raw) return null;
    const commonDir = path.isAbsolute(raw) ? raw : path.resolve(cwd, raw);
    return commonDir.endsWith('/.git') || commonDir.endsWith('\\.git')
        ? path.dirname(commonDir)
        : commonDir;
}

function resolveStatuslineScript(worktreePath: string): string | null {
    const localStatusline = path.join(worktreePath, '.xtrm', 'hooks', 'statusline.mjs');
    if (existsSync(localStatusline)) return localStatusline;

    const repoStatusline = path.join(worktreePath, 'hooks', 'statusline.mjs');
    if (existsSync(repoStatusline)) return repoStatusline;

    return null;
}

function ensureWorktreeSpecialists(worktreePath: string, mainRepoPath: string): void {
    const worktreeSpecialistsRoot = path.join(worktreePath, '.specialists');
    mkdirSync(worktreeSpecialistsRoot, { recursive: true });

    const specialistDirs = ['default', 'user'] as const;
    for (const dirName of specialistDirs) {
        const sourceDir = path.join(mainRepoPath, '.specialists', dirName);
        if (!existsSync(sourceDir)) continue;

        const targetDir = path.join(worktreeSpecialistsRoot, dirName);
        const symlinkTarget = path.relative(path.dirname(targetDir), sourceDir);

        try {
            const existing = lstatSync(targetDir);
            if (existing.isSymbolicLink() && readlinkSync(targetDir) === symlinkTarget) {
                continue;
            }
            rmSync(targetDir, { recursive: true, force: true });
        } catch {
            // target does not exist
        }

        symlinkSync(symlinkTarget, targetDir, 'dir');
    }

    // Mask the dir->symlink swap from git: skip-worktree on tracked
    // .specialists/{default,user}/* paths so checkpoint commits don't capture
    // phantom deletions or stage the symlink itself with mode 120000.
    // Same merge-hazard pattern fixed for .beads in xtrm-cbjo — without this
    // a chain-branch squash-merge would wipe the parent's .specialists/user/
    // (see infra repo PR #39 for the equivalent .beads incident). xtrm-6jd2.
    markPathSkipWorktree(worktreePath, '.specialists/default');
    markPathSkipWorktree(worktreePath, '.specialists/user');
}

/**
 * Normalize the parent repo's `core.hooksPath` to an absolute path if it is
 * currently a relative `.beads/hooks` reference. Older bd installs stored a
 * relative path which would resolve against the worktree's cwd in a worktree
 * — i.e., against the (now-missing) worktree-local `.beads/hooks/`. The fix
 * is idempotent: only rewrites the exact relative `.beads/hooks` form, never
 * touches absolute paths, project-style `.githooks` chains, or unset values.
 *
 * No-op for the vast majority of repos surveyed 2026-05-12 — but cheap
 * insurance so a fresh-install on an older bd binary cannot resurface the
 * "hooks fire from missing path" failure mode after xtrm-cbjo lands.
 */
function normalizeParentHooksPath(mainRepoRoot: string): void {
    try {
        const result = spawnSync('git', ['-C', mainRepoRoot, 'config', '--get', 'core.hooksPath'], {
            stdio: 'pipe',
            encoding: 'utf8',
        });
        if (result.status !== 0) return;
        const current = (result.stdout ?? '').trim();
        if (!current) return;
        if (path.isAbsolute(current)) return;
        // Only rewrite the canonical bd default. Leave `.githooks` chains and
        // other project conventions alone — those are intentional.
        if (current !== '.beads/hooks' && current !== './.beads/hooks') return;
        const absolute = path.join(mainRepoRoot, '.beads', 'hooks');
        spawnSync('git', ['-C', mainRepoRoot, 'config', 'core.hooksPath', absolute], { stdio: 'pipe' });
    } catch {
        // non-fatal
    }
}

/**
 * Mark all tracked files under `<worktree>/<pathspec>` as skip-worktree so
 * that index/worktree differences for those paths do not surface in
 * `git status` or checkpoint diffs.
 *
 * Used for runtime-only directories that are either rm'd (`.beads`) or
 * dir->symlink-swapped (`.specialists/{default,user}`) inside a worktree
 * but should never be committed back to the chain branch — preventing the
 * `.beads`-style squash-merge wipe hazard (real incident: projects/infra
 * PR #39 for `.beads`; same shape applies to `.specialists/user/*`).
 */
function markPathSkipWorktree(worktreePath: string, pathspec: string): void {
    try {
        const trackedResult = spawnSync('git', ['-C', worktreePath, 'ls-files', '--', pathspec], {
            cwd: worktreePath,
            stdio: 'pipe',
            encoding: 'utf8',
        });
        if (trackedResult.status !== 0) return;

        const trackedPaths = (trackedResult.stdout ?? '')
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);
        if (trackedPaths.length === 0) return;

        spawnSync('git', ['-C', worktreePath, 'update-index', '--skip-worktree', '--', ...trackedPaths], {
            cwd: worktreePath,
            stdio: 'pipe',
            encoding: 'utf8',
        });
    } catch {
        // non-fatal
    }
}

export interface SessionMeta {
    runtime: 'claude' | 'pi';
    launchedAt: string;
}

// Write to .xtrm/ (gitignored) to prevent the file from ever being committed.
function sessionMetaPath(worktreePath: string): string {
    return path.join(worktreePath, '.xtrm', 'session-meta.json');
}

export function writeSessionMeta(worktreePath: string, runtime: 'claude' | 'pi'): void {
    try {
        const meta: SessionMeta = { runtime, launchedAt: new Date().toISOString() };
        const dest = sessionMetaPath(worktreePath);
        mkdirSync(path.dirname(dest), { recursive: true });
        writeFileSync(dest, JSON.stringify(meta, null, 2));
    } catch {
        // non-fatal
    }
}

export function readSessionMeta(worktreePath: string): SessionMeta | null {
    try {
        // Try new location first (.xtrm/session-meta.json), fall back to old root location.
        const newPath = sessionMetaPath(worktreePath);
        const oldPath = path.join(worktreePath, '.session-meta.json');
        const filePath = existsSync(newPath) ? newPath : oldPath;
        const raw = readFileSync(filePath, 'utf8');
        return JSON.parse(raw) as SessionMeta;
    } catch {
        return null;
    }
}

export function unregisterPluginsForWorktree(worktreePath: string): void {
    const localSettingsPath = path.join(worktreePath, '.claude', 'settings.local.json');

    try {
        if (existsSync(localSettingsPath)) {
            unlinkSync(localSettingsPath);
        }
    } catch {
        // non-fatal
    }
}

export async function launchWorktreeSession(opts: WorktreeSessionOptions): Promise<void> {
    const { runtime, name, role: roleName, bead, attach = true } = opts;
    const cwd = process.cwd();

    // Resolve role up-front so we fail fast on an unknown role name before
    // creating a worktree (which would otherwise leak on a bad --role typo).
    let resolvedRole: ResolvedRole | null = null;
    if (roleName) {
        if (runtime !== 'pi') {
            console.error(kleur.red('\n  ✗ --role is currently only supported for pi\n'));
            process.exit(1);
        }
        try {
            resolvedRole = resolveRole(roleName);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(kleur.red(`\n  ✗ ${msg}\n`));
            process.exit(1);
        }
    }

    // Use git to find both current checkout root and common/main repo root.
    const currentRepoRoot = gitRepoRoot(cwd);
    const mainRepoRoot = gitMainRepoRoot(cwd);
    if (!currentRepoRoot || !mainRepoRoot) {
        console.error(kleur.red('\n  ✗ Not inside a git repository\n'));
        process.exit(1);
    }

    // Guardrail: never create a worktree from inside another worktree.
    if (currentRepoRoot !== mainRepoRoot) {
        console.error(kleur.red('\n  ✗ Refusing to create nested worktree from inside an existing worktree.\n'));
        console.error(kleur.dim(`  current worktree: ${currentRepoRoot}`));
        console.error(kleur.dim(`  main repo root:  ${mainRepoRoot}`));
        console.error(kleur.dim('\n  Remediation:'));
        console.error(kleur.dim('    1) cd to the main repo checkout'));
        console.error(kleur.dim('    2) run xt claude|pi there (or use xt attach to resume this session)'));
        console.error(kleur.dim('    3) run xt worktree doctor to inspect stale/nested entries\n'));
        process.exit(1);
    }

    const cwdBasename = path.basename(mainRepoRoot);

    // Resolve slug — shared by both branch and worktree path so they're linked
    const slug = name ?? randomSlug(4);

    // Worktree path: inside repo under .xtrm/worktrees/
    const worktreeName = `${cwdBasename}-xt-${runtime}-${slug}`;
    const worktreePath = path.join(mainRepoRoot, '.xtrm', 'worktrees', worktreeName);

    // Branch name
    const branchName = `xt/${slug}`;

    console.log(kleur.bold(`\n  Launching ${runtime} session`));
    console.log(kleur.dim(`  worktree: ${worktreePath}`));
    console.log(kleur.dim(`  branch:   ${branchName}\n`));

    // Use bd worktree create — sets up git worktree + canonical .beads/redirect in one step.
    // Falls back to plain git worktree add if bd is unavailable or the project has no .beads/.
    if (existsSync(worktreePath)) {
        console.error(kleur.red('\n  ✗ Worktree path already exists. Refusing to reuse stale directory.\n'));
        console.error(kleur.dim(`  path: ${worktreePath}`));
        console.error(kleur.dim('\n  Remediation:'));
        console.error(kleur.dim('    xt worktree doctor'));
        console.error(kleur.dim('    xt worktree clean --orphans --yes\n'));
        process.exit(1);
    }

    const bdResult = spawnSync('bd', ['worktree', 'create', worktreePath, '--branch', branchName], {
        cwd: mainRepoRoot, stdio: 'inherit',
    });

    if (bdResult.error || bdResult.status !== 0) {
        // Fall back to plain git worktree add (bd not found or no .beads/ in project)
        if (bdResult.status !== 0 && !bdResult.error) {
            console.log(kleur.dim('  beads: no database found, creating worktree without redirect'));
        }
        const branchExists = spawnSync('git', ['rev-parse', '--verify', branchName], {
            cwd: mainRepoRoot, stdio: 'pipe',
        }).status === 0;

        const gitArgs = branchExists
            ? ['worktree', 'add', worktreePath, branchName]
            : ['worktree', 'add', '-b', branchName, worktreePath];

        const gitResult = spawnSync('git', gitArgs, { cwd: mainRepoRoot, stdio: 'inherit' });
        if (gitResult.status !== 0) {
            console.error(kleur.red(`\n  ✗ Failed to create worktree at ${worktreePath}\n`));
            process.exit(1);
        }
    }

    // Normalize parent's core.hooksPath to absolute if it's still the bd
    // relative default — safety net for older bd installs (see xtrm-2s44).
    normalizeParentHooksPath(mainRepoRoot);

    // Remove worktree-local .beads/ entirely. bd inside the worktree resolves
    // its DB via git common-dir discovery (shared-server mode + absolute
    // core.hooksPath at the parent's .beads/hooks/), so no on-disk .beads/ is
    // needed. The previous dir->symlink approach made bd happy but caused a
    // serious merge hazard: any commit/PR carrying the .beads symlink (mode
    // 120000) wipes the parent's .beads/ on squash-merge (see infra repo PR
    // #39, 2026-05-12). With the directory gone, the tracked .beads/* paths
    // are masked via skip-worktree so the index/worktree delta does not
    // surface in `git status` or checkpoint diffs.
    // See xtrm-cbjo (this fix) supersedes xtrm-as7d / xtrm-nsca / unitAI-u08e8.
    try {
        rmSync(path.join(worktreePath, '.beads'), { recursive: true, force: true });
        markPathSkipWorktree(worktreePath, '.beads');
    } catch {
        // Non-fatal: bd will recover via git common-dir resolution regardless.
    }

    writeSessionMeta(worktreePath, runtime);
    console.log(kleur.green(`\n  ✓ Worktree ready — launching ${runtime}...\n`));
    console.log(kleur.dim('  note: clean git worktrees do not include ignored dependency dirs like node_modules/ or .venv/'));
    console.log(kleur.dim('        if lint/tests need them, run this repo\'s normal bootstrap inside the worktree (make bootstrap, just setup, npm ci, uv sync, etc.)\n'));

    // Pi runtime bootstrap is handled globally. Project dependency setup is still repo-owned.
    // - Extensions: globally linked (~/.pi/agent/extensions/ → repo)
    // - Packages: installed globally at ~/.pi/agent/npm/
    // Worktree inherits both from global locations.

    // Claude worktree: symlink gitignored dirs so the session has the same
    // environment as the main repo and wire local statusLine to .xtrm hooks.
    if (runtime === 'claude') {
        const claudeDir = path.join(worktreePath, '.claude');

        // 1. Rebuild generated runtime skills view and pointer inside the worktree.
        try {
            await ensureAgentsSkillsSymlink(worktreePath);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.log(kleur.dim(`  warning: could not rebuild active Claude skills view (${message})`));

            // Best-effort fallback symlink if rebuild fails.
            const wtSkillsDir = path.join(claudeDir, 'skills');
            const claudeSkillsTarget = path.join('..', '.xtrm', 'skills', 'active');
            try {
                const existing = lstatSync(wtSkillsDir);
                if (!existing.isSymbolicLink() || readlinkSync(wtSkillsDir) !== claudeSkillsTarget) {
                    rmSync(wtSkillsDir, { recursive: true, force: true });
                    mkdirSync(claudeDir, { recursive: true });
                    symlinkSync(claudeSkillsTarget, wtSkillsDir);
                }
            } catch {
                try {
                    mkdirSync(claudeDir, { recursive: true });
                    symlinkSync(claudeSkillsTarget, wtSkillsDir);
                } catch { /* non-fatal */ }
            }
        }

        // 2. Symlink specialist definition directories into the worktree so
        //    SpecialistLoader can resolve .specialists/default|user from cwd.
        try {
            ensureWorktreeSpecialists(worktreePath, mainRepoRoot);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.log(kleur.dim(`  warning: could not provision specialist definitions (${message})`));
        }

        // 3. Write settings.local.json with statusLine bound to this worktree's
        //    hook script path so runtime UI stays available in sandbox sessions.
        const localSettings: Record<string, unknown> = {};
        const statuslinePath = resolveStatuslineScript(worktreePath);
        if (statuslinePath) {
            localSettings.statusLine = {
                type: 'command',
                command: `node ${JSON.stringify(statuslinePath)}`,
                padding: 1,
            };
        }

        const localSettingsPath = path.join(claudeDir, 'settings.local.json');
        if (Object.keys(localSettings).length > 0) {
            try {
                mkdirSync(claudeDir, { recursive: true });
                writeFileSync(localSettingsPath, JSON.stringify(localSettings, null, 2));
            } catch { /* non-fatal */ }
        }
    }

    if (runtime === 'pi') {
        await runPiLaunchPreflight(worktreePath, false);
    }

    // Role mode: launch pi inside a named tmux session with agent metadata
    // set on the pane. --no-attach → print `session:pane` to stdout for
    // orchestrator capture. All chatter above went to console.log — headless
    // callers should capture stdout only after seeing that final line.
    if (resolvedRole) {
        await launchRoleTmuxSession({
            role: resolvedRole,
            bead,
            attach,
            worktreePath,
        });
        return; // launchRoleTmuxSession never returns (calls process.exit)
    }

    // Launch the runtime in the worktree
    const runtimeCmd = runtime === 'claude' ? 'claude' : 'pi';
    const runtimeArgs = runtime === 'claude' ? ['--dangerously-skip-permissions'] : [];
    const launchResult = spawnSync(runtimeCmd, runtimeArgs, {
        cwd: worktreePath,
        stdio: 'inherit',
    });

    process.exit(launchResult.status ?? 0);
}

async function launchRoleTmuxSession(args: {
    role: ResolvedRole;
    bead?: string;
    attach: boolean;
    worktreePath: string;
}): Promise<never> {
    const { role, bead, attach, worktreePath } = args;

    // Transport file for the system prompt. `.xtrm/` is gitignored so this
    // never rides a checkpoint commit.
    const promptFile = path.join(
        worktreePath,
        '.xtrm',
        `role-${slugifyForSession(role.name)}-prompt.md`,
    );
    mkdirSync(path.dirname(promptFile), { recursive: true });
    writeFileSync(promptFile, role.systemPrompt);

    const parentSessionId = currentTmuxSessionId();
    const plan = buildRoleTmuxPlan({ role, bead, parentSessionId, promptFile });

    // Fail fast if the session name already exists — do not silently attach
    // to a stale session with unknown metadata.
    const hasSess = spawnSync('tmux', ['has-session', '-t', `=${plan.sessionName}`], {
        stdio: 'pipe',
    });
    if (hasSess.status === 0) {
        process.stderr.write(kleur.red(
            `\n  ✗ tmux session '${plan.sessionName}' already exists — kill it or pick a fresh bead\n`,
        ));
        process.exit(1);
    }

    const newSess = spawnSync('tmux', [
        'new-session', '-d',
        '-s', plan.sessionName,
        '-c', worktreePath,
        plan.piCmdString,
    ], { stdio: 'pipe', encoding: 'utf8' });
    if (newSess.status !== 0) {
        const stderr = (newSess.stderr ?? '').trim() || 'unknown error';
        process.stderr.write(kleur.red(`\n  ✗ tmux new-session failed: ${stderr}\n`));
        process.exit(1);
    }

    const paneQuery = spawnSync('tmux', [
        'list-panes', '-t', plan.sessionName, '-F', '#{pane_id}',
    ], { stdio: 'pipe', encoding: 'utf8' });
    const paneId = (paneQuery.stdout ?? '').trim().split('\n')[0] ?? '';
    if (!paneId) {
        process.stderr.write(kleur.red('\n  ✗ Could not resolve pane id for new session\n'));
        process.exit(1);
    }

    for (const { key, value } of plan.paneOptions) {
        spawnSync('tmux', ['set-option', '-p', '-t', paneId, key, value], { stdio: 'pipe' });
    }

    if (!attach) {
        // Contract: exactly one line on stdout, session_name:pane_id
        process.stdout.write(`${plan.sessionName}:${paneId}\n`);
        process.exit(0);
    }

    const attachResult = spawnSync('tmux', ['attach-session', '-t', plan.sessionName], {
        stdio: 'inherit',
    });
    process.exit(attachResult.status ?? 0);
}
