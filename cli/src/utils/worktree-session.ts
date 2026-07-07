import kleur from 'kleur';
import os from 'node:os';
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
    /** Explicit --model override for pi role sessions; wins over specialist default. */
    model?: string;
    /** Explicit --thinking level override for pi role sessions; wins over specialist default. */
    thinking?: string;
    /** Raw argv after `--` on the xt pi command; forwarded verbatim to pi. */
    passthrough?: string[];
}

export interface ResolvedRole {
    name: string;
    systemPrompt: string;
    skillPaths: string[];
    /** specialist.execution.model — default pi --model for role. */
    model?: string;
    /** specialist.execution.thinking_level — default pi --thinking for role. */
    thinkingLevel?: string;
    /** specialist.execution.extensions — per-role opt-in/opt-out map. */
    extensions?: Record<string, boolean>;
}

// Baseline pi extension policy for xt pi --role, per xtmux-2dy design.
// INCLUDE by default: caveman, pi-nvidia-nim, service-skills, worktree-boundary,
// @jaggerxtrm/pi-extensions, pi-guardrails. Everything else pi's default
// discovery finds (pi-serena-tools, pi-gitnexus, structured-return, goal, qwen,
// lsp, ponytail, context-mode extension, etc.) is EXCLUDED. Specialists can
// still opt-in via execution.extensions.{name}: true or opt-out via false.
export const ROLE_DEFAULT_EXTENSIONS: readonly string[] = [
    'caveman',
    'pi-nvidia-nim',
    'service-skills',
    'worktree-boundary',
    '@jaggerxtrm/pi-extensions',
    'pi-guardrails',
] as const;

// xt-owned flags a passthrough must not clobber. Reject with a clear error if
// the user tries to pass any of these after `--`. Session naming, prompt, and
// session-dir are set by the launcher and re-passing them silently would break
// address routing or duplicate state.
const ROLE_GUARDED_PI_FLAGS: readonly string[] = [
    '--session-dir',
    '--name',
    '--system-prompt',
    '--append-system-prompt',
] as const;

// Pi flags that contradict interactive coordination or invoke pi as a batch
// tool. Warn but drop rather than fail — the caller may have tried to reuse a
// script.
const ROLE_SKIPPED_PI_FLAGS: readonly string[] = [
    '--print',
    '--list-models',
    '--export',
    '--mode',
] as const;

export interface PiArgvGuardResult {
    guardedError?: string;
    warnings: string[];
    filteredArgs: string[];
}

// Pure — no I/O. Split so tests can drive it directly.
export function guardRolePassthrough(passthrough: string[]): PiArgvGuardResult {
    const warnings: string[] = [];
    const filteredArgs: string[] = [];
    for (let i = 0; i < passthrough.length; i++) {
        const arg = passthrough[i];
        const bare = arg.split('=', 1)[0];
        if (ROLE_GUARDED_PI_FLAGS.includes(bare)) {
            return {
                guardedError: `xt pi --role: ${bare} is set by the launcher and cannot be passed after --`,
                warnings,
                filteredArgs: [],
            };
        }
        if (ROLE_SKIPPED_PI_FLAGS.includes(bare)) {
            warnings.push(`xt pi --role: ignoring ${bare} — incompatible with interactive coordination`);
            // consume value if next arg is not another flag
            if (!arg.includes('=') && i + 1 < passthrough.length && !passthrough[i + 1].startsWith('-')) {
                i += 1;
            }
            continue;
        }
        filteredArgs.push(arg);
    }
    return { warnings, filteredArgs };
}

// Pure — no I/O. Merge baseline defaults with per-role overrides to produce the
// final -e list. execution.extensions: {name: true} adds; {name: false} drops.
export function computeRoleExtensions(role: ResolvedRole): string[] {
    const wanted = new Set<string>(ROLE_DEFAULT_EXTENSIONS);
    for (const [name, keep] of Object.entries(role.extensions ?? {})) {
        if (keep) wanted.add(name);
        else wanted.delete(name);
    }
    return [...wanted];
}

function resolveSkillPath(mainRepoRoot: string, rawPath: string): string {
    if (path.isAbsolute(rawPath)) return rawPath;
    if (rawPath === '~') return os.homedir();
    if (rawPath.startsWith('~/')) return path.join(os.homedir(), rawPath.slice(2));
    return path.resolve(mainRepoRoot, rawPath);
}

// Exposed for unit testing. sp view <name> --raw is the source of truth for
// specialist resolution — do not reimplement its .specialists/user + installed
// package precedence here.
export function parseSpecialistJson(name: string, raw: string, mainRepoRoot: string = process.cwd()): ResolvedRole {
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
        ? rawPaths
            .filter((p): p is string => typeof p === 'string' && p.length > 0)
            .map((skillPath) => resolveSkillPath(mainRepoRoot, skillPath))
        : [];
    const mode = (spec as { system_prompt_mode?: unknown }).system_prompt_mode;
    if (mode === 'replace') {
        // Interactive pi must keep AGENTS.md + coding base. Warn and force append.
        process.stderr.write(kleur.yellow(
            `  ⚠ role '${name}': system_prompt_mode=replace ignored; forcing append\n`,
        ));
    }

    // execution.{model,thinking_level,extensions} — all optional. CLI flags win
    // over these at launch time; specialists set them as sensible defaults.
    const execution = (spec as { execution?: unknown }).execution as
        | { model?: unknown; thinking_level?: unknown; extensions?: unknown }
        | undefined;
    const model = typeof execution?.model === 'string' && execution.model ? execution.model : undefined;
    const thinkingLevel = typeof execution?.thinking_level === 'string' && execution.thinking_level ? execution.thinking_level : undefined;
    let extensions: Record<string, boolean> | undefined;
    if (execution?.extensions && typeof execution.extensions === 'object' && !Array.isArray(execution.extensions)) {
        const map: Record<string, boolean> = {};
        for (const [k, v] of Object.entries(execution.extensions as Record<string, unknown>)) {
            if (typeof v === 'boolean') map[k] = v;
        }
        if (Object.keys(map).length > 0) extensions = map;
    }
    return { name, systemPrompt, skillPaths, model, thinkingLevel, extensions };
}

export function resolveRole(name: string, mainRepoRoot: string = process.cwd()): ResolvedRole {
    const r = spawnSync('sp', ['view', name, '--raw'], {
        encoding: 'utf8',
        stdio: 'pipe',
    });
    if (r.status !== 0) {
        const stderr = (r.stderr ?? '').trim() || 'unknown error';
        throw new Error(`role '${name}' not found via sp view (${stderr})`);
    }
    return parseSpecialistJson(name, r.stdout ?? '', mainRepoRoot);
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
    /** CLI --model override; wins over role.model. */
    modelOverride?: string;
    /** CLI --thinking override; wins over role.thinkingLevel. */
    thinkingOverride?: string;
    /** Argv after `--` on xt pi command line, already guard-checked. */
    passthrough?: string[];
}): RoleTmuxPlan {
    const { role, bead, parentSessionId, promptFile, modelOverride, thinkingOverride, passthrough } = args;
    const roleSlug = slugifyForSession(role.name);
    const sessionName = bead
        ? `role-${roleSlug}-${slugifyForSession(bead)}`
        : `role-${roleSlug}`;

    const piArgs: string[] = ['--append-system-prompt', promptFile];
    for (const skill of role.skillPaths) {
        piArgs.push('--skill', skill);
    }

    // Extension policy: curated allow-list for interactive coordination.
    // Defaults + specialist opt-in/out (see computeRoleExtensions).
    piArgs.push('--no-extensions');
    for (const ext of computeRoleExtensions(role)) {
        piArgs.push('-e', ext);
    }

    // Model / thinking: CLI override wins over specialist default. Both
    // optional — pi resolves its own default when neither is set.
    const model = modelOverride ?? role.model;
    if (model) piArgs.push('--model', model);
    const thinking = thinkingOverride ?? role.thinkingLevel;
    if (thinking) piArgs.push('--thinking', thinking);

    // Passthrough: append verbatim (caller must have run guardRolePassthrough
    // first to reject xt-owned flags and drop batch-mode incompatibles).
    if (passthrough && passthrough.length > 0) {
        piArgs.push(...passthrough);
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
    const { runtime, name, role: roleName, bead, attach = true, model, thinking } = opts;
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
            resolvedRole = resolveRole(roleName, cwd);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(kleur.red(`\n  ✗ ${msg}\n`));
            process.exit(1);
        }
    } else if (model || thinking || (opts.passthrough && opts.passthrough.length > 0)) {
        console.error(kleur.red('\n  ✗ --model / --thinking / -- passthrough require --role\n'));
        process.exit(1);
    }

    // Guard passthrough up-front — refuse xt-owned flags before we build any
    // worktree state. Skip-flags produce warnings but continue.
    let guardedPassthrough: string[] = [];
    if (resolvedRole && opts.passthrough && opts.passthrough.length > 0) {
        const guard = guardRolePassthrough(opts.passthrough);
        if (guard.guardedError) {
            console.error(kleur.red(`\n  ✗ ${guard.guardedError}\n`));
            process.exit(1);
        }
        for (const w of guard.warnings) {
            process.stderr.write(kleur.yellow(`  ⚠ ${w}\n`));
        }
        guardedPassthrough = guard.filteredArgs;
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

    // Claude-only scaffold. Pi role sessions now receive absolute --skill
    // paths from resolveRole(), so they no longer need worktree-local
    // .specialists/ or .xtrm/skills/active scaffolds.
    if (runtime === 'claude') {
        const claudeDir = path.join(worktreePath, '.claude');

        // 1. Rebuild generated runtime skills view and pointer inside worktree.
        try {
            await ensureAgentsSkillsSymlink(worktreePath);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.log(kleur.dim(`  warning: could not rebuild active skills view (${message})`));

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

        // 2. Symlink specialist definition directories into worktree so
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
            modelOverride: model,
            thinkingOverride: thinking,
            passthrough: guardedPassthrough,
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
    modelOverride?: string;
    thinkingOverride?: string;
    passthrough?: string[];
}): Promise<never> {
    const { role, bead, attach, worktreePath, modelOverride, thinkingOverride, passthrough } = args;

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
    const plan = buildRoleTmuxPlan({
        role,
        bead,
        parentSessionId,
        promptFile,
        modelOverride,
        thinkingOverride,
        passthrough,
    });

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
