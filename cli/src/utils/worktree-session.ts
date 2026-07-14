import kleur from 'kleur';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, unlinkSync, lstatSync, readlinkSync, realpathSync, rmSync, readdirSync } from 'node:fs';

import { shouldUseGlobalSkills } from '../core/global-skills-flag.js';
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
    /** With --role: force a new tmux session even when inside $TMUX. Outside $TMUX this is the (unchanged) default. */
    newSession?: boolean;
    /** With --role: override @agent_parent_session on the target pane (tmux session name, id, or #{session_id}). */
    parent?: string;
    /** With --role: explicit form of the auto-behavior — @agent_parent_session = current pane's #{session_id}. --parent wins over --child when both set. */
    child?: boolean;
    /** When --new-session (or outside $TMUX) hits a session-name collision, attach to the existing session instead of auto-suffixing. */
    reuse?: boolean;
    /** Additional skills requested explicitly with repeatable --skill flags. */
    skills?: string[];
    /** Raw argv after `--` on the xt pi command; forwarded verbatim to pi. */
    passthrough?: string[];
}

function worktreeHasProjectUserPacks(worktreePath: string): boolean {
    const userPacksRoot = path.join(worktreePath, '.xtrm', 'skills', 'user', 'packs');
    if (!existsSync(userPacksRoot)) {
        return false;
    }

    return readdirSync(userPacksRoot).length > 0;
}

function verifyGlobalPointer(): void {
    const pointerPath = path.join(os.homedir(), '.claude', 'skills');
    const stat = lstatSync(pointerPath);
    if (!stat.isSymbolicLink()) {
        throw new Error(`global skills pointer is not a symlink: ${pointerPath}`);
    }

    const targetPath = readlinkSync(pointerPath);
    const resolvedTarget = path.resolve(path.dirname(pointerPath), targetPath);
    if (!existsSync(resolvedTarget)) {
        throw new Error(`global skills pointer target missing: ${resolvedTarget}`);
    }
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

// xt-owned flags a passthrough must not clobber. Reject with a clear error if
// the user tries to pass any of these after `--`. Session naming, prompt, and
// session-dir are set by the launcher and re-passing them silently would break
// address routing or duplicate state.
const ROLE_GUARDED_PI_FLAGS: readonly string[] = [
    '--session-dir',
    '--name',
    '--system-prompt',
    '--append-system-prompt',
    '--skill',
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

// Resolve a specialist.skills.paths entry to an absolute file path.
//
// Precedence, matching the operator's mental model "try local override,
// else canonical global":
//   1. absolute or ~-prefixed → use verbatim (author knows what they want)
//   2. relative + exists at mainRepoRoot → repo-local override
//   3. relative + exists at $HOME → canonical global (post-migration home)
//   4. otherwise → return the repo-resolved path so pi produces the loud
//      "skill not found" error at the exact absolute location the operator
//      can then fix
//
// Canonical global skills now live at ~/.xtrm/skills/default with runtime
// pointers at ~/.pi/agent/skills and ~/.claude/skills. Keep a narrow fallback
// for vendored specialist specs that still name the retired active tree.
// Exported for unit testing.
export function resolveSkillPath(mainRepoRoot: string, rawPath: string): string {
    if (path.isAbsolute(rawPath)) return rawPath;
    if (rawPath === '~') return os.homedir();
    if (rawPath.startsWith('~/')) return path.join(os.homedir(), rawPath.slice(2));
    const repoResolved = path.resolve(mainRepoRoot, rawPath);
    if (existsSync(repoResolved)) return repoResolved;
    const homeResolved = path.resolve(os.homedir(), rawPath);
    if (existsSync(homeResolved)) return homeResolved;
    const migratedPath = rawPath.replace(/^\.xtrm\/skills\/active\//, '.xtrm/skills/default/');
    const migratedResolved = path.resolve(os.homedir(), migratedPath);
    if (migratedPath !== rawPath && existsSync(migratedResolved)) return migratedResolved;
    return repoResolved;
}

export function injectSkillContents(systemPrompt: string, skillPaths: string[]): string {
    const seen = new Set<string>();
    const blocks = skillPaths.flatMap((skillPath) => {
        const file = realpathSync(lstatSync(skillPath).isDirectory()
            ? path.join(skillPath, 'SKILL.md')
            : skillPath);
        if (seen.has(file)) return [];
        seen.add(file);
        const name = path.basename(path.dirname(file));
        return [`<skill_content name=${JSON.stringify(name)} source=${JSON.stringify(file)}>\n${readFileSync(file, 'utf8')}\n</skill_content>`];
    });
    return blocks.length === 0
        ? systemPrompt
        : `${systemPrompt}\n\n# Required Skills (injected in full)\n\n${blocks.join('\n\n')}`;
}

export function resolveRequestedSkills(mainRepoRoot: string, requested: string[]): string[] {
    const resolved = requested.map((skill) => {
        const direct = resolveSkillPath(mainRepoRoot, skill);
        if (existsSync(direct)) {
            const valid = lstatSync(direct).isDirectory()
                ? existsSync(path.join(direct, 'SKILL.md'))
                : path.basename(direct) === 'SKILL.md';
            if (!valid) throw new Error(`skill '${skill}' is not a skill directory or SKILL.md`);
            return direct;
        }

        const candidates = [
            path.join(mainRepoRoot, '.pi', 'skills', skill, 'SKILL.md'),
            path.join(mainRepoRoot, '.claude', 'skills', skill, 'SKILL.md'),
            path.join(mainRepoRoot, '.agents', 'skills', skill, 'SKILL.md'),
            path.join(os.homedir(), '.pi', 'agent', 'skills', skill, 'SKILL.md'),
            path.join(os.homedir(), '.claude', 'skills', skill, 'SKILL.md'),
            path.join(os.homedir(), '.agents', 'skills', skill, 'SKILL.md'),
            path.join(os.homedir(), '.xtrm', 'skills', 'default', skill, 'SKILL.md'),
        ];
        const found = candidates.find(existsSync);
        if (!found) throw new Error(`skill '${skill}' not found`);
        return found;
    });
    return [...new Set(resolved.map((skillPath) => realpathSync(skillPath)))];
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

export interface RenderedRoleTask {
    initialPrompt: string;
    promptHash: string;
    components: Array<{ kind: string; name: string; tokens: number; bytes: number }>;
}

export function renderRoleTask(args: {
    role: string;
    bead: string;
    cwd: string;
    runtime: 'pi' | 'claude';
}): RenderedRoleTask {
    const result = spawnSync('sp', [
        'render-task', args.role,
        '--bead', args.bead,
        '--cwd', args.cwd,
        '--context-depth', '3',
        '--surface', args.runtime,
    ], {
        cwd: args.cwd,
        encoding: 'utf8',
        stdio: 'pipe',
        maxBuffer: 16 * 1024 * 1024,
    });

    let parsed: unknown;
    try {
        parsed = JSON.parse(result.stdout ?? '');
    } catch {
        throw new Error(`role '${args.role}': specialists render-task returned invalid JSON`);
    }
    const output = parsed as {
        ok?: unknown;
        initial_prompt?: unknown;
        prompt_hash?: unknown;
        components?: unknown;
        error?: { code?: unknown; message?: unknown };
    };
    if (result.status !== 0 || output.ok !== true) {
        const code = typeof output.error?.code === 'string' ? output.error.code : 'render_failed';
        const message = typeof output.error?.message === 'string' ? output.error.message : 'unknown error';
        throw new Error(`role '${args.role}': ${code}: ${message}`);
    }
    if (typeof output.initial_prompt !== 'string' || typeof output.prompt_hash !== 'string') {
        throw new Error(`role '${args.role}': specialists render-task returned an invalid success payload`);
    }
    const components = Array.isArray(output.components)
        ? output.components.filter((component): component is RenderedRoleTask['components'][number] => {
            if (!component || typeof component !== 'object') return false;
            const value = component as Record<string, unknown>;
            return typeof value.kind === 'string'
                && typeof value.name === 'string'
                && typeof value.tokens === 'number'
                && typeof value.bytes === 'number';
        })
        : [];
    return { initialPrompt: output.initial_prompt, promptHash: output.prompt_hash, components };
}

function slugifyForSession(input: string): string {
    const s = input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return s.slice(0, 32) || 'x';
}

function shellQuote(s: string): string {
    return `'${s.replace(/'/g, `'\\''`)}'`;
}

export function prepareClaudeSkillPlugin(worktreePath: string, skillPaths: string[]): string {
    const pluginRoot = path.join(worktreePath, '.xtrm', 'role-skills');
    rmSync(pluginRoot, { recursive: true, force: true });
    mkdirSync(path.join(pluginRoot, '.claude-plugin'), { recursive: true });
    mkdirSync(path.join(pluginRoot, 'skills'), { recursive: true });
    writeFileSync(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), JSON.stringify({
        name: 'xtrm-role-skills',
        description: 'Ephemeral skills selected for this xt role session',
    }));

    const names = new Set<string>();
    const roots = new Set<string>();
    for (const skillPath of skillPaths) {
        const skillRoot = realpathSync(lstatSync(skillPath).isDirectory() ? skillPath : path.dirname(skillPath));
        if (roots.has(skillRoot)) continue;
        roots.add(skillRoot);
        const skillFile = path.join(skillRoot, 'SKILL.md');
        if (!existsSync(skillFile)) throw new Error(`skill path has no SKILL.md: ${skillPath}`);
        const name = path.basename(skillRoot);
        if (names.has(name)) throw new Error(`duplicate requested skill name '${name}'`);
        names.add(name);
        symlinkSync(skillRoot, path.join(pluginRoot, 'skills', name), 'dir');
    }
    return pluginRoot;
}

export interface RoleTmuxPlan {
    sessionName: string;
    /** Runtime binary — 'pi' or 'claude'. */
    runtimeCmd: 'pi' | 'claude';
    /** Argv passed to the runtime binary (excluding the binary itself). */
    runtimeArgs: string[];
    /** Shell-quoted command line for `tmux new-session ...` (includes the binary). */
    runtimeCmdString: string;
    paneOptions: Array<{ key: string; value: string }>;
}

// Pure — no I/O. Exported for unit testing.
export function chooseAttachCommand(sessionName: string, insideTmux: boolean): string[] {
    return insideTmux
        ? ['switch-client', '-t', sessionName]
        : ['attach-session', '-t', sessionName];
}

export function buildRoleTmuxPlan(args: {
    /** Which runtime binary this plan targets. */
    runtime: 'pi' | 'claude';
    role: ResolvedRole;
    bead?: string;
    parentSessionId: string;
    promptFile: string;
    /** Verbatim system prompt content, needed for the claude runtime which
     * takes `--append-system-prompt <prompt>` (a string), not a file path. */
    systemPrompt: string;
    /** CLI --model override; wins over role.model. */
    modelOverride?: string;
    /** CLI --thinking override; wins over role.thinkingLevel. Silently dropped
     * for claude (no --thinking flag) — caller warns at CLI level if the user
     * explicitly passed --thinking to xt claude. */
    thinkingOverride?: string;
    /** Secure file containing the rendered initial user task. */
    initialPromptFile?: string;
    /** Explicit --skill requests, already resolved to absolute paths. */
    explicitSkillPaths?: string[];
    /** Ephemeral Claude plugin exposing explicitly requested skills. */
    claudeSkillPluginPath?: string;
    /** Argv after `--` on the xt command line, already guard-checked. */
    passthrough?: string[];
}): RoleTmuxPlan {
    const {
        runtime, role, bead, parentSessionId, promptFile, systemPrompt, modelOverride,
        thinkingOverride, initialPromptFile, explicitSkillPaths = [], claudeSkillPluginPath, passthrough,
    } = args;
    const roleSlug = slugifyForSession(role.name);
    // Include runtime in the session name so xt pi --role X --bead Y and
    // xt claude --role X --bead Y produce distinguishable sessions
    // (role-pi-X-Y vs role-claude-X-Y) instead of colliding on role-X-Y and
    // relying on xtmux-1lb.6's auto-suffix. Operator's mental model is one
    // pi + one claude flavor of the same specialist, not "the second one
    // gets a random hex". See xtmux-3h8.
    const sessionName = bead
        ? `role-${runtime}-${roleSlug}-${slugifyForSession(bead)}`
        : `role-${runtime}-${roleSlug}`;

    const runtimeArgs: string[] = [];

    if (runtime === 'pi') {
        // Pi: file-based system prompt (--append-system-prompt <file>);
        // repo-native --skill <path> for each of the role's skills.
        runtimeArgs.push('--append-system-prompt', promptFile);
        const seenSkills = new Set<string>();
        for (const skill of [...role.skillPaths, ...explicitSkillPaths]) {
            const identity = existsSync(skill) ? realpathSync(skill) : skill;
            if (seenSkills.has(identity)) continue;
            seenSkills.add(identity);
            runtimeArgs.push('--skill', skill);
        }
        // Extensions: trust pi's own discovery (~/.pi/agent/settings.json plus
        // any per-repo settings). Previously (PR #365) the launcher emitted
        // `--no-extensions -e <name>...` from a curated allow-list, but `pi -e`
        // takes a **filesystem path**, not a registry name — the launcher was
        // silently crashing pi on startup. Drop the policy; trust discovery.
        // See xtmux-3rs.
    } else {
        // Claude: string-based system prompt (--append-system-prompt <prompt>);
        // skills are resolved from cwd's .claude/skills/ (the worktree scaffold
        // already symlinks that at launch), so no CLI flag needed. Skip the
        // permission gate — sandboxed worktrees are the trust boundary.
        runtimeArgs.push('--append-system-prompt', systemPrompt);
        runtimeArgs.push('--dangerously-skip-permissions');
        if (claudeSkillPluginPath) runtimeArgs.push('--plugin-dir', claudeSkillPluginPath);
    }

    // Model: CLI override wins over specialist default. Both runtimes accept
    // --model <name>; pi and claude resolve their own defaults when unset.
    const model = modelOverride ?? role.model;
    if (model) runtimeArgs.push('--model', model);

    // Thinking: pi-only. Claude has no --thinking flag; silently drop when
    // the target is claude (caller warns at CLI-level if user was explicit).
    if (runtime === 'pi') {
        const thinking = thinkingOverride ?? role.thinkingLevel;
        if (thinking) runtimeArgs.push('--thinking', thinking);
    }

    // Passthrough: append verbatim (caller must have run guardRolePassthrough
    // first to reject xt-owned flags and drop batch-mode incompatibles).
    if (passthrough && passthrough.length > 0) {
        runtimeArgs.push(...passthrough);
    }

    if (initialPromptFile) {
        if (runtime === 'claude') runtimeArgs.push('--');
        runtimeArgs.push(`@${initialPromptFile}`);
    }

    const runtimeCmdString = [runtime, ...runtimeArgs].map(shellQuote).join(' ');

    // Pane metadata written on the target pane at launch time. Picker + safe-
    // send-pointer + handoff read these. @agent_state=idle so the picker sees
    // the pane immediately (the runtime's own agent-state hook won't fire
    // until the first turn). @agent_prompt_file lets the picker preview show
    // which role is running.
    const paneOptions: Array<{ key: string; value: string }> = [
        { key: '@agent_parent_session', value: parentSessionId },
        { key: '@agent_task', value: `role:${role.name}` },
        { key: '@agent_state', value: 'idle' },
        { key: '@agent_prompt_file', value: promptFile },
    ];
    if (bead) paneOptions.push({ key: '@agent_bead', value: bead });

    return { sessionName, runtimeCmd: runtime, runtimeArgs, runtimeCmdString, paneOptions };
}

/**
 * Environment variables exported to the pi child process so scripts/agent-
 * state.sh (and the picker's own reads) can find the metadata without an
 * extra tmux query. Redundant with paneOptions on purpose — the launcher
 * writes options once at spawn (state=idle etc.), and env vars survive re-
 * execs the way pane options do not. xtmux-1lb.5.1.
 */
export function buildAgentEnv(args: {
    bead?: string;
    role: string;
    promptFile: string;
    parentSessionId: string;
}): Record<string, string> {
    const { bead, role, promptFile, parentSessionId } = args;
    const env: Record<string, string> = {
        XTMUX_AGENT_TASK: `role:${role}`,
        XTMUX_AGENT_PROMPT_FILE: promptFile,
        XTMUX_AGENT_PARENT_SESSION: parentSessionId,
    };
    if (bead) env.XTMUX_AGENT_BEAD = bead;
    return env;
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
    let renderedTask: RenderedRoleTask | undefined;
    let explicitSkillPaths: string[] = [];
    if (roleName) {
        try {
            resolvedRole = resolveRole(roleName, cwd);
            resolvedRole.skillPaths = resolveRequestedSkills(cwd, resolvedRole.skillPaths);
            explicitSkillPaths = resolveRequestedSkills(cwd, opts.skills ?? []);
            resolvedRole.systemPrompt = injectSkillContents(
                resolvedRole.systemPrompt,
                [...resolvedRole.skillPaths, ...explicitSkillPaths],
            );
            if (bead) renderedTask = renderRoleTask({ role: roleName, bead, cwd, runtime });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(kleur.red(`\n  ✗ ${msg}\n`));
            process.exit(1);
        }
    } else if (model || thinking || (opts.skills && opts.skills.length > 0) || (opts.passthrough && opts.passthrough.length > 0)) {
        console.error(kleur.red('\n  ✗ --model / --thinking / --skill / -- passthrough require --role\n'));
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
            if (shouldUseGlobalSkills(worktreePath) && !worktreeHasProjectUserPacks(worktreePath)) {
                verifyGlobalPointer();
            } else {
                await ensureAgentsSkillsSymlink(worktreePath);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.log(kleur.dim(`  warning: could not reconcile runtime skills (${message})`));
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
            runtime,
            role: resolvedRole,
            bead,
            attach,
            worktreePath,
            modelOverride: model,
            thinkingOverride: thinking,
            renderedTask,
            explicitSkillPaths,
            passthrough: guardedPassthrough,
            newSession: opts.newSession,
            reuse: opts.reuse,
            parent: opts.parent,
            child: opts.child,
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

/**
 * Resolve a --parent target (session name, id, or `#{session_id}` string) to
 * a concrete tmux session id via `tmux display-message`. Returns null on
 * failure so the launcher can print a clear error before spawning pi.
 * xtmux-1lb.5.1.
 */
function resolveParentSession(target: string): string | null {
    if (/^\$\d+$/.test(target)) return target; // already a sid
    const r = spawnSync('tmux', ['display-message', '-p', '-t', target, '#{session_id}'], {
        stdio: 'pipe', encoding: 'utf8',
    });
    if (r.status !== 0) return null;
    const sid = (r.stdout ?? '').trim();
    return sid || null;
}

/**
 * Fire-and-forget log emission via tmux-session-picker. Non-fatal if the
 * picker binary is missing — the launcher must not fail the user's launch on
 * observability. xtmux-1lb.5.1.
 */
function emitAgentRoleLaunched(fields: Record<string, string>): void {
    const picker = process.env.XTMUX_PICKER
        || path.join(os.homedir(), '.local', 'bin', 'tmux-session-picker');
    if (!existsSync(picker)) return;
    const kvArgs = Object.entries(fields)
        .filter(([, v]) => v !== '' && v != null)
        .map(([k, v]) => `${k}=${v}`);
    spawnSync(picker, ['log', 'emit', 'agent.role.launched', ...kvArgs], {
        stdio: 'ignore',
    });

    if (fields.task_prompt_renderer) {
        const taskFields = [
            'pane', 'session', 'bead', 'role',
            'task_prompt_renderer', 'task_prompt_hash', 'task_prompt_components',
        ].flatMap((key) => fields[key] ? [`${key}=${fields[key]}`] : []);
        spawnSync(picker, ['log', 'emit', 'agent.role.task-rendered', ...taskFields], {
            stdio: 'ignore',
        });
    }
}

async function launchRoleTmuxSession(args: {
    runtime: 'pi' | 'claude';
    role: ResolvedRole;
    bead?: string;
    attach: boolean;
    worktreePath: string;
    modelOverride?: string;
    thinkingOverride?: string;
    renderedTask?: RenderedRoleTask;
    explicitSkillPaths?: string[];
    passthrough?: string[];
    newSession?: boolean;
    parent?: string;
    child?: boolean;
    reuse?: boolean;
}): Promise<never> {
    const {
        runtime, role, bead, attach, worktreePath, modelOverride, thinkingOverride, renderedTask, explicitSkillPaths = [], passthrough,
        newSession, parent, child, reuse,
    } = args;

    const insideTmux = Boolean(process.env.TMUX);
    // Current-pane mode: inside $TMUX with no explicit --new-session. This is
    // the new default — matches operator intent "if i'm in tmux and want a
    // role, launch it in this pane and that's that." Outside $TMUX the only
    // sensible thing is still `tmux new-session`, so mode collapses to
    // new-session there regardless of --new-session. xtmux-1lb.5.1.
    const currentPaneMode = insideTmux && !newSession;

    // Guard: --no-attach only makes sense when we're actually creating a
    // session that could be attached-to later. In current-pane mode there IS
    // no separate session, so --no-attach has nowhere to go.
    if (currentPaneMode && !attach) {
        process.stderr.write(kleur.red(
            `\n  ✗ --no-attach requires --new-session (or exit tmux first)\n`,
        ));
        process.exit(1);
    }

    // Resolve parent session id. Precedence: --parent wins over --child
    // wins over auto (current session).
    let parentSessionId: string;
    if (parent) {
        const resolved = resolveParentSession(parent);
        if (!resolved) {
            process.stderr.write(kleur.red(
                `\n  ✗ --parent '${parent}': tmux session not found\n`,
            ));
            process.exit(1);
        }
        parentSessionId = resolved;
    } else if (child) {
        // Explicit form of the auto-behavior. Kept as an opt-in so a future
        // default flip (to 'no auto-parent') doesn't break scripts.
        parentSessionId = currentTmuxSessionId();
    } else {
        parentSessionId = currentTmuxSessionId();
    }

    // Transport file for the system prompt. `.xtrm/` is gitignored so this
    // never rides a checkpoint commit.
    const promptFile = path.join(
        worktreePath,
        '.xtrm',
        `role-${slugifyForSession(role.name)}-prompt.md`,
    );
    mkdirSync(path.dirname(promptFile), { recursive: true });
    writeFileSync(promptFile, role.systemPrompt);

    const initialPromptFile = renderedTask
        ? path.join(worktreePath, '.xtrm', `role-${slugifyForSession(role.name)}-task.md`)
        : undefined;
    if (initialPromptFile && renderedTask) {
        writeFileSync(initialPromptFile, renderedTask.initialPrompt, { mode: 0o600 });
        chmodSync(initialPromptFile, 0o600);
    }

    const claudeSkillPaths = [...role.skillPaths, ...explicitSkillPaths];
    const claudeSkillPluginPath = runtime === 'claude' && claudeSkillPaths.length > 0
        ? prepareClaudeSkillPlugin(worktreePath, claudeSkillPaths)
        : undefined;

    const plan = buildRoleTmuxPlan({
        runtime,
        role,
        bead,
        parentSessionId,
        promptFile,
        systemPrompt: role.systemPrompt,
        modelOverride,
        thinkingOverride,
        initialPromptFile,
        explicitSkillPaths,
        claudeSkillPluginPath,
        passthrough,
    });

    const agentEnv = buildAgentEnv({ bead, role: role.name, promptFile, parentSessionId });

    if (currentPaneMode) {
        // Resolve the current pane id (the pane the launcher was invoked
        // from). All @agent_* pane options get written here; pi then runs
        // in this same pane with stdio inherited.
        const paneQuery = spawnSync('tmux', ['display-message', '-p', '#{pane_id}'], {
            stdio: 'pipe', encoding: 'utf8',
        });
        const paneId = (paneQuery.stdout ?? '').trim();
        if (!paneId) {
            process.stderr.write(kleur.red('\n  ✗ Could not resolve current pane id\n'));
            process.exit(1);
        }

        for (const { key, value } of plan.paneOptions) {
            spawnSync('tmux', ['set-option', '-p', '-t', paneId, key, value], { stdio: 'pipe' });
        }

        emitAgentRoleLaunched({
            pane: paneId,
            session: currentTmuxSessionId(),
            bead: bead ?? '',
            role: role.name,
            parent: parentSessionId,
            worktree: worktreePath,
            task_prompt_renderer: renderedTask ? 'success' : 'not_requested',
            task_prompt_hash: renderedTask?.promptHash ?? '',
            task_prompt_components: renderedTask ? JSON.stringify(renderedTask.components) : '',
        });

        const piResult = spawnSync(plan.runtimeCmd, plan.runtimeArgs, {
            cwd: worktreePath,
            stdio: 'inherit',
            env: { ...process.env, ...agentEnv },
        });
        process.exit(piResult.status ?? 0);
    }

    // New-session path (default outside $TMUX, or --new-session inside).
    // On session-name collision two operator-friendly outcomes replace the
    // pre-xtmux-1lb.6 hard-refuse:
    //   --reuse         attach to the existing session (no new worktree work)
    //   default         auto-suffix `-<hex>` and create a fresh sibling
    // The worktree naming already generates unique hex suffixes; session
    // naming now mirrors that so `xt pi --role X` twice in a row does the
    // sane thing.
    const sessionExists = (name: string): boolean => {
        const r = spawnSync('tmux', ['has-session', '-t', `=${name}`], { stdio: 'pipe' });
        return r.status === 0;
    };
    if (sessionExists(plan.sessionName)) {
        if (reuse) {
            // Attach to the existing session (or --no-attach: print its
            // first-pane coordinates). Do NOT emit agent.role.launched —
            // the session isn't ours and metadata isn't guaranteed.
            const paneQuery = spawnSync('tmux', [
                'list-panes', '-t', plan.sessionName, '-F', '#{pane_id}',
            ], { stdio: 'pipe', encoding: 'utf8' });
            const existingPane = (paneQuery.stdout ?? '').trim().split('\n')[0] ?? '';
            if (!attach) {
                process.stdout.write(`${plan.sessionName}:${existingPane}\n`);
                process.exit(0);
            }
            const attachCmd = chooseAttachCommand(plan.sessionName, insideTmux);
            const attachResult = spawnSync('tmux', attachCmd, { stdio: 'inherit' });
            process.exit(attachResult.status ?? 0);
        }
        // Auto-suffix. Try a handful of random slugs — collisions on
        // 4-hex-char slugs are astronomically unlikely, but bail loudly if
        // the operator has genuinely tens of sessions all sharing a prefix.
        let suffixed = plan.sessionName;
        let found = false;
        for (let i = 0; i < 10; i++) {
            const candidate = `${plan.sessionName}-${randomSlug(4)}`;
            if (!sessionExists(candidate)) {
                suffixed = candidate;
                found = true;
                break;
            }
        }
        if (!found) {
            process.stderr.write(kleur.red(
                `\n  ✗ Could not find a free session name variant for '${plan.sessionName}' — kill some or pass --reuse\n`,
            ));
            process.exit(1);
        }
        plan.sessionName = suffixed;
    }

    // Pass XTMUX_AGENT_* through to the new session's environment via -e so
    // scripts/agent-state.sh (running inside the new pane) can pick them up.
    const envArgs: string[] = [];
    for (const [k, v] of Object.entries(agentEnv)) {
        envArgs.push('-e', `${k}=${v}`);
    }

    const newSess = spawnSync('tmux', [
        'new-session', '-d',
        '-s', plan.sessionName,
        '-c', worktreePath,
        ...envArgs,
        plan.runtimeCmdString,
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

    emitAgentRoleLaunched({
        pane: paneId,
        session: plan.sessionName,
        bead: bead ?? '',
        role: role.name,
        parent: parentSessionId,
        worktree: worktreePath,
        task_prompt_renderer: renderedTask ? 'success' : 'not_requested',
        task_prompt_hash: renderedTask?.promptHash ?? '',
        task_prompt_components: renderedTask ? JSON.stringify(renderedTask.components) : '',
    });

    if (!attach) {
        // Contract: exactly one line on stdout, session_name:pane_id
        process.stdout.write(`${plan.sessionName}:${paneId}\n`);
        process.exit(0);
    }

    const attachCmd = chooseAttachCommand(plan.sessionName, insideTmux);
    const attachResult = spawnSync('tmux', attachCmd, {
        stdio: 'inherit',
    });
    process.exit(attachResult.status ?? 0);
}
