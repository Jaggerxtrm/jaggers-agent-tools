import kleur from 'kleur';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, unlinkSync, lstatSync, readlinkSync, realpathSync, rmSync, readdirSync } from 'node:fs';

import { shouldUseGlobalSkills } from '../core/global-skills-flag.js';
import { ensureAgentsSkillsSymlink } from '../core/skills-scaffold.js';
import { runPiLaunchPreflight } from '../core/pi-runtime.js';
import { runtimeCompatibilityError } from '../core/runtime-compat.js';

/**
 * Hard ceiling for the turn-1 shell command length. tmux new-session refuses
 * commands beyond a few dozen KB with "command too long"; keeping the sum of
 * systemPrompt + prefix + body under this bound guarantees a launchable pane.
 * xtrm-osipt (stopgap was file-based; xtrm-8zsi1 goes inline).
 */
const LITERAL_TURN1_BYTE_CEILING = 50 * 1024;
const RUNTIME_ARG_BYTE_CEILING = (128 * 1024) - 1;
const TMUX_CONSUMER_READY_TIMEOUT_MS = 5_000;
const TMUX_PAYLOAD_READY_TIMEOUT_MS = 5_000;
const RUNTIME_ORIGIN_SLUG_LENGTH = 5;
const RUNTIME_ORIGIN_WAIT_ATTEMPTS = 50;
const AUTO_ASSIGNEE_RE = /^(?:pi|claude)\/[a-z0-9]{5}$/;

export function runtimeAssigneeFromOrigin(runtime: 'pi' | 'claude', runtimeOriginId: string): string | null {
    const tail = runtimeOriginId.trim().split(/[/:]/).filter(Boolean).at(-1);
    const slug = tail?.slice(0, RUNTIME_ORIGIN_SLUG_LENGTH).toLowerCase();
    return slug && /^[a-z0-9]{5}$/.test(slug) ? `${runtime}/${slug}` : null;
}

export function shouldAutoAssignBead(assignee: string | undefined): boolean {
    return !assignee || AUTO_ASSIGNEE_RE.test(assignee);
}

export async function assignBeadToRuntime(
    bead: string,
    runtime: 'pi' | 'claude',
    paneId: string,
    cwd: string,
    previousInstanceId = '',
): Promise<void> {
    const warn = (message: string): void => console.error(kleur.yellow(`  ⚠ bead assignee: ${message}`));
    const show = spawnSync('bd', ['show', bead, '--json'], { cwd, encoding: 'utf8', stdio: 'pipe' });
    if (show.status !== 0) {
        warn(`could not read ${bead}; session launch continues`);
        return;
    }

    try {
        const beadData = JSON.parse(show.stdout ?? '') as Array<{ assignee?: string }> | { assignee?: string };
        const current = Array.isArray(beadData) ? beadData[0]?.assignee : beadData.assignee;
        if (!shouldAutoAssignBead(current)) return;
    } catch {
        warn(`invalid bd show output for ${bead}; session launch continues`);
        return;
    }

    let instanceId = '';
    for (let attempt = 0; attempt < RUNTIME_ORIGIN_WAIT_ATTEMPTS; attempt++) {
        const context = spawnSync('tmux', ['show-options', '-p', '-t', paneId, '-qv', '@agent_instance_id'], {
            encoding: 'utf8', stdio: 'pipe',
        });
        instanceId = context.status === 0 ? (context.stdout ?? '').trim() : '';
        if (instanceId && instanceId !== previousInstanceId) break;
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    const assignee = runtimeAssigneeFromOrigin(runtime, instanceId);
    if (!assignee) {
        warn(`runtime-origin unavailable for ${bead}; session launch continues`);
        return;
    }

    const update = spawnSync('bd', ['update', bead, `--assignee=${assignee}`, '--json'], {
        cwd, encoding: 'utf8', stdio: 'pipe',
    });
    if (update.status !== 0) warn(`could not set ${bead} to ${assignee}; session launch continues`);
}

export interface WorktreeSessionOptions {
    runtime: 'claude' | 'pi';
    name?: string;
    role?: string;
    bead?: string;
    /** Explicit turn-1 body text (case ii). Mutually exclusive with --bead. */
    prompt?: string;
    attach?: boolean;
    /** Explicit runtime --model override; with --role, wins over the specialist default. */
    model?: string;
    /** Explicit Pi --thinking override; with --role, wins over the specialist default. */
    thinking?: string;
    /** Force a new tmux session even when inside $TMUX. Outside $TMUX this is the default. */
    newSession?: boolean;
    /** With --role: override @agent_parent_session on the target pane (tmux session name, id, or #{session_id}). */
    parent?: string;
    /** With --role: explicit form of the auto-behavior — @agent_parent_session = current pane's #{session_id}. --parent wins over --child when both set. */
    child?: boolean;
    /** Canonical subordinate-coordinator launch (audit P0-05). Expands to --new-session --no-attach --child. */
    subordinate?: boolean;
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
    /** Surface-resolved specialist.execution.model default for this runtime. */
    model?: string;
    /** specialist.execution.thinking_level — default pi --thinking for role. */
    thinkingLevel?: string;
    /** specialist.execution.extensions — per-role opt-in/opt-out map. */
    extensions?: Record<string, boolean>;
    /** specialist.execution.interactive — role runs as a persistent session.
     * Tri-state: undefined means the installed Specialists release does not
     * declare it, which must stay permissive. xtrm-6hey0.3. */
    interactive?: boolean;
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

// Pure — no I/O. Split so tests can drive it directly. Reached from every
// launch shape (pi/claude, role/bare) since xtrm-3xgs5, so the messages stay
// runtime- and mode-neutral.
export function guardRolePassthrough(passthrough: string[]): PiArgvGuardResult {
    const warnings: string[] = [];
    const filteredArgs: string[] = [];
    for (let i = 0; i < passthrough.length; i++) {
        const arg = passthrough[i];
        const bare = arg.split('=', 1)[0];
        if (ROLE_GUARDED_PI_FLAGS.includes(bare)) {
            return {
                guardedError: `passthrough: ${bare} is set by the launcher and cannot be passed after --`,
                warnings,
                filteredArgs: [],
            };
        }
        if (ROLE_SKIPPED_PI_FLAGS.includes(bare)) {
            warnings.push(`passthrough: ignoring ${bare} — incompatible with an interactive session`);
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

export function assertClaudeSkillsDiscoverable(mainRepoRoot: string, requestedPaths: string[]): void {
    for (const requestedPath of requestedPaths) {
        const requestedFile = path.basename(requestedPath) === 'SKILL.md'
            ? requestedPath
            : path.join(requestedPath, 'SKILL.md');
        const name = path.basename(path.dirname(requestedFile));
        if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) {
            throw new Error(`invalid Claude skill name '${name}' from '${requestedPath}'`);
        }
        const candidates = [
            path.join(mainRepoRoot, '.claude', 'skills', name, 'SKILL.md'),
            path.join(os.homedir(), '.claude', 'skills', name, 'SKILL.md'),
        ];
        const requestedRealPath = realpathSync(requestedFile);
        if (candidates.some((candidate) => existsSync(candidate) && realpathSync(candidate) === requestedRealPath)) continue;
        throw new Error(
            `skill '${requestedPath}' is not discoverable by Claude as '/${name}'. `
            + `Install or enable the same skill under .claude/skills/${name} before launching.`,
        );
    }
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
        | { model?: unknown; thinking_level?: unknown; extensions?: unknown; interactive?: unknown }
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
    // Tri-state: only an explicit boolean is meaningful. Anything else (absent,
    // null, a string) reads as "not declared" so an older Specialists release
    // stays launchable. xtrm-6hey0.3.
    const interactive = typeof execution?.interactive === 'boolean' ? execution.interactive : undefined;
    return { name, systemPrompt, skillPaths, model, thinkingLevel, extensions, interactive };
}

function isUnsupportedSurfaceOption(stderr: string): boolean {
    return /unknown (?:option|flag)|unrecognized option|unexpected argument|invalid option/i.test(stderr);
}

export function resolveRole(
    name: string,
    mainRepoRoot: string = process.cwd(),
    runtime: 'pi' | 'claude' = 'pi',
    allowLegacyFallback = false,
): ResolvedRole {
    let result = spawnSync('sp', ['view', name, '--raw', '--surface', runtime], {
        encoding: 'utf8',
        stdio: 'pipe',
    });
    const stderr = (result.stderr ?? '').trim();

    // Older Specialists releases predate surface-aware model resolution. Pi
    // can safely retain its historical merged-default behavior. Claude may do
    // so only when an explicit CLI model makes the role default irrelevant;
    // normal launches must fail rather than reintroduce provider leakage.
    if (result.status !== 0
        && (runtime === 'pi' || allowLegacyFallback)
        && isUnsupportedSurfaceOption(stderr)) {
        result = spawnSync('sp', ['view', name, '--raw'], {
            encoding: 'utf8',
            stdio: 'pipe',
        });
    }
    if (result.status !== 0) {
        const error = (result.stderr ?? '').trim() || 'unknown error';
        if (runtime === 'claude' && isUnsupportedSurfaceOption(error)) {
            throw new Error(
                `role '${name}': Specialists does not support surface-aware Claude model resolution; `
                + `upgrade @jaggerxtrm/specialists before launching xt claude --role`,
            );
        }
        throw new Error(`role '${name}' not found via sp view (${error})`);
    }
    return parseSpecialistJson(name, result.stdout ?? '', mainRepoRoot);
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

export function createRuntimeBufferName(): string {
    return `xtrm-role-${randomBytes(16).toString('hex')}`;
}

function deleteRuntimeBuffer(bufferName: string): void {
    spawnSync('tmux', ['delete-buffer', '-b', bufferName], { stdio: 'ignore' });
}

export function buildBufferedRuntimeCommand(
    bufferName: string,
    payloadWaitTimeoutMs: number = TMUX_PAYLOAD_READY_TIMEOUT_MS,
): string {
    const script = [
        "const { execFileSync, spawnSync } = require('node:child_process')",
        'const buffer = process.argv[1]',
        "const cleanup = () => spawnSync('tmux', ['delete-buffer', '-b', buffer], { stdio: 'ignore' })",
        "for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, () => { cleanup(); process.exit(1) })",
        'let raw',
        'try {',
        "  execFileSync('tmux', ['wait-for', '-S', `${buffer}-consumer-ready`])",
        `  execFileSync('tmux', ['wait-for', \`\${buffer}-ready\`], { timeout: ${payloadWaitTimeoutMs}, killSignal: 'SIGTERM', stdio: 'ignore' })`,
        "  raw = execFileSync('tmux', ['show-buffer', '-b', buffer], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 })",
        '} finally {',
        '  cleanup()',
        '}',
        'const payload = JSON.parse(raw)',
        "if (!['pi', 'claude'].includes(payload.runtimeCmd) || !Array.isArray(payload.runtimeArgs) || payload.runtimeArgs.some((arg) => typeof arg !== 'string')) process.exit(2)",
        "const result = spawnSync(payload.runtimeCmd, payload.runtimeArgs, { stdio: 'inherit' })",
        'if (result.error) throw result.error',
        'process.exit(result.status ?? 1)',
    ].join(';');
    return [process.execPath, '-e', script, bufferName].map(shellQuote).join(' ');
}

/**
 * Probe `sp render-skill-prefix --help` once at launcher startup. Newer sp
 * versions provide the canonical prefix directly; older versions fall back
 * to the merged role's declared skill paths. xtrm-8zsi1.
 */
export function probeSkillPrefixAvailable(): { ok: true } | { ok: false; error: string } {
    const r = spawnSync('sp', ['render-skill-prefix', '--help'], {
        stdio: 'pipe',
        encoding: 'utf8',
    });
    if (r.status === 0) return { ok: true };
    const stderr = (r.stderr ?? '').toString();
    return {
        ok: false,
        error: `sp render-skill-prefix not available (needed for trusted role launch prefixes).\n`
            + `Upgrade specialists: npm i -g @jaggerxtrm/specialists@latest\n`
            + `Original error: ${stderr.trim() || 'unknown'}`,
    };
}

export interface RenderSkillPrefixResult {
    /** May be the empty string when the specialist declares no skills. */
    skillPrefix: string;
}

/**
 * Call `sp render-skill-prefix <name> --surface pi|claude` and return the
 * skill_prefix string. Empty string is a legitimate result (no declared
 * skills). Throws with a specific error message when sp errors out with a
 * structured `{ok:false, error:{code,message}}` payload. xtrm-8zsi1.
 */
export function renderSkillPrefix(args: {
    role: string;
    runtime: 'pi' | 'claude';
    cwd?: string;
}): RenderSkillPrefixResult {
    const r = spawnSync(
        'sp',
        ['render-skill-prefix', args.role, '--surface', args.runtime],
        {
            cwd: args.cwd ?? process.cwd(),
            stdio: 'pipe',
            encoding: 'utf8',
            maxBuffer: 4 * 1024 * 1024,
        },
    );

    let parsed: unknown;
    try {
        parsed = JSON.parse(r.stdout ?? '');
    } catch {
        throw new Error(`role '${args.role}': sp render-skill-prefix returned invalid JSON`);
    }
    const output = parsed as {
        ok?: unknown;
        skill_prefix?: unknown;
        error?: { code?: unknown; message?: unknown };
    };
    if (r.status !== 0 || output.ok !== true) {
        const code = typeof output.error?.code === 'string' ? output.error.code : 'render_failed';
        const message = typeof output.error?.message === 'string' ? output.error.message : 'unknown error';
        throw new Error(`role '${args.role}': ${code}: ${message}`);
    }
    if (typeof output.skill_prefix !== 'string') {
        throw new Error(`role '${args.role}': sp render-skill-prefix returned no skill_prefix string`);
    }
    return { skillPrefix: output.skill_prefix };
}

/**
 * Position-0 '/' safety check on the composed turn-1 body. A '/' at literal
 * byte 0 is only safe when it's the sp-owned /skill:name (pi) or /<name>
 * (claude) prefix. Otherwise the runtime's slash-command parser would try to
 * interpret an operator-provided prompt or a bead title starting with '/' as
 * a command. xtrm-8zsi1.
 */
export function checkPositionZeroSlash(
    body: string,
    runtime: 'pi' | 'claude',
    trustedPrefix: string,
): { ok: true } | { ok: false; error: string } {
    const expectedPrefix = runtime === 'pi' ? '/skill:' : '/<name>';
    if (trustedPrefix) {
        const hasValidPrefix = runtime === 'pi'
            ? trustedPrefix.startsWith('/skill:')
            : /^\/(?:[a-zA-Z0-9][a-zA-Z0-9._-]*)(?:\n\/[a-zA-Z0-9][a-zA-Z0-9._-]*)*\n\n$/.test(trustedPrefix);
        if (!hasValidPrefix) {
            return { ok: false, error: `trusted skill prefix does not match the ${runtime} '${expectedPrefix}' surface.` };
        }
        return body.startsWith(trustedPrefix)
            ? { ok: true }
            : { ok: false, error: 'turn-1 body does not start with the exact trusted sp skill prefix.' };
    }
    if (body.length === 0 || body[0] !== '/') return { ok: true };
    return {
        ok: false,
        error: `turn-1 body starts with '/' but sp declared no '${expectedPrefix}' prefix: the runtime would parse untrusted text as a slash-command.\n`
            + `Rename the bead title or adjust --prompt so the first character is not '/'.`,
    };
}

/**
 * Derive the skill name from an absolute path produced by
 * `resolveRequestedSkills`. That resolver returns either the directory
 * `.../skill-name` or the SKILL.md file `.../skill-name/SKILL.md` depending
 * on which form matched, so normalize both. Used to render `/<name>`
 * force-load lines for claude explicit --skill delivery (xtrm-8zsi1
 * follow-up: --plugin-dir scaffold is gone, this is the replacement).
 */
export function claudeExplicitSkillLines(paths: string[]): string {
    return paths
        .map((p) => {
            const name = path.basename(p) === 'SKILL.md'
                ? path.basename(path.dirname(p))
                : path.basename(p);
            return `/${name}`;
        })
        .join('\n');
}

export function renderDeclaredSkillPrefix(
    paths: string[],
    runtime: 'pi' | 'claude',
): string {
    const names = [...new Set(paths.map((p) => path.basename(p) === 'SKILL.md'
        ? path.basename(path.dirname(p))
        : path.basename(p)))];
    for (const name of names) {
        if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) {
            throw new Error(`invalid declared skill name '${name}'`);
        }
    }
    if (names.length === 0) return '';
    const commands = names.map((name) => runtime === 'pi' ? `/skill:${name}` : `/${name}`);
    return `${commands.join(runtime === 'pi' ? ' ' : '\n')}\n\n`;
}

export function checkByteCeiling(parts: {
    systemPrompt: string;
    body: string;
    source: 'prompt' | 'bead';
}): { ok: true } | { ok: false; error: string } {
    if (parts.systemPrompt.includes('\0') || parts.body.includes('\0')) {
        return { ok: false, error: 'turn-1 payload contains a NUL byte and cannot be passed to the runtime.' };
    }

    const systemBytes = Buffer.byteLength(parts.systemPrompt, 'utf8');
    const bodyBytes = Buffer.byteLength(parts.body, 'utf8');
    const total = systemBytes + bodyBytes;
    if (parts.source === 'prompt' && total > LITERAL_TURN1_BYTE_CEILING) {
        return {
            ok: false,
            error: `literal turn-1 payload is ${total} bytes (systemPrompt + body); ceiling is ${LITERAL_TURN1_BYTE_CEILING}.\n`
                + 'Move large task context into a --bead or trim the literal prompt.',
        };
    }
    if (systemBytes > RUNTIME_ARG_BYTE_CEILING || bodyBytes > RUNTIME_ARG_BYTE_CEILING) {
        return {
            ok: false,
            error: `turn-1 runtime argument ceiling is ${RUNTIME_ARG_BYTE_CEILING} bytes; `
                + `systemPrompt=${systemBytes}, body=${bodyBytes}.`,
        };
    }
    return { ok: true };
}

export interface TmuxLaunchPlan {
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

/** Options shared verbatim by the role and bare plan builders. */
interface CommonTmuxPlanArgs {
    /** Which runtime binary this plan targets. */
    runtime: 'pi' | 'claude';
    bead?: string;
    parentSessionId: string;
    /** Absolute path of the worktree this session owns. Required, not optional:
     * "every interactive xt runtime owns a distinct worktree and branch" is an
     * invariant (audit P1-02), and a plan that could omit it would let one of
     * the two launch paths silently stop publishing lineage. */
    worktreePath: string;
    /** Branch checked out in `worktreePath` — the integration branch for any
     * specialist chain this session dispatches (audit P1-03). */
    branchName: string;
    /** Turn-1 positional body — runtime-specific trusted skill prefix + user
     * body already concatenated. Empty string means no positional (skills-only prime). */
    turn1Body: string;
    /** CLI --model override; in role mode it wins over role.model. */
    modelOverride?: string;
    /** CLI --thinking override; in role mode it wins over role.thinkingLevel.
     * Silently dropped for claude (no --thinking flag) — caller warns at CLI
     * level if the user explicitly passed --thinking to xt claude. */
    thinkingOverride?: string;
    /** Explicit --skill requests, already resolved to absolute paths.
     * Emitted verbatim to pi's native --skill flag. Claude has no --skill
     * equivalent; preflight verifies the exact path is discoverable, then the
     * launcher prepends a `/<name>` force-load line to turn 1. */
    explicitSkillPaths?: string[];
    /** Argv after `--` on the xt command line, already guard-checked. */
    passthrough?: string[];
}

/** Emit `--skill <path>` per unique skill, deduped by realpath. pi-only. */
function pushSkillArgs(runtimeArgs: string[], skillPaths: string[]): void {
    const seen = new Set<string>();
    for (const skill of skillPaths) {
        const identity = existsSync(skill) ? realpathSync(skill) : skill;
        if (seen.has(identity)) continue;
        seen.add(identity);
        runtimeArgs.push('--skill', skill);
    }
}

/**
 * Shared tail of both plan builders. Everything from `--model` onward is
 * identical between a role launch and a bare one — only the head (system
 * prompt, skill pool policy, session name, @agent_task) differs, which is
 * exactly what the two builders own. xtrm-3xgs5.
 */
function finalizeTmuxPlan(args: {
    runtime: 'pi' | 'claude';
    sessionName: string;
    /** Head args, mutated in place with the shared tail. */
    runtimeArgs: string[];
    agentTask: string;
    bead?: string;
    /** Role name in role mode; absent in bare mode (a bare session has no role). */
    role?: string;
    parentSessionId: string;
    worktreePath: string;
    branchName: string;
    turn1Body: string;
    model?: string;
    thinking?: string;
    passthrough?: string[];
}): TmuxLaunchPlan {
    const {
        runtime, sessionName, runtimeArgs, agentTask, bead, role, parentSessionId,
        worktreePath, branchName, turn1Body, model, thinking, passthrough,
    } = args;

    // Model: both runtimes accept --model <name>; pi and claude resolve their
    // own defaults when unset.
    if (model) runtimeArgs.push('--model', model);

    // Thinking: pi-only. Claude has no --thinking flag; silently drop when
    // the target is claude (caller warns at CLI-level if user was explicit).
    if (runtime === 'pi' && thinking) runtimeArgs.push('--thinking', thinking);

    // Passthrough: append verbatim (caller must have run guardRolePassthrough
    // first to reject xt-owned flags and drop batch-mode incompatibles).
    if (passthrough && passthrough.length > 0) {
        runtimeArgs.push(...passthrough);
    }

    // Turn-1 body: trusted skill prefix + operator/bead body, already
    // concatenated by the caller. Claude needs `--` to protect the positional
    // from variadic options (--model etc. can consume it otherwise); pi's
    // positional prompt convention is delimiter-free. Empty body means "no
    // positional" (skills-only prime — pane idles at first turn).
    if (turn1Body.length > 0) {
        if (runtime === 'claude') runtimeArgs.push('--');
        runtimeArgs.push(turn1Body);
    }

    const runtimeCmdString = [runtime, ...runtimeArgs].map(shellQuote).join(' ');

    // Pane metadata written on the target pane at launch time. Picker + safe-
    // send-pointer + handoff read these. @agent_state=idle so the picker sees
    // the pane immediately (the runtime's own agent-state hook won't fire
    // until the first turn). @agent_prompt_file dropped in xtrm-8zsi1 — the
    // launcher no longer materializes a prompt file (turn-1 is inline), and
    // downstream skills read the option absence-safely (|| true).
    //
    // @agent_worktree / @agent_branch make the P1-02 invariant *observable*
    // rather than merely true: the isolation was always enforced by
    // construction in launchWorktreeSession, but nothing downstream could see
    // which worktree or branch a pane owned. @agent_branch is also how a
    // coordinator tells its specialist chains which integration branch to
    // derive from (audit P1-03) — Core publishes it, Specialists consumes it.
    // @agent_role is the role identity that @agent_task only encoded as a
    // `role:` prefix; a plain key is what a nested-coordinator check can read.
    const paneOptions: Array<{ key: string; value: string }> = [
        { key: '@agent_parent_session', value: parentSessionId },
        { key: '@agent_task', value: agentTask },
        { key: '@agent_state', value: 'idle' },
        { key: '@agent_worktree', value: worktreePath },
        { key: '@agent_branch', value: branchName },
    ];
    if (bead) paneOptions.push({ key: '@agent_bead', value: bead });
    if (role) paneOptions.push({ key: '@agent_role', value: role });

    return { sessionName, runtimeCmd: runtime, runtimeArgs, runtimeCmdString, paneOptions };
}

export function buildRoleTmuxPlan(args: CommonTmuxPlanArgs & {
    role: ResolvedRole;
}): TmuxLaunchPlan {
    const {
        runtime, role, bead, parentSessionId, worktreePath, branchName, turn1Body,
        modelOverride, thinkingOverride, explicitSkillPaths = [], passthrough,
    } = args;

    // Include runtime in the session name so xt pi --role X --bead Y and
    // xt claude --role X --bead Y produce distinguishable sessions
    // (role-pi-X-Y vs role-claude-X-Y) instead of colliding on role-X-Y and
    // relying on xtmux-1lb.6's auto-suffix. Operator's mental model is one
    // pi + one claude flavor of the same specialist, not "the second one
    // gets a random hex". See xtmux-3h8.
    const roleSlug = slugifyForSession(role.name);
    const sessionName = bead
        ? `role-${runtime}-${roleSlug}-${slugifyForSession(bead)}`
        : `role-${runtime}-${roleSlug}`;

    // Inline system prompt on both runtimes (xtrm-8zsi1). The xtrm-osipt
    // stopgap's --file variants were needed only when injectSkillContents
    // (xtrm-14w28) fattened the prompt to ~70KB; sp render-skill-prefix now
    // forces skill body load via /skill:name at turn-1 so the identity
    // system prompt stays small enough to inline safely under the byte
    // guard.
    const runtimeArgs: string[] = ['--append-system-prompt', role.systemPrompt];

    if (runtime === 'pi') {
        // Role pool isolation: --no-skills disables pi's global skill-pool
        // auto-discovery. Combined with explicit --skill <path> per declared
        // + operator-requested skill, only the declared set is
        // reachable. Matches sp's forthcoming unitAI-0o3pv behavior; core
        // ships this now regardless of sp release timing (self-diagnosing
        // "skill not found" is a fine loud-fail surface). xtrm-8zsi1.
        runtimeArgs.push('--no-skills');
        pushSkillArgs(runtimeArgs, [...role.skillPaths, ...explicitSkillPaths]);
        // Extensions: trust pi's own discovery (~/.pi/agent/settings.json plus
        // any per-repo settings). Previously (PR #365) the launcher emitted
        // `--no-extensions -e <name>...` from a curated allow-list, but `pi -e`
        // takes a **filesystem path**, not a registry name — the launcher was
        // silently crashing pi on startup. Drop the policy; trust discovery.
        // See xtmux-3rs.
    } else {
        // Claude: no --no-skills equivalent exists (--bare is nuclear and
        // disables hooks/CLAUDE.md/OAuth). Accept partial isolation — global
        // ~/.claude/skills auto-discovery remains. Declared skills force-load
        // via sp-owned /<name> lines in the turn-1 body prefix; operator
        // --skill additions (explicitSkillPaths) are prepended as
        // /<name> in launchWorktreeSession composition before turn1Body
        // reaches this function. No --plugin-dir scaffold anymore.
        runtimeArgs.push('--dangerously-skip-permissions');
    }

    return finalizeTmuxPlan({
        runtime,
        sessionName,
        runtimeArgs,
        agentTask: `role:${role.name}`,
        bead,
        role: role.name,
        parentSessionId,
        worktreePath,
        branchName,
        turn1Body,
        // CLI override wins over the specialist default.
        model: modelOverride ?? role.model,
        thinking: thinkingOverride ?? role.thinkingLevel,
        passthrough,
    });
}

/**
 * Plan for a launch with no specialist behind it: `xt claude <name>
 * --prompt ...`. No system prompt, no skill-pool isolation policy, and no
 * bead in the session name — a bare session is identified by its worktree
 * slug alone (`<runtime>-<slug>`), with any --bead carried as pane/env
 * metadata only. xtrm-3xgs5 (was a nullable `role?` through the role
 * builder, PR #433).
 */
export function buildBareTmuxPlan(args: CommonTmuxPlanArgs & {
    /** Worktree/session slug — the sole identity of a bare session. */
    sessionSlug: string;
}): TmuxLaunchPlan {
    const {
        runtime, sessionSlug, bead, parentSessionId, worktreePath, branchName,
        turn1Body, modelOverride, thinkingOverride, explicitSkillPaths = [], passthrough,
    } = args;

    const runtimeArgs: string[] = [];
    if (runtime === 'pi') {
        // No --no-skills: a bare session has no declared skill set to isolate
        // to, so pi's global pool discovery stays on and explicit --skill
        // requests are additive.
        pushSkillArgs(runtimeArgs, explicitSkillPaths);
    } else {
        runtimeArgs.push('--dangerously-skip-permissions');
    }

    return finalizeTmuxPlan({
        runtime,
        sessionName: `${runtime}-${slugifyForSession(sessionSlug)}`,
        runtimeArgs,
        agentTask: `session:${sessionSlug}`,
        bead,
        parentSessionId,
        worktreePath,
        branchName,
        turn1Body,
        model: modelOverride,
        thinking: thinkingOverride,
        passthrough,
    });
}

/**
 * Environment variables exported to the pi/claude child process so scripts/
 * agent-state.sh (and the picker's own reads) can find the metadata without
 * an extra tmux query. Redundant with paneOptions on purpose — the launcher
 * writes options once at spawn (state=idle etc.), and env vars survive re-
 * execs the way pane options do not. xtmux-1lb.5.1.
 *
 * Derived from the plan's pane options rather than rebuilt from the same
 * inputs: the two carry identical lineage, and the previous hand-rolled pair
 * (one builder for role, an inline object literal for bare) is exactly the
 * shape that drifts when a field is added — as adding @agent_worktree /
 * @agent_branch / @agent_role would have. `@agent_state` is launcher-local
 * bookkeeping owned by the runtime's own hook after turn 1, so it is the one
 * option that does not become an env var.
 *
 * XTMUX_AGENT_PROMPT_FILE dropped in xtrm-8zsi1 — turn 1 has no file path,
 * and downstream consumers read the variable absence-safely.
 */
export function buildAgentEnv(
    paneOptions: ReadonlyArray<{ key: string; value: string }>,
): Record<string, string> {
    const env: Record<string, string> = {};
    for (const { key, value } of paneOptions) {
        if (key === '@agent_state') continue;
        env[`XTMUX_AGENT_${key.slice('@agent_'.length).toUpperCase()}`] = value;
    }
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

/**
 * Effective flags a `--subordinate` launch expands to.
 *
 * `--subordinate` is one verb for the canonical subordinate-coordinator launch
 * shape (audit P0-05). Inside $TMUX an interactive role launch otherwise
 * defaults to the *current* pane — correct when the operator wants this pane to
 * become the role, unsafe when spawning a subordinate, because it overwrites the
 * orchestrator's own @agent_* metadata and replaces the orchestrator process.
 * The safe shape was three flags the operator had to remember and compose:
 * `--new-session --no-attach --parent "$(tmux display-message -p '#{session_id}')"`.
 *
 * It expands to flags the launcher already understands rather than introducing a
 * third launch mode — deliberately, so there stays exactly one code path to
 * reason about. It does NOT imply "no worktree", "shared branch", or "direct
 * main integration": every interactive launch owns a distinct worktree and
 * branch regardless (audit P1-02), and that is enforced below by construction.
 */
export type SubordinateResolution =
    | { ok: true; newSession: true; attach: false; child: boolean }
    | { ok: false; error: string };

/**
 * Shape every subordinate rejection the same way: one line naming what was
 * wrong, then the canonical long-form command as remediation. Matches the error
 * the audit suggests in P1-05, parameterized by the runtime actually launching.
 */
export function subordinateRejection(runtime: 'pi' | 'claude', because: string): string {
    const canonical = [
        `  xt ${runtime} <name> \\`,
        '    --role chain-coordinator \\',
        '    --bead <id> \\',
        '    --new-session \\',
        '    --no-attach \\',
        '    --parent <session-id>',
    ].join('\n');
    return `subordinate launch rejected:\n  ${because}\n\nUse:\n${canonical}`;
}

// Pure — no I/O. Exported for unit testing.
export function resolveSubordinateLaunch(args: {
    runtime: 'pi' | 'claude';
    role?: string;
    bead?: string;
    parent?: string;
    insideTmux: boolean;
}): SubordinateResolution {
    const { runtime, role, bead, parent, insideTmux } = args;
    const reject = (because: string): SubordinateResolution => ({
        ok: false,
        error: subordinateRejection(runtime, because),
    });

    if (!role) {
        return reject('--subordinate is a coordinator launch and requires --role');
    }
    // Audit P1-05, "a bead is supplied". A coordinator's whole contract is "own
    // exactly one epic or task-group"; without a bead it has no scope to own and
    // nothing to report against. Only enforced for --subordinate — a plain
    // `--role` launch is an operator priming a pane and may legitimately idle.
    if (!bead) {
        return reject('--subordinate scopes a coordinator to one epic and requires --bead');
    }
    // A subordinate is defined by having a parent. Inside tmux the current
    // session supplies it; outside tmux there is nothing to infer from, so an
    // explicit --parent is the only way the relationship can exist at all.
    if (!insideTmux && !parent) {
        return reject('subordinate coordinator requires a parent session');
    }

    // `child` is the existing explicit opt-in for "parent = current session".
    // An explicit --parent is the operator being deliberate and still wins, so
    // only claim the auto-parent when they did not name one.
    return { ok: true, newSession: true, attach: false, child: !parent };
}

/**
 * The two P1-05 checks that need a resolved role and the launching pane's
 * identity, rather than just argv. Split from resolveSubordinateLaunch because
 * they run later — after `sp view` has answered — but still before any worktree
 * is created, so a rejected launch leaks nothing.
 *
 * Pure — no I/O. Exported for unit testing.
 */
export function checkSubordinateRole(args: {
    runtime: 'pi' | 'claude';
    role: ResolvedRole;
    /** @agent_role of the pane running the launcher, '' when absent. */
    launchingPaneRole: string;
}): { ok: true } | { ok: false; error: string } {
    const { runtime, role, launchingPaneRole } = args;

    // Tri-state: only an explicit `false` rejects. An older Specialists release
    // that does not declare `interactive` must stay launchable.
    if (role.interactive === false) {
        return {
            ok: false,
            error: subordinateRejection(
                runtime,
                `role '${role.name}' declares execution.interactive=false — it is a background job, not a session`,
            ),
        };
    }

    // "the role is not being launched by another chain coordinator". The
    // chain-coordinator system prompt already says "Don't spawn nested
    // chain-coordinators"; until @agent_role existed (xtrm-6hey0.2) that was
    // pure honour system. Compares the launching pane's role to the role being
    // launched, so it generalizes to any self-nesting coordinator rather than
    // hard-coding one specialist name.
    if (launchingPaneRole && launchingPaneRole === role.name) {
        return {
            ok: false,
            error: subordinateRejection(
                runtime,
                `nested coordinator: this pane is already running role '${launchingPaneRole}'`
                + ' — escalate to the main orchestrator instead of spawning a peer',
            ),
        };
    }

    return { ok: true };
}

/**
 * `@agent_role` of the pane the launcher was invoked from, or '' when there is
 * no tmux, no pane option, or tmux is unavailable. Absence is always benign:
 * these checks are launch guardrails, not a security boundary.
 */
function currentPaneRole(): string {
    if (!process.env.TMUX) return '';
    const r = spawnSync('tmux', ['display-message', '-p', '#{pane_id}'], {
        stdio: 'pipe', encoding: 'utf8',
    });
    const paneId = (r.stdout ?? '').trim();
    if (!paneId) return '';
    const option = spawnSync('tmux', ['show-options', '-p', '-t', paneId, '-qv', '@agent_role'], {
        stdio: 'pipe', encoding: 'utf8',
    });
    return (option.stdout ?? '').trim();
}

export async function launchWorktreeSession(opts: WorktreeSessionOptions): Promise<void> {
    const { runtime, name, role: roleName, bead, prompt, model, thinking } = opts;
    const cwd = process.cwd();

    // Runtime compatibility preflight (audit P1-06). First thing in the
    // launcher: reject an incompatible Core/Specialists/xtmux trio before any
    // worktree, branch or tmux session exists, and before `sp` — possibly the
    // incompatible half — is consulted at all. Repair commands (`xt update`,
    // `xt doctor`) are deliberately not gated, so a drifted install stays
    // fixable. Absence of a sibling is not an incompatibility; see
    // runtime-compat.ts.
    const compatError = runtimeCompatibilityError();
    if (compatError) {
        console.error(kleur.red(`\n  ✗ ${compatError}\n`));
        console.error(kleur.dim('  Refusing to create an interactive worktree against a runtime Core does not support.'));
        console.error(kleur.dim('\n  Remediation:'));
        console.error(kleur.dim('    1) upgrade the flagged package(s) to a version inside the range'));
        console.error(kleur.dim('    2) or upgrade xtrm-tools, if this Core predates them'));
        console.error(kleur.dim('    3) xt doctor — inspect the installed runtime'));
        console.error(kleur.dim('\n  Override (at your own risk): XTRM_SKIP_RUNTIME_COMPAT=1\n'));
        process.exit(1);
    }

    // Expand --subordinate before anything else so the rest of the launcher
    // only ever sees ordinary newSession/attach/parent flags.
    let { attach = true } = opts;
    let newSession = opts.newSession;
    let child = opts.child;
    if (opts.subordinate) {
        const subordinate = resolveSubordinateLaunch({
            runtime,
            role: roleName,
            bead,
            parent: opts.parent,
            insideTmux: Boolean(process.env.TMUX),
        });
        if (!subordinate.ok) {
            console.error(kleur.red(`\n  ✗ ${subordinate.error}\n`));
            process.exit(1);
        }
        newSession = subordinate.newSession;
        attach = subordinate.attach;
        child = subordinate.child;
    }

    // Mutual exclusion: in role mode --bead renders a tracked task and
    // --prompt supplies a literal turn-1 body; the two contract different
    // composition paths and can't stack. Rejected at the launcher rather than
    // each CLI so both xt pi and xt claude enforce the same rule from one
    // place. Bare mode is exempt: `sp render-task` takes the specialist name
    // as a required positional, so there is no roleless render and --bead is
    // metadata only (pane option + env + picker preview). A tag and a body
    // don't conflict. xtrm-3xgs5.
    if (roleName && bead && prompt) {
        console.error(kleur.red('\n  ✗ --bead and --prompt are mutually exclusive; pick one\n'));
        process.exit(1);
    }

    // Resolve role up-front so we fail fast on an unknown role name before
    // creating a worktree (which would otherwise leak on a bad --role typo).
    // Probe sp render-skill-prefix before worktree creation so every launch
    // can bind byte-zero slash commands to trusted renderer output.
    let resolvedRole: ResolvedRole | null = null;
    let renderedTask: RenderedRoleTask | undefined;
    let composedTurn1Body: string = '';
    let explicitSkillPaths: string[] = [];
    if (roleName) {
        try {
            resolvedRole = resolveRole(roleName, cwd, runtime, Boolean(model));

            // The P1-05 checks that need the resolved role. Placed immediately
            // after `sp view` answers and long before worktree creation, so a
            // rejected coordinator launch leaves nothing on disk.
            if (opts.subordinate) {
                const coordinatorCheck = checkSubordinateRole({
                    runtime,
                    role: resolvedRole,
                    launchingPaneRole: currentPaneRole(),
                });
                if (!coordinatorCheck.ok) throw new Error(coordinatorCheck.error);
            }

            resolvedRole.skillPaths = resolveRequestedSkills(cwd, resolvedRole.skillPaths);
            explicitSkillPaths = resolveRequestedSkills(cwd, opts.skills ?? []);
            if (runtime === 'claude') assertClaudeSkillsDiscoverable(cwd, explicitSkillPaths);

            // Prefer sp's canonical renderer. Older sp versions do not expose
            // render-skill-prefix, so derive the same block from trusted merged
            // role metadata instead of accepting task text that merely looks
            // like a slash command.
            const probe = probeSkillPrefixAvailable();
            const trustedSkillPrefix = probe.ok
                ? renderSkillPrefix({ role: roleName, runtime, cwd }).skillPrefix
                : renderDeclaredSkillPrefix(resolvedRole.skillPaths, runtime);
            let trustedPrefix = trustedSkillPrefix;

            const rawBody = bead
                ? (renderedTask = renderRoleTask({ role: roleName, bead, cwd, runtime })).initialPrompt
                : (prompt ?? '');
            let untrustedBody = rawBody;
            if (bead && probe.ok && trustedSkillPrefix) {
                if (!rawBody.startsWith(trustedSkillPrefix)) {
                    throw new Error('render-task output does not start with the exact trusted sp skill prefix.');
                }
                untrustedBody = rawBody.slice(trustedSkillPrefix.length);
            }
            // Provenance, not path. A bead-derived body carries a bead title
            // that any writer to the beads store can set, so a leading '/'
            // there is an impersonation attempt and stays rejected. An
            // operator-typed --prompt is the same trust level whether or not
            // --role is present — it is argv the operator typed on their own
            // terminal — so it is exempt here exactly as it is in bare mode.
            // This replaces the uniform check with the rule it was always
            // reaching for. xtrm-3xgs5 (see PR #439 for the bare half).
            if (bead) {
                const rawSlashCheck = checkPositionZeroSlash(untrustedBody, runtime, '');
                if (!rawSlashCheck.ok) throw new Error(rawSlashCheck.error);
            }
            composedTurn1Body = trustedSkillPrefix + untrustedBody;

            // Claude explicit --skill delivery is launcher-owned but still
            // derived only from validated, discoverable skill metadata.
            if (runtime === 'claude' && explicitSkillPaths.length > 0) {
                const explicitPrefix = `${claudeExplicitSkillLines(explicitSkillPaths)}${trustedPrefix ? '\n' : '\n\n'}`;
                composedTurn1Body = explicitPrefix + composedTurn1Body;
                trustedPrefix = explicitPrefix + trustedPrefix;
            }

            // Composition integrity: when a trusted prefix was assembled, the
            // composed body must start with exactly it — that assertion is
            // worth making whatever the body's provenance. With no trusted
            // prefix the check degenerates to the leading-'/' rule, which
            // only an untrusted bead-derived body needs. Both fire before
            // worktree creation.
            if (trustedPrefix || bead) {
                const slashCheck = checkPositionZeroSlash(composedTurn1Body, runtime, trustedPrefix);
                if (!slashCheck.ok) throw new Error(slashCheck.error);
            }

            // Literal prompts keep the conservative 50KB policy. Rendered
            // beads use the larger per-runtime-argument boundary so their full
            // dependency/rule context is not mistaken for literal input.
            const byteCheck = checkByteCeiling({
                systemPrompt: resolvedRole.systemPrompt,
                body: composedTurn1Body,
                source: bead ? 'bead' : 'prompt',
            });
            if (!byteCheck.ok) throw new Error(byteCheck.error);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(kleur.red(`\n  ✗ ${msg}\n`));
            process.exit(1);
        }
    } else {
        try {
            explicitSkillPaths = resolveRequestedSkills(cwd, opts.skills ?? []);
            composedTurn1Body = prompt ?? '';
            let trustedPrefix = '';

            if (runtime === 'claude' && explicitSkillPaths.length > 0) {
                assertClaudeSkillsDiscoverable(cwd, explicitSkillPaths);
                trustedPrefix = `${claudeExplicitSkillLines(explicitSkillPaths)}\n\n`;
                composedTurn1Body = trustedPrefix + composedTurn1Body;
            }

            // Bare-mode turn-1 body is entirely trusted at composition:
            // opts.prompt is operator-typed argv on their own terminal, and
            // trustedPrefix is launcher-generated from validated, discoverable
            // --skill args. --bead does not compose anything here (no roleless
            // `sp render-task`), so bare has no untrusted body source *by
            // construction* rather than by accident — which is what makes the
            // absent slash guard safe. A leading '/' in --prompt (e.g.
            // '/multiplexing ...') is the sanctioned way to load a skill on
            // turn 1. The role path keeps the guard on bead-derived bodies.
            // xtrm-8zsi1 follow-up; provenance rule finished in xtrm-3xgs5.
            const byteCheck = checkByteCeiling({
                systemPrompt: '',
                body: composedTurn1Body,
                source: 'prompt',
            });
            if (!byteCheck.ok) throw new Error(byteCheck.error);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(kleur.red(`\n  ✗ ${msg}\n`));
            process.exit(1);
        }
    }

    // Guard passthrough up-front — refuse xt-owned flags before we build any
    // worktree state. Skip-flags produce warnings but continue.
    let guardedPassthrough: string[] = [];
    if (opts.passthrough && opts.passthrough.length > 0) {
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

    // Reuse is resolved before any worktree, branch, or runtime scaffolding is
    // created. Otherwise a successful session reuse leaves the provisional
    // checkout orphaned behind.
    const reuseRequested = Boolean(opts.reuse) && (Boolean(newSession) || !process.env.TMUX);
    if (reuseRequested) {
        const roleSlug = resolvedRole ? slugifyForSession(resolvedRole.name) : null;
        const sessionName = roleSlug
            ? `role-${runtime}-${roleSlug}${bead ? `-${slugifyForSession(bead)}` : ''}`
            : `${runtime}-${slugifyForSession(slug)}`;
        const sessionExists = spawnSync('tmux', ['has-session', '-t', `=${sessionName}`], { stdio: 'pipe' }).status === 0;
        if (sessionExists) {
            const paneQuery = spawnSync('tmux', ['list-panes', '-t', sessionName, '-F', '#{pane_id}'], {
                stdio: 'pipe', encoding: 'utf8',
            });
            const existingPane = (paneQuery.stdout ?? '').trim().split('\n')[0] ?? '';
            if (!attach) {
                process.stdout.write(`${sessionName}:${existingPane}\n`);
                process.exit(0);
            }
            const attachResult = spawnSync('tmux', chooseAttachCommand(sessionName, Boolean(process.env.TMUX)), {
                stdio: 'inherit',
            });
            process.exit(attachResult.status ?? 0);
        }
    }

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

    // One decision, taken once: a role launch always needs the tmux path
    // (metadata, telemetry, buffered transport for the system prompt). A bare
    // launch needs it only when something has to be carried into the pane —
    // a turn-1 body, a runtime override, bead metadata, passthrough argv, or
    // a detached/forced-new session. A plain `xt claude <name>` with none of
    // those still gets a plain runtime in the current terminal. xtrm-3xgs5.
    const common = {
        runtime,
        sessionSlug: slug,
        bead,
        attach,
        worktreePath,
        branchName,
        modelOverride: model,
        thinkingOverride: thinking,
        turn1Body: composedTurn1Body,
        explicitSkillPaths,
        passthrough: guardedPassthrough,
        newSession,
        reuse: opts.reuse,
        parent: opts.parent,
        child,
    };

    if (resolvedRole) {
        await launchTmuxSession({ ...common, mode: 'role', role: resolvedRole, renderedTask });
        return; // launchTmuxSession never returns (calls process.exit)
    }

    const carriesLaunchState = Boolean(prompt) || Boolean(bead) || Boolean(model)
        || Boolean(thinking) || explicitSkillPaths.length > 0
        || guardedPassthrough.length > 0 || !attach || Boolean(newSession);
    if (carriesLaunchState) {
        await launchTmuxSession({ ...common, mode: 'bare' });
        return;
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

/**
 * Launch args. The role/bare distinction is carried in the type rather than
 * in a nullable `role?` plus a pile of `role?.x` reads — a bare launch simply
 * has no role to speak of, and the union makes that unrepresentable rather
 * than merely undefined. xtrm-3xgs5.
 */
type TmuxLaunchArgs = {
    runtime: 'pi' | 'claude';
    sessionSlug: string;
    bead?: string;
    attach: boolean;
    worktreePath: string;
    branchName: string;
    modelOverride?: string;
    thinkingOverride?: string;
    /** Composed turn-1 positional body (sp prefix + user body). Empty = skills-only prime. */
    turn1Body: string;
    explicitSkillPaths?: string[];
    passthrough?: string[];
    newSession?: boolean;
    parent?: string;
    child?: boolean;
    reuse?: boolean;
} & (
    | {
        mode: 'role';
        role: ResolvedRole;
        /** render-task metadata for telemetry only (turn1Body owns the actual body). */
        renderedTask?: RenderedRoleTask;
    }
    | { mode: 'bare' }
);

async function launchTmuxSession(args: TmuxLaunchArgs): Promise<never> {
    const {
        runtime, sessionSlug, bead, attach, worktreePath, branchName, modelOverride, thinkingOverride, turn1Body, explicitSkillPaths = [], passthrough,
        newSession, parent, child, reuse,
    } = args;

    const insideTmux = Boolean(process.env.TMUX);
    // Current-pane mode: inside $TMUX with no explicit --new-session. This is
    // the new default — matches operator intent "if i'm in tmux and want a
    // role, launch it in this pane and that's that." Outside $TMUX the only
    // sensible thing is still `tmux new-session`, so mode collapses to
    // new-session there regardless of --new-session. xtmux-1lb.5.1.
    const currentPaneMode = insideTmux && !newSession && (args.mode === 'role' || attach);

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

    // Fileless transport within a trusted same-user control plane. Current-pane
    // mode passes argv directly; the role new-session path uses a transient
    // tmux buffer to keep a 50-1000KB system prompt off the command line.
    // Prompts/beads are not credential storage, and same-server tmux peers are
    // trusted to inspect or control the session.

    const planCommon = {
        runtime, bead, parentSessionId, worktreePath, branchName, turn1Body,
        modelOverride, thinkingOverride, explicitSkillPaths, passthrough,
    };
    const plan = args.mode === 'role'
        ? buildRoleTmuxPlan({ ...planCommon, role: args.role })
        : buildBareTmuxPlan({ ...planCommon, sessionSlug });

    const agentEnv = buildAgentEnv(plan.paneOptions);

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

        const previousInstanceId = bead
            ? (spawnSync('tmux', ['show-options', '-p', '-t', paneId, '-qv', '@agent_instance_id'], {
                encoding: 'utf8', stdio: 'pipe',
            }).stdout ?? '').trim()
            : '';
        for (const { key, value } of plan.paneOptions) {
            spawnSync('tmux', ['set-option', '-p', '-t', paneId, key, value], { stdio: 'pipe' });
        }

        if (args.mode === 'role') {
            emitAgentRoleLaunched({
                pane: paneId,
                session: currentTmuxSessionId(),
                bead: bead ?? '',
                role: args.role.name,
                parent: parentSessionId,
                worktree: worktreePath,
                branch: branchName,
                task_prompt_renderer: args.renderedTask ? 'success' : 'not_requested',
                task_prompt_hash: args.renderedTask?.promptHash ?? '',
                task_prompt_components: args.renderedTask ? JSON.stringify(args.renderedTask.components) : '',
            });
        }

        if (!bead) {
            const runtimeResult = spawnSync(plan.runtimeCmd, plan.runtimeArgs, {
                cwd: worktreePath,
                stdio: 'inherit',
                env: { ...process.env, ...agentEnv },
            });
            process.exit(runtimeResult.status ?? 0);
        }

        const runtimeProcess = spawn(plan.runtimeCmd, plan.runtimeArgs, {
            cwd: worktreePath,
            stdio: 'inherit',
            env: { ...process.env, ...agentEnv },
        });
        const runtimeExit = new Promise<number>((resolve) => {
            runtimeProcess.once('error', () => resolve(1));
            runtimeProcess.once('exit', code => resolve(code ?? 1));
        });
        await assignBeadToRuntime(bead, runtime, paneId, worktreePath, previousInstanceId);
        process.exit(await runtimeExit);
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

    // Transport. The buffered handshake exists so a 50-1000KB role system
    // prompt never has to fit on a command line: tmux starts a consumer
    // wrapper, we hand it the payload through a transient buffer, and it
    // execs the runtime. A bare launch has no system prompt at all and its
    // turn-1 body is already bounded by the 50KB literal ceiling
    // (checkByteCeiling source:'prompt') — the very constant tmux's own
    // command-length limit motivated. So bare hands tmux the shell-quoted
    // command line directly, exactly as current-pane mode already hands argv
    // to spawnSync, and skips four sync-points and a wrapper subprocess.
    // xtrm-3xgs5.
    let runtimeBuffer: string | null = null;
    const cleanupOnSignal = (): void => {
        if (runtimeBuffer) deleteRuntimeBuffer(runtimeBuffer);
        spawnSync('tmux', ['kill-session', '-t', plan.sessionName], { stdio: 'ignore' });
        process.exit(1);
    };
    process.once('SIGINT', cleanupOnSignal);
    process.once('SIGTERM', cleanupOnSignal);
    process.once('SIGHUP', cleanupOnSignal);

    const failNewSession = (stderr: string): never => {
        if (runtimeBuffer) deleteRuntimeBuffer(runtimeBuffer);
        process.stderr.write(kleur.red(`\n  ✗ tmux new-session failed: ${stderr || 'unknown error'}\n`));
        process.exit(1);
    };

    if (args.mode === 'bare') {
        const newSess = spawnSync('tmux', [
            'new-session', '-d',
            '-s', plan.sessionName,
            '-c', worktreePath,
            ...envArgs,
            plan.runtimeCmdString,
        ], { stdio: 'pipe', encoding: 'utf8' });
        if (newSess.status !== 0) failNewSession((newSess.stderr ?? '').trim());
    } else {
        runtimeBuffer = createRuntimeBufferName();
        const newSess = spawnSync('tmux', [
            'new-session', '-d',
            '-s', plan.sessionName,
            '-c', worktreePath,
            ...envArgs,
            buildBufferedRuntimeCommand(runtimeBuffer),
        ], { stdio: 'pipe', encoding: 'utf8' });
        if (newSess.status !== 0) failNewSession((newSess.stderr ?? '').trim());

        const consumerReady = spawnSync('tmux', ['wait-for', `${runtimeBuffer}-consumer-ready`], {
            stdio: 'pipe',
            encoding: 'utf8',
            timeout: TMUX_CONSUMER_READY_TIMEOUT_MS,
            killSignal: 'SIGTERM',
        });
        if (consumerReady.status !== 0) {
            deleteRuntimeBuffer(runtimeBuffer);
            spawnSync('tmux', ['kill-session', '-t', plan.sessionName], { stdio: 'ignore' });
            const stderr = (consumerReady.stderr ?? consumerReady.error?.message ?? '').trim() || 'consumer readiness timed out';
            process.stderr.write(kleur.red(`\n  ✗ tmux prompt consumer failed to become ready: ${stderr}\n`));
            process.exit(1);
        }

        const bufferedPayload = JSON.stringify({
            runtimeCmd: plan.runtimeCmd,
            runtimeArgs: plan.runtimeArgs,
        });
        const loaded = spawnSync('tmux', ['load-buffer', '-b', runtimeBuffer, '-'], {
            input: bufferedPayload,
            stdio: ['pipe', 'pipe', 'pipe'],
            encoding: 'utf8',
        });
        const signaled = loaded.status === 0
            ? spawnSync('tmux', ['wait-for', '-S', `${runtimeBuffer}-ready`], { stdio: 'pipe', encoding: 'utf8' })
            : null;
        if (loaded.status !== 0 || signaled?.status !== 0) {
            deleteRuntimeBuffer(runtimeBuffer);
            spawnSync('tmux', ['kill-session', '-t', plan.sessionName], { stdio: 'ignore' });
            const stderr = ((loaded.stderr ?? signaled?.stderr) as string | undefined)?.trim() || 'unknown error';
            process.stderr.write(kleur.red(`\n  ✗ tmux prompt transport failed: ${stderr}\n`));
            process.exit(1);
        }
    }

    const paneQuery = spawnSync('tmux', [
        'list-panes', '-t', plan.sessionName, '-F', '#{pane_id}',
    ], { stdio: 'pipe', encoding: 'utf8' });
    const paneId = (paneQuery.stdout ?? '').trim().split('\n')[0] ?? '';
    if (!paneId) {
        if (runtimeBuffer) deleteRuntimeBuffer(runtimeBuffer);
        spawnSync('tmux', ['kill-session', '-t', plan.sessionName], { stdio: 'ignore' });
        process.stderr.write(kleur.red('\n  ✗ Could not resolve pane id for new session\n'));
        process.exit(1);
    }

    process.off('SIGINT', cleanupOnSignal);
    process.off('SIGTERM', cleanupOnSignal);
    process.off('SIGHUP', cleanupOnSignal);

    for (const { key, value } of plan.paneOptions) {
        spawnSync('tmux', ['set-option', '-p', '-t', paneId, key, value], { stdio: 'pipe' });
    }
    if (bead) await assignBeadToRuntime(bead, runtime, paneId, worktreePath);

    if (args.mode === 'role') {
        emitAgentRoleLaunched({
            pane: paneId,
            session: plan.sessionName,
            bead: bead ?? '',
            role: args.role.name,
            parent: parentSessionId,
            worktree: worktreePath,
            branch: branchName,
            task_prompt_renderer: args.renderedTask ? 'success' : 'not_requested',
            task_prompt_hash: args.renderedTask?.promptHash ?? '',
            task_prompt_components: args.renderedTask ? JSON.stringify(args.renderedTask.components) : '',
        });
    }

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
