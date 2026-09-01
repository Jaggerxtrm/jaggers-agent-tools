import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import kleur from 'kleur';
import crypto from 'node:crypto';
import { resolvePackageRoot } from './registry-scaffold.js';

/**
 * Ownership-safe synchronizer for the xtrm global system-prompt blocks
 * (xtrm-3ljgz.2, xtrm-j8kcj.9).
 *
 * Manages one named block inside the native global prompt files:
 *   - ~/.pi/agent/APPEND_SYSTEM.md
 *   - ~/.claude/CLAUDE.md
 *
 * Contract:
 *   - The command-chaining block is Core-owned and is identified by its
 *     dedicated named marker pair (<!-- xtrm:global-prompt:command-chaining:... -->).
 *     Sync updates only that block's body to the canonical body.
 *   - Every other xtrm:global-prompt block (unnamed or other-named) is
 *     operator-owned and is preserved byte-identical, along with all bytes
 *     outside every marker pair.
 *   - Migration: an unnamed block whose first line matches the canonical
 *     command-chaining heading is converted once into the named owned form.
 *     This is how the current four-unnamed-block file (the command-chaining
 *     block plus operator blocks) converges safely.
 *   - A markerless file whose trimmed content is the canonical body or the
 *     legacy whole-file body is replaced in full — the legacy file migrates
 *     into the marked form without duplication.
 *   - Sync fails closed ONLY on malformed ownership of the owned block
 *     (duplicate/orphan/out-of-order owned markers) or on ambiguous
 *     command-chaining candidates. Unknown/operator blocks never fail and are
 *     never touched. Non-regular/symlink targets fail closed.
 *   - Writes are atomic (same-directory temp + rename), preserve the target
 *     mode, are preceded by a fresh re-read (concurrent-change defense) and
 *     by a backup under ~/.xtrm/migration-backups.
 *   - Prompt bodies are never logged — only paths, actions, and sizes.
 */

/** Name of the Core-owned command-chaining block. */
export const GLOBAL_PROMPT_OWNED_NAME = 'command-chaining';

/** Generic marker pair used by operator-owned (unknown) blocks. Never rewritten. */
export const GLOBAL_PROMPT_START_MARKER = '<!-- xtrm:global-prompt:start -->';
export const GLOBAL_PROMPT_END_MARKER = '<!-- xtrm:global-prompt:end -->';

/** Named marker pair identifying the Core-owned command-chaining block. */
export const OWNED_GLOBAL_PROMPT_START_MARKER = `<!-- xtrm:global-prompt:${GLOBAL_PROMPT_OWNED_NAME}:start -->`;
export const OWNED_GLOBAL_PROMPT_END_MARKER = `<!-- xtrm:global-prompt:${GLOBAL_PROMPT_OWNED_NAME}:end -->`;

/**
 * The pre-marker whole-file body that the very first sync must migrate
 * without duplication: the unmarked APPEND_SYSTEM.md as shipped before this
 * feature (still carrying the python sentences the kernel tool owns today).
 * Kept as an explicit, frozen migration constant — update only when a legacy
 * migration genuinely needs a second shape.
 *
 * This whole-file shape is matched only when the target has no markers at
 * all; it produces the named owned block.
 */
export const LEGACY_GLOBAL_PROMPT_BODY = `Programmatic tool calling and command chaining:

When a task needs several independent operations, run them in one bash call or one python cell instead of one model round trip per operation. Batch, filter, and aggregate inside the call so only the answer reaches the context window.

- Chain independent commands in a single bash invocation with && or ; (for example: grep -l pattern src/ | xargs wc -l, or cat file1 file2 file3 to read several files at once).
- Loop in the shell for fan-out work (for example: for d in */; do ...; done) instead of repeating tool calls one by one.
- Filter and summarize before reporting: pipe through grep, head, wc, sort, or jq; return counts, top-N, and matching lines rather than raw dumps, unless the user asked for full output.
- Prefer the python tool for multi-step processing, parsing, aggregation, and fan-out: one cell replaces many round trips, and named variables persist across cells. When the python tool is unavailable, one python3 -c or heredoc run replaces many round trips.
- python state (variables, imports, functions) persists across calls until reset: true; pass reset when the scratch namespace is no longer needed. os.chdir() inside a cell persists; reset returns to the working directory.
- Keep dependent steps sequential when a later command must be decided from an earlier result; for the python tool, state carries between sequential calls.
- Batch independent work into one call.
- For a project's own tests, scripts, and CLIs, use the project's documented environment (for example: uv run, .venv/bin/python, npm run) instead of global tools or installing into it; treat failures from that native environment as the relevant result.
- Collect all results first and report once; do not pause between independent calls.
- Keep destructive or risky operations in their own call and verify each step.
- Use ; instead of && when you must see partial output after a failure.`;

export class GlobalPromptSyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GlobalPromptSyncError';
  }
}

export type ManagedPromptAction = 'create' | 'replace-whole-file' | 'replace-block' | 'prepend' | 'unchanged';

export interface ManagedPromptRenderResult {
  next: string;
  action: ManagedPromptAction;
}

// Matches any xtrm:global-prompt marker on raw content, named or unnamed. For
// a named marker group 1 is the name (e.g. command-chaining) and group 2 is
// start/end; unnamed markers leave the name group empty. Anchored structure —
// no nested quantifiers, so no ReDoS surface.
const MARKER_RE = /<!--\s*xtrm:global-prompt(?::([a-z0-9_-]+))?:(start|end)\s*-->/g;

interface Marker {
  /** Offset of the leading `<!--`. */
  begin: number;
  /** Offset just past the trailing `-->`. */
  end: number;
  name: string | null;
  dir: 'start' | 'end';
}

interface Block {
  start: Marker;
  end: Marker;
}

function parseMarkers(content: string): Marker[] {
  const markers: Marker[] = [];
  MARKER_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MARKER_RE.exec(content)) !== null) {
    markers.push({
      begin: match.index,
      end: match.index + match[0].length,
      name: match[1] ?? null,
      dir: match[2] as 'start' | 'end',
    });
  }
  return markers;
}

// Pair markers into flat, non-overlapping blocks. Returns null when the marker
// structure is ambiguous or malformed: an orphan end, an orphan/nested start,
// or a mismatched start/end name pair (overlap). Used ONLY to decide whether
// migration may safely claim an unnamed block; it never touches content.
function pairBlocks(markers: readonly Marker[]): Block[] | null {
  if (markers.length === 0) return [];
  const blocks: Block[] = [];
  const stack: Marker[] = [];
  for (const mk of markers) {
    if (mk.dir === 'start') {
      if (stack.length > 0) return null; // nested start — not a flat block layout
      stack.push(mk);
    } else {
      const top = stack.pop();
      if (!top) return null; // orphan end
      if (top.name !== mk.name) return null; // mismatched / overlapping pair
      blocks.push({ start: top, end: mk });
    }
  }
  if (stack.length > 0) return null; // orphan start
  return blocks;
}

// Reassemble with the file's dominant EOL so CRLF targets keep their line
// endings and idempotence holds at the byte level (xtrm-3ljgz.2 review fix).
function resolveEol(content: string): '\r\n' | '\n' {
  return content.includes('\r\n') ? '\r\n' : '\n';
}

function buildOwnedBlock(eol: string, body: string): string {
  return `${OWNED_GLOBAL_PROMPT_START_MARKER}${eol}${body.trim()}${eol}${OWNED_GLOBAL_PROMPT_END_MARKER}`;
}

// Normalized (CRLF→LF, trimmed) body of the span between two markers. Used for
// ownership comparisons only; output preserves original bytes.
function blockBody(content: string, start: Marker, end: Marker): string {
  return content.slice(start.end, end.begin).replace(/\r\n/g, '\n').trim();
}

// Exact complete-body ownership: an unnamed block is claimed for migration
// only when its whole normalized body equals the canonical body or an explicit
// legacy allowlist entry. A customized same-heading block never matches and
// stays untouched (Core's named block is then prepended instead).
function isOwnedBody(content: string, start: Marker, end: Marker, body: string, legacyBodies: readonly string[]): boolean {
  const candidate = blockBody(content, start, end);
  if (candidate === body) return true;
  return legacyBodies.some((legacy) => candidate === legacy.trim().replace(/\r\n/g, '\n'));
}

export function renderManagedGlobalPrompt(
  content: string,
  canonicalBody: string,
  legacyBodies: readonly string[] = [LEGACY_GLOBAL_PROMPT_BODY],
): ManagedPromptRenderResult {
  const body = canonicalBody.trim();
  const eol = resolveEol(content);
  const ownedBlock = buildOwnedBlock(eol, body);
  // Replaced spans are re-emitted from these markers; every byte outside a
  // replaced span is copied from `content` verbatim (mixed-EOL safe).
  const markers = parseMarkers(content);

  // 1) Owned (command-chaining) block present? Fail closed only on malformed
  //    ownership of this exact block — never on unknown/operator blocks.
  const ownedStarts = markers.filter((m) => m.name === GLOBAL_PROMPT_OWNED_NAME && m.dir === 'start');
  const ownedEnds = markers.filter((m) => m.name === GLOBAL_PROMPT_OWNED_NAME && m.dir === 'end');
  if (ownedStarts.length === 1 && ownedEnds.length === 1 && ownedStarts[0].begin < ownedEnds[0].begin) {
    const { start, end } = { start: ownedStarts[0], end: ownedEnds[0] };
    const next = `${content.slice(0, start.begin)}${ownedBlock}${content.slice(end.end)}`;
    return { next, action: next === content ? 'unchanged' : 'replace-block' };
  }
  if (ownedStarts.length > 0 || ownedEnds.length > 0) {
    throw new GlobalPromptSyncError(
      `malformed managed (${GLOBAL_PROMPT_OWNED_NAME}) block: ` +
        `${ownedStarts.length} start / ${ownedEnds.length} end markers (duplicate, orphan, or out-of-order)`,
    );
  }

  // 2) No owned block. If any markers exist, structurally validate them before
  //    considering migration so a nested/overlapped/orphaned layout cannot be
  //    mis-claimed (actionable ambiguity rather than a wrong replacement).
  if (markers.length > 0) {
    const blocks = pairBlocks(markers);
    if (!blocks) {
      throw new GlobalPromptSyncError(
        `ambiguous prompt-block structure: nested, overlapping, or orphaned xtrm:global-prompt markers; refusing to claim any block`,
      );
    }
    const candidates = blocks.filter((b) => b.start.name === null && isOwnedBody(content, b.start, b.end, body, legacyBodies));
    if (candidates.length === 1) {
      const { start, end } = candidates[0];
      const next = `${content.slice(0, start.begin)}${ownedBlock}${content.slice(end.end)}`;
      return { next, action: next === content ? 'unchanged' : 'replace-block' };
    }
    if (candidates.length > 1) {
      throw new GlobalPromptSyncError(
        `ambiguous ownership: ${candidates.length} unnamed command-chaining blocks match exactly; refusing to migrate`,
      );
    }
    // No exact candidate: operator blocks (possibly a customized same-heading
    // command-chaining block) are preserved byte-identical and the Core-owned
    // named block is prepended. Operator monitor-line edits survive untouched;
    // their disposition stays an open operator decision.
    return { next: `${ownedBlock}${eol}${eol}${content}`, action: 'prepend' };
  }

  // 3) No markers at all — create / replace-whole-file / prepend. Content is
  //    normalized only for the whole-file comparison; output uses the original
  //    bytes and dominant EOL.
  const normalized = content.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return { next: `${ownedBlock}${eol}`, action: 'create' };
  }
  if (normalized === body || legacyBodies.some((legacy) => normalized === legacy.trim().replace(/\r\n/g, '\n'))) {
    return { next: `${ownedBlock}${eol}`, action: 'replace-whole-file' };
  }
  return { next: `${ownedBlock}${eol}${eol}${content}`, action: 'prepend' };
}

export interface GlobalPromptTarget {
  label: string;
  file: string;
}

export interface GlobalPromptTargetResult {
  label: string;
  file: string;
  action: ManagedPromptAction;
  changed: boolean;
  dryRun?: boolean;
}

export interface GlobalPromptSyncResult {
  targets: GlobalPromptTargetResult[];
}

export interface GlobalPromptSyncOptions {
  dryRun?: boolean;
  /** Test seam; defaults to the real package asset. */
  canonicalBody?: string;
  /** Test seam; defaults to os.homedir(). */
  home?: string;
  /** Test seam; defaults to <home>/.pi/agent. */
  agentDir?: string;
  /** Test seam; defaults to <home>/.claude. */
  claudeDir?: string;
  /** Internal test hook fired after the plan, before the write. */
  _beforeWrite?: () => void | Promise<void>;
}

export function resolveGlobalPromptTargets(opts: GlobalPromptSyncOptions = {}): GlobalPromptTarget[] {
  const home = opts.home ?? os.homedir();
  return [
    {
      label: 'pi',
      // PI_AGENT_DIR keeps CI/smoke runs (and the real runtime) pointing at
      // the same agent tree the rest of pi-runtime uses — never the real
      // home during tests.
      file: path.join(opts.agentDir ?? process.env.PI_AGENT_DIR ?? path.join(home, '.pi', 'agent'), 'APPEND_SYSTEM.md'),
    },
    {
      label: 'claude',
      file: path.join(opts.claudeDir ?? path.join(home, '.claude'), 'CLAUDE.md'),
    },
  ];
}

export async function readCanonicalGlobalPromptBody(): Promise<string> {
  const assetPath = path.join(resolvePackageRoot(), '.xtrm', 'config', 'instructions', 'global-system-prompt.md');
  try {
    return await fs.readFile(assetPath, 'utf8');
  } catch (error) {
    throw new GlobalPromptSyncError(`cannot read canonical global prompt asset ${assetPath}: ${(error as Error).message}`);
  }
}

interface PlannedTarget {
  base: { label: string; file: string };
  original: string | null;
  mode: number | undefined;
  rendered: ManagedPromptRenderResult;
}

// Plan phase: read + validate the target and render its next state. Throws on
// a local failure (symlink/non-regular/unreadable) or on malformed owned-block
// ownership. COMMITS NOTHING — a later target failing here must leave every
// earlier planned target untouched (atomic preflight).
async function planTarget(target: GlobalPromptTarget, canonicalBody: string): Promise<PlannedTarget> {
  const base = { label: target.label, file: target.file };
  let original: string | null = null;
  let mode: number | undefined;
  try {
    const stat = await fs.lstat(target.file);
    if (stat.isSymbolicLink()) {
      throw new GlobalPromptSyncError(`${target.label}: ${target.file} is a symlink — refusing to sync`);
    }
    if (!stat.isFile()) {
      throw new GlobalPromptSyncError(`${target.label}: ${target.file} is not a regular file — refusing to sync`);
    }
    mode = stat.mode;
    original = await fs.readFile(target.file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      original = null;
    } else if (error instanceof GlobalPromptSyncError) {
      throw error;
    } else {
      throw new GlobalPromptSyncError(`${target.label}: cannot read ${target.file}: ${(error as Error).message}`);
    }
  }
  const rendered = renderManagedGlobalPrompt(original ?? '', canonicalBody);
  return { base, original, mode, rendered };
}

// Commit phase: applied only after every target has planned successfully.
async function commitTarget(planned: PlannedTarget, opts: GlobalPromptSyncOptions): Promise<GlobalPromptTargetResult> {
  const { base, original, mode, rendered } = planned;
  if (rendered.action === 'unchanged') {
    return { ...base, action: 'unchanged', changed: false };
  }
  if (opts.dryRun) {
    return { ...base, action: rendered.action, changed: true, dryRun: true };
  }

  // Concurrent-change defense: the file must be byte-identical to the content
  // we planned against, otherwise a writer raced us and we must not clobber it.
  if (original !== null) {
    const current = await fs.readFile(base.file, 'utf8');
    if (current !== original) {
      throw new GlobalPromptSyncError(
        `${base.label}: ${base.file} changed during sync — refusing to write (concurrent modification)`,
      );
    }
  }

  await opts._beforeWrite?.();

  if (original !== null) {
    const backupDir = path.join(opts.home ?? os.homedir(), '.xtrm', 'migration-backups');
    await fs.ensureDir(backupDir);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- label is a closed allowlist and the timestamp is generated.
    await fs.copyFile(base.file, path.join(backupDir, `global-prompt-${base.label}-${stamp}.md`));
  }

  const parentDir = path.dirname(base.file);
  await fs.ensureDir(parentDir);
  const tmpPath = path.join(parentDir, `.${path.basename(base.file)}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
  try {
    await fs.writeFile(tmpPath, rendered.next, { encoding: 'utf8', mode: mode ?? 0o644 });
    await fs.rename(tmpPath, base.file);
  } catch (error) {
    await fs.remove(tmpPath).catch(() => undefined);
    throw new GlobalPromptSyncError(`${base.label}: write to ${base.file} failed: ${(error as Error).message}`);
  }

  return { ...base, action: rendered.action, changed: true };
}

/**
 * Synchronize both global prompt targets exactly once per invocation.
 * Callers are responsible for invoking this once per command, never once per
 * repo (xtrm-3ljgz.2).
 *
 * Both targets are planned (read + rendered) before either is written, so a
 * malformed second target fails during preflight and leaves BOTH unchanged.
 */
export async function syncGlobalPrompts(opts: GlobalPromptSyncOptions = {}): Promise<GlobalPromptSyncResult> {
  const canonicalBody = opts.canonicalBody ?? await readCanonicalGlobalPromptBody();
  const targets = resolveGlobalPromptTargets(opts);
  // Phase A: plan every target. A validation/render error here stops the sync
  // before any write.
  const planned: PlannedTarget[] = [];
  for (const target of targets) {
    planned.push(await planTarget(target, canonicalBody));
  }
  // Phase B: commit every planned target.
  const results: GlobalPromptTargetResult[] = [];
  for (const plannedTarget of planned) {
    results.push(await commitTarget(plannedTarget, opts));
  }
  return { targets: results };
}

export function printGlobalPromptSyncSummary(result: GlobalPromptSyncResult): void {
  const changed = result.targets.filter((target) => target.changed);
  if (changed.length === 0) return;
  console.log(kleur.bold('\n  Global system-prompt sync'));
  for (const target of changed) {
    const verb = target.dryRun ? `[DRY RUN] would ${target.action}` : target.action;
    console.log(kleur.dim(`  • ${target.label}: ${verb} ${target.file}`));
  }
}
