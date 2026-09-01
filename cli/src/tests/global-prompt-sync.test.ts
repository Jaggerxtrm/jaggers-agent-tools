import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GLOBAL_PROMPT_END_MARKER as END,
  GLOBAL_PROMPT_START_MARKER as START,
  GlobalPromptSyncError,
  OWNED_GLOBAL_PROMPT_END_MARKER as OWNED_END,
  OWNED_GLOBAL_PROMPT_START_MARKER as OWNED_START,
  renderManagedGlobalPrompt,
  syncGlobalPrompts,
} from '../core/global-prompt-sync.js';

// Frozen copy of the pre-marker APPEND_SYSTEM.md body (as it ships today) so
// the legacy-migration behavior is tested against the real historical shape,
// not against whatever the module constant happens to say.
const LEGACY_BODY = `Programmatic tool calling and command chaining:

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

const CANONICAL = `Programmatic tool calling and command chaining:

When a task needs several independent operations, run them in one bash call or one tool call instead of one model round trip per operation. Batch, filter, and aggregate inside the call so only the answer reaches the context window.

- Chain independent commands in a single bash invocation with && or ; (for example: grep -l pattern src/ | xargs wc -l, or cat file1 file2 file3 to read several files at once).
- Loop in the shell for fan-out work (for example: for d in */; do ...; done) instead of repeating tool calls one by one.
- Filter and summarize before reporting: pipe through grep, head, wc, sort, or jq; return counts, top-N, and matching lines rather than raw dumps, unless the user asked for full output.
- Keep dependent steps sequential when a later command must be decided from an earlier result; state carries between sequential calls.
- Batch independent work into one call.
- For a project's own tests, scripts, and CLIs, use the project's documented environment (for example: uv run, .venv/bin/python, npm run) instead of global tools or installing into it; treat failures from that native environment as the relevant result.
- Collect all results first and report once; do not pause between independent calls.
- Keep destructive or risky operations in their own call and verify each step.
- Use ; instead of && when you must see partial output after a failure.`;

// The Core-owned block: identified by its named marker pair.
const OWNED_BLOCK = `${OWNED_START}\n${CANONICAL.trim()}\n${OWNED_END}`;

// A generic operator-owned (unmatched) block with the unnamed markers.
function opBlock(body: string): string {
  return `${START}\n${body}\n${END}`;
}

// A block of operator content WITHOUT marker comments (plain prose in the file).
const OP_AST_GREP = `Structural code search (ast_grep):
- For code-shape queries prefer the ast_grep tool over text grep.`;
const OP_PROBE = `Probe, kernel, and forensics guidance (coding sessions):
- Reach for a REPL/kernel probe when the task has a loop-with-a-decision.`;

const FOUR_BLOCK = [
  opBlock(CANONICAL.trim()),
  opBlock(OP_AST_GREP),
  opBlock(OP_PROBE),
  `${START}\n# Repo-scoped knowledge: service-knowledge, commits, and bd memories\n${END}`,
].join('\n\n');

let tempRoot = '';
let previousHome: string | undefined;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'xtrm-global-prompt-'));
  previousHome = process.env.HOME;
  process.env.HOME = path.join(tempRoot, 'home');
});

afterEach(async () => {
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  await fs.remove(tempRoot);
  vi.restoreAllMocks();
});

function opts(extra: Record<string, unknown> = {}) {
  return {
    canonicalBody: CANONICAL,
    home: process.env.HOME,
    ...extra,
  };
}

describe('renderManagedGlobalPrompt', () => {
  it('creates a named owned block for empty content', () => {
    const result = renderManagedGlobalPrompt('', CANONICAL);
    expect(result.action).toBe('create');
    expect(result.next).toBe(`${OWNED_BLOCK}\n`);
  });

  it('replaces the legacy whole-file body without duplication', () => {
    const result = renderManagedGlobalPrompt(`${LEGACY_BODY}\n`, CANONICAL);
    expect(result.action).toBe('replace-whole-file');
    expect(result.next).toBe(`${OWNED_BLOCK}\n`);
    expect(result.next).not.toContain('one python cell');
    expect(result.next).not.toContain('os.chdir');
  });

  it('normalizes an unmarked canonical body into the named owned form', () => {
    const result = renderManagedGlobalPrompt(`${CANONICAL}`, CANONICAL);
    expect(result.action).toBe('replace-whole-file');
    expect(result.next).toBe(`${OWNED_BLOCK}\n`);
  });

  it('updates only the owned block, preserving operator blocks and outside bytes', () => {
    const stale = CANONICAL.trim().replace('- Keep dependent steps sequential', '- Old line');
    const existing = `# my notes\n\n${OWNED_START}\n${stale}\n${OWNED_END}\n\n${opBlock(OP_AST_GREP)}\n\nuser tail: ${'x'.repeat(50)}`;
    const result = renderManagedGlobalPrompt(existing, CANONICAL);
    expect(result.action).toBe('replace-block');
    expect(result.next).toBe(`# my notes\n\n${OWNED_BLOCK}\n\n${opBlock(OP_AST_GREP)}\n\nuser tail: ${'x'.repeat(50)}`);
    expect(result.next).not.toContain('- Old line');
    // The operator block and the outside bytes survive byte-identical.
    expect(result.next).toContain(opBlock(OP_AST_GREP));
    expect(result.next.startsWith('# my notes')).toBe(true);
  });

  it('is idempotent across repeated renders', () => {
    const first = renderManagedGlobalPrompt('', CANONICAL);
    const second = renderManagedGlobalPrompt(first.next, CANONICAL);
    expect(second.action).toBe('unchanged');
    expect(second.next).toBe(first.next);
  });

  it('fails closed on a duplicate owned block', () => {
    const existing = `${OWNED_START}\nold\n${OWNED_END}\n\n${OWNED_START}\nsecond\n${OWNED_END}`;
    expect(() => renderManagedGlobalPrompt(existing, CANONICAL)).toThrow(GlobalPromptSyncError);
  });

  it('fails closed on an orphan owned start marker', () => {
    expect(() => renderManagedGlobalPrompt(`${OWNED_START}\nbody without end`, CANONICAL)).toThrow(GlobalPromptSyncError);
  });

  it('fails closed on an orphan owned end marker', () => {
    expect(() => renderManagedGlobalPrompt(`body without start\n${OWNED_END}`, CANONICAL)).toThrow(GlobalPromptSyncError);
  });

  it('fails closed on an out-of-order owned pair', () => {
    expect(() => renderManagedGlobalPrompt(`${OWNED_END}\n${OWNED_START}`, CANONICAL)).toThrow(GlobalPromptSyncError);
  });

  it('preserves unknown operator blocks when no owned block exists, and prepends the owned block', () => {
    const operatorOnly = `${opBlock(OP_AST_GREP)}\n\n${opBlock(OP_PROBE)}`;
    const result = renderManagedGlobalPrompt(operatorOnly, CANONICAL);
    expect(result.action).toBe('prepend');
    expect(result.next).toBe(`${OWNED_BLOCK}\n\n${operatorOnly}`);
    expect(result.next).toContain(opBlock(OP_AST_GREP));
    expect(result.next).toContain(opBlock(OP_PROBE));
  });

  it('fails closed on ambiguous unnamed command-chaining candidates', () => {
    const ambiguous = `${opBlock(CANONICAL.trim())}\n\n${opBlock(CANONICAL.trim())}`;
    expect(() => renderManagedGlobalPrompt(ambiguous, CANONICAL)).toThrow(/ambiguous/);
  });

  it('prepends a named owned block to unrelated user content, preserving it verbatim', () => {
    const user = 'my custom append-system content\nline two';
    const result = renderManagedGlobalPrompt(user, CANONICAL);
    expect(result.action).toBe('prepend');
    expect(result.next).toBe(`${OWNED_BLOCK}\n\n${user}`);
  });

  it('keeps CRLF line endings and preserves user bytes verbatim (xtrm-3ljgz.2 review fix)', () => {
    const existing = `# user header\r\n\r\n${OWNED_START}\r\nold managed body\r\n${OWNED_END}\r\n\r\nuser tail`;
    const result = renderManagedGlobalPrompt(existing, CANONICAL);
    expect(result.action).toBe('replace-block');
    expect(result.next).toBe(`# user header\r\n\r\n${OWNED_START}\r\n${CANONICAL.trim()}\r\n${OWNED_END}\r\n\r\nuser tail`);
  });

  it('is byte-idempotent for a CRLF block-only target (xtrm-3ljgz.2 review fix)', () => {
    const blockCRLF = `${OWNED_START}\r\n${CANONICAL.trim()}\r\n${OWNED_END}\r\n`;
    const result = renderManagedGlobalPrompt(blockCRLF, CANONICAL);
    expect(result.action).toBe('unchanged');
    expect(result.next).toBe(blockCRLF);
  });

  it('converges an all-CRLF owned marked file (Windows-saved) to canonical body on run 1, then idempotent (xtrm-3ljgz.2 review fix)', () => {
    const allCRLFBlock = `${OWNED_START}\r\n${CANONICAL.trim().replace(/\n/g, '\r\n')}\r\n${OWNED_END}`;
    const existing = `# user header\r\n\r\n${allCRLFBlock}\r\n\r\n# user tail\r\n`;
    const first = renderManagedGlobalPrompt(existing, CANONICAL);
    expect(first.action).toBe('replace-block');
    expect(first.next.startsWith('# user header\r\n\r\n')).toBe(true);
    expect(first.next.endsWith('\r\n\r\n# user tail\r\n')).toBe(true);
    const second = renderManagedGlobalPrompt(first.next, CANONICAL);
    expect(second.action).toBe('unchanged');
    expect(second.next).toBe(first.next);
  });

  it('migrates a CRLF legacy whole-file body into the named owned form without duplication', () => {
    const result = renderManagedGlobalPrompt(`${LEGACY_BODY}\r\n`, CANONICAL);
    expect(result.action).toBe('replace-whole-file');
    expect(result.next).toBe(`${OWNED_START}\r\n${CANONICAL.trim()}\r\n${OWNED_END}\r\n`);
  });

  it('prepends a named owned block to CRLF user content, preserving its bytes verbatim', () => {
    const user = '# crlf user\r\nline two\r\n';
    const result = renderManagedGlobalPrompt(user, CANONICAL);
    expect(result.action).toBe('prepend');
    expect(result.next).toBe(`${OWNED_START}\r\n${CANONICAL.trim()}\r\n${OWNED_END}\r\n\r\n${user}`);
  });
});

describe('multi-block migration', () => {
  it("migrates the command-chaining block out of the current four-unnamed-block layout, preserving the other three byte-identical", () => {
    const result = renderManagedGlobalPrompt(FOUR_BLOCK, CANONICAL);
    expect(result.action).toBe('replace-block');
    const expectedTail = `\n\n${opBlock(OP_AST_GREP)}\n\n${opBlock(OP_PROBE)}\n\n${START}\n# Repo-scoped knowledge: service-knowledge, commits, and bd memories\n${END}`;
    expect(result.next).toBe(`${OWNED_BLOCK}${expectedTail}`);
    // Every operator block survives byte-identical.
    expect(result.next).toContain(opBlock(OP_AST_GREP));
    expect(result.next).toContain(opBlock(OP_PROBE));
    expect(result.next).toContain('# Repo-scoped knowledge: service-knowledge, commits, and bd memories');
  });

  it('is idempotent after migrating the four-unnamed-block layout', () => {
    const first = renderManagedGlobalPrompt(FOUR_BLOCK, CANONICAL);
    const second = renderManagedGlobalPrompt(first.next, CANONICAL);
    expect(second.action).toBe('unchanged');
    expect(second.next).toBe(first.next);
  });

  it('migrates a single legacy unnamed command-chaining block safely and idempotently', () => {
    const single = opBlock(CANONICAL.trim());
    const first = renderManagedGlobalPrompt(single, CANONICAL);
    expect(first.action).toBe('replace-block');
    expect(first.next).toBe(OWNED_BLOCK);
    const second = renderManagedGlobalPrompt(first.next, CANONICAL);
    expect(second.action).toBe('unchanged');
    expect(second.next).toBe(first.next);
  });

  it('does not claim a customized same-heading block; the Core block is prepended and the operator monitor line survives byte-identical (decision kept pending)', () => {
    // block 1 body = canonical + an operator-appended monitor line — NOT an
    // exact canonical match, so it is never claimed/overwritten.
    const customized = opBlock(`${CANONICAL.trim()}\n- always set background monitors when waiting;`);
    const result = renderManagedGlobalPrompt(customized, CANONICAL);
    expect(result.action).toBe('prepend');
    expect(result.next).toBe(`${OWNED_BLOCK}\n\n${customized}`);
    expect(result.next).toContain('- always set background monitors when waiting;');
    const second = renderManagedGlobalPrompt(result.next, CANONICAL);
    expect(second.action).toBe('unchanged');
    expect(second.next).toBe(result.next);
  });

  it('refuses migration on nested unnamed markers (structural validation)', () => {
    const nested = `${START}\nouter\n${START}\n${CANONICAL.trim()}\n${END}\nrest\n${END}`;
    expect(() => renderManagedGlobalPrompt(nested, CANONICAL)).toThrow(/ambiguous|nested|overlap|orphan/);
  });

  it('refuses migration on an orphan unnamed start marker (structural validation)', () => {
    expect(() => renderManagedGlobalPrompt(`${START}\n${CANONICAL.trim()}` , CANONICAL)).toThrow(/ambiguous|nested|overlap|orphan/);
  });

  it('refuses migration on mismatched/overlapping markers (structural validation)', () => {
    const mismatch = `${START}\nbody\n<!-- xtrm:global-prompt:foo:end -->`;
    expect(() => renderManagedGlobalPrompt(mismatch, CANONICAL)).toThrow(/ambiguous|nested|overlap|orphan/);
  });

  it('refuses when a nested/crossing marker intersects the owned span (validation precedes owned fast path)', () => {
    // Operator block nested inside the owned span.
    const crossing = `${OWNED_START}\ncore\n${START}\noperator\n${END}\nmore\n${OWNED_END}`;
    expect(() => renderManagedGlobalPrompt(crossing, CANONICAL)).toThrow(/ambiguous|nested|overlap|orphan/);
    // Owned block nested inside an operator block (crossing span).
    const crossSpan = `${START}\nop\n${OWNED_START}\nowned\n${OWNED_END}\n${END}`;
    expect(() => renderManagedGlobalPrompt(crossSpan, CANONICAL)).toThrow(/ambiguous|nested|overlap|orphan/);
  });

  it('preserves outside bytes exactly in a mixed-EOL file (original-offset splice)', () => {
    const head = '# user header\r\nplain lf line\n'; // mixed EOL on purpose
    const stale = CANONICAL.trim().replace('- Keep dependent steps sequential', '- Old line');
    const existing = `${head}${OWNED_START}\r\nold managed body\r\n${OWNED_END}\r\n\r\ntail LF\n`;
    const result = renderManagedGlobalPrompt(existing, CANONICAL);
    expect(result.action).toBe('replace-block');
    // Bytes outside the owned span are copied verbatim — no whole-file re-EOL.
    expect(result.next.startsWith(head)).toBe(true);
    expect(result.next.endsWith('\r\n\r\ntail LF\n')).toBe(true);
    expect(result.next).not.toContain('- Old line');
    expect(result.next).not.toContain('old managed body');
  });
});


describe('syncGlobalPrompts', () => {
  it('creates both targets when missing', async () => {
    const result = await syncGlobalPrompts(opts());
    expect(result.targets.map((t) => t.action)).toEqual(['create', 'create']);

    const piFile = path.join(process.env.HOME as string, '.pi', 'agent', 'APPEND_SYSTEM.md');
    const claudeFile = path.join(process.env.HOME as string, '.claude', 'CLAUDE.md');
    expect(await fs.readFile(piFile, 'utf8')).toBe(`${OWNED_BLOCK}\n`);
    expect(await fs.readFile(claudeFile, 'utf8')).toBe(`${OWNED_BLOCK}\n`);
  });

  it('honors PI_AGENT_DIR so CI/smoke runs never touch the real agent dir (xtrm-3ljgz.2)', async () => {
    const previousAgentDir = process.env.PI_AGENT_DIR;
    const scratchAgent = path.join(tempRoot, 'scratch-agent');
    process.env.PI_AGENT_DIR = scratchAgent;
    try {
      const result = await syncGlobalPrompts(opts());
      expect(result.targets[0].label).toBe('pi');
      expect(result.targets[0].file).toBe(path.join(scratchAgent, 'APPEND_SYSTEM.md'));
      expect(await fs.readFile(path.join(scratchAgent, 'APPEND_SYSTEM.md'), 'utf8')).toBe(`${OWNED_BLOCK}\n`);
      expect(fs.existsSync(path.join(process.env.HOME as string, '.pi', 'agent', 'APPEND_SYSTEM.md'))).toBe(false);
    } finally {
      if (previousAgentDir === undefined) delete process.env.PI_AGENT_DIR;
      else process.env.PI_AGENT_DIR = previousAgentDir;
    }
  });

  it('migrates the legacy whole-file body once and stays idempotent', async () => {
    const piFile = path.join(process.env.HOME as string, '.pi', 'agent', 'APPEND_SYSTEM.md');
    await fs.outputFile(piFile, `${LEGACY_BODY}\n`);

    const first = await syncGlobalPrompts(opts());
    expect(first.targets[0].action).toBe('replace-whole-file');
    expect(await fs.readFile(piFile, 'utf8')).toBe(`${OWNED_BLOCK}\n`);

    const second = await syncGlobalPrompts(opts());
    expect(second.targets[0].action).toBe('unchanged');
    expect(await fs.readFile(piFile, 'utf8')).toBe(`${OWNED_BLOCK}\n`);
  });

  it('preserves user bytes outside the owned block on apply and updates its body', async () => {
    const piFile = path.join(process.env.HOME as string, '.pi', 'agent', 'APPEND_SYSTEM.md');
    await fs.outputFile(piFile, `# user header\n\n${OWNED_START}\nold\n${OWNED_END}\n\nuser tail`);

    const result = await syncGlobalPrompts(opts());
    expect(result.targets[0].action).toBe('replace-block');
    expect(await fs.readFile(piFile, 'utf8')).toBe(`# user header\n\n${OWNED_BLOCK}\n\nuser tail`);
  });

  it('migrates the current four-unnamed-block layout, preserving the operator blocks on apply', async () => {
    const piFile = path.join(process.env.HOME as string, '.pi', 'agent', 'APPEND_SYSTEM.md');
    await fs.outputFile(piFile, FOUR_BLOCK);

    const result = await syncGlobalPrompts(opts());
    expect(result.targets[0].action).toBe('replace-block');
    const disk = await fs.readFile(piFile, 'utf8');
    const expectedTail = `\n\n${opBlock(OP_AST_GREP)}\n\n${opBlock(OP_PROBE)}\n\n${START}\n# Repo-scoped knowledge: service-knowledge, commits, and bd memories\n${END}`;
    expect(disk).toBe(`${OWNED_BLOCK}${expectedTail}`);

    const second = await syncGlobalPrompts(opts());
    expect(second.targets[0].action).toBe('unchanged');
    expect(await fs.readFile(piFile, 'utf8')).toBe(disk);
  });

  it('leaves BOTH targets unchanged when the second target is malformed (atomic preflight)', async () => {
    const piFile = path.join(process.env.HOME as string, '.pi', 'agent', 'APPEND_SYSTEM.md');
    const claudeFile = path.join(process.env.HOME as string, '.claude', 'CLAUDE.md');
    // pi plans a change (legacy whole-file → owned block), but claude holds a
    // malformed owned block (duplicate owned name) that fails during preflight.
    const malformedClaude = `${OWNED_START}\nbody\n${OWNED_END}\n\n${OWNED_START}\nfragment\n${OWNED_END}`;
    await fs.outputFile(piFile, `${LEGACY_BODY}\n`);
    await fs.outputFile(claudeFile, malformedClaude);

    await expect(syncGlobalPrompts(opts())).rejects.toThrow(GlobalPromptSyncError);
    // Neither target was touched — planning all targets precedes any write.
    expect(await fs.readFile(piFile, 'utf8')).toBe(`${LEGACY_BODY}\n`);
    expect(await fs.readFile(claudeFile, 'utf8')).toBe(malformedClaude);
  });

  it('refuses to overwrite a target created after planning (exclusive-create guard)', async () => {
    const piFile = path.join(process.env.HOME as string, '.pi', 'agent', 'APPEND_SYSTEM.md');
    const claudeFile = path.join(process.env.HOME as string, '.claude', 'CLAUDE.md');
    // pi is absent at plan time; a concurrent writer creates it between plan
    // and write with its own content — that file must never be overwritten.
    const concurrent = '# concurrent creation\nuser content\n';
    const pending = syncGlobalPrompts(opts({
      _beforeWrite: async () => { await fs.outputFile(piFile, concurrent); },
    }));
    await expect(pending).rejects.toThrow(/appeared during sync|concurrent creation/);
    expect(await fs.readFile(piFile, 'utf8')).toBe(concurrent); // new file preserved
    expect(fs.existsSync(claudeFile)).toBe(false); // never created
  });

  it('rolls back the first target when the second target commit fails (both originally present)', async () => {
    const piFile = path.join(process.env.HOME as string, '.pi', 'agent', 'APPEND_SYSTEM.md');
    const claudeFile = path.join(process.env.HOME as string, '.claude', 'CLAUDE.md');
    const piOriginal = `${LEGACY_BODY}\n`;
    const claudeOriginal = `${OWNED_START}\nstale body\n${OWNED_END}\n`;
    await fs.outputFile(piFile, piOriginal);
    await fs.outputFile(claudeFile, claudeOriginal);

    const realRename = fs.rename;
    let renameCalls = 0;
    const renameSpy = vi.spyOn(fs, 'rename');
    renameSpy.mockImplementation(async (from: unknown, to: unknown) => {
      renameCalls++;
      if (renameCalls === 2) throw new Error('injected second-commit failure');
      return realRename(from as string, to as string);
    });

    await expect(syncGlobalPrompts(opts())).rejects.toThrow(GlobalPromptSyncError);
    renameSpy.mockRestore();

    // pi was already replaced, then rolled back to its exact original bytes;
    // claude (second) was never committed, so it is still its original.
    expect(await fs.readFile(piFile, 'utf8')).toBe(piOriginal);
    expect(await fs.readFile(claudeFile, 'utf8')).toBe(claudeOriginal);
  });

  it('restores absence of a created first target when the second target commit fails', async () => {
    const piFile = path.join(process.env.HOME as string, '.pi', 'agent', 'APPEND_SYSTEM.md');
    const claudeFile = path.join(process.env.HOME as string, '.claude', 'CLAUDE.md');
    const claudeOriginal = `${OWNED_START}\nstale body\n${OWNED_END}\n`;
    await fs.outputFile(claudeFile, claudeOriginal);
    // pi does not exist → it plans a create.

    const realRename = fs.rename;
    let renameCalls = 0;
    const renameSpy = vi.spyOn(fs, 'rename');
    renameSpy.mockImplementation(async (from: unknown, to: unknown) => {
      renameCalls++;
      if (renameCalls === 2) throw new Error('injected second-commit failure');
      return realRename(from as string, to as string);
    });

    await expect(syncGlobalPrompts(opts())).rejects.toThrow(GlobalPromptSyncError);
    renameSpy.mockRestore();

    // The created pi file was rolled back to absence; claude was untouched.
    expect(fs.existsSync(piFile)).toBe(false);
    expect(await fs.readFile(claudeFile, 'utf8')).toBe(claudeOriginal);
  });

  it('propagates a non-ENOENT lstat error in the exclusive-create guard (only ENOENT is treated as absence)', async () => {
    const piFile = path.join(process.env.HOME as string, '.pi', 'agent', 'APPEND_SYSTEM.md');
    const claudeFile = path.join(process.env.HOME as string, '.claude', 'CLAUDE.md');
    const claudeOriginal = `${OWNED_START}\nstale body\n${OWNED_END}\n`;
    await fs.outputFile(claudeFile, claudeOriginal);
    // pi is absent at plan time; the exclusive-create guard lstat hits EACCES.
    const realLstat = fs.lstat;
    let piLstatCalls = 0;
    const lstatSpy = vi.spyOn(fs, 'lstat');
    lstatSpy.mockImplementation(async (target) => {
      if (String(target).endsWith('APPEND_SYSTEM.md')) {
        piLstatCalls++;
        if (piLstatCalls > 1) {
          const err: NodeJS.ErrnoException = new Error('permission denied');
          err.code = 'EACCES';
          throw err;
        }
      }
      return realLstat(target as string);
    });

    await expect(syncGlobalPrompts(opts())).rejects.toThrow(/cannot inspect.*EACCES|permission denied/);
    lstatSpy.mockRestore();
    // EACCES was NOT mistaken for absence: pi was never created, claude untouched.
    expect(fs.existsSync(piFile)).toBe(false);
    expect(await fs.readFile(claudeFile, 'utf8')).toBe(claudeOriginal);
  });

  it('surfaces the original commit failure, rollback failure, and affected target when rollback itself fails', async () => {
    const piFile = path.join(process.env.HOME as string, '.pi', 'agent', 'APPEND_SYSTEM.md');
    const claudeFile = path.join(process.env.HOME as string, '.claude', 'CLAUDE.md');
    await fs.outputFile(piFile, `${LEGACY_BODY}\n`);
    await fs.outputFile(claudeFile, `${OWNED_START}\nstale body\n${OWNED_END}\n`);

    const realRename = fs.rename;
    let renameCalls = 0;
    const renameSpy = vi.spyOn(fs, 'rename');
    renameSpy.mockImplementation(async (from, to) => {
      renameCalls++;
      if (renameCalls === 2) throw new Error('injected second-commit failure');
      if (renameCalls === 3) throw new Error('injected rollback failure');
      return realRename(from as string, to as string);
    });

    let caught: GlobalPromptSyncError | null = null;
    try {
      await syncGlobalPrompts(opts());
    } catch (error) {
      caught = error as GlobalPromptSyncError;
    }
    renameSpy.mockRestore();
    expect(caught).toBeInstanceOf(GlobalPromptSyncError);
    // Original commit failure is present.
    expect(caught!.message).toContain('injected second-commit failure');
    // The rollback failure is NOT swallowed.
    expect(caught!.message).toContain('injected rollback failure');
    expect(caught!.message).toContain('rollback failure(s)');
    // The affected (now-inconsistent) target path is reported.
    expect(caught!.message).toContain(piFile);
    expect(caught!.message).toContain('affected targets');
  });

  it('dry-run reports without writing', async () => {
    const piFile = path.join(process.env.HOME as string, '.pi', 'agent', 'APPEND_SYSTEM.md');
    await fs.outputFile(piFile, `${LEGACY_BODY}\n`);

    const result = await syncGlobalPrompts(opts({ dryRun: true }));
    expect(result.targets[0].dryRun).toBe(true);
    expect(result.targets[0].changed).toBe(true);
    expect(await fs.readFile(piFile, 'utf8')).toBe(`${LEGACY_BODY}\n`); // untouched
  });

  it('fails closed on a symlink target without writing', async () => {
    const claudeDir = path.join(process.env.HOME as string, '.claude');
    await fs.ensureDir(claudeDir);
    await fs.symlink('/tmp/nonexistent-target', path.join(claudeDir, 'CLAUDE.md'));

    await expect(syncGlobalPrompts(opts())).rejects.toThrow(/symlink/);
    expect((await fs.lstat(path.join(claudeDir, 'CLAUDE.md'))).isSymbolicLink()).toBe(true);
  });

  it('backs up the pre-write file under ~/.xtrm/migration-backups', async () => {
    const piFile = path.join(process.env.HOME as string, '.pi', 'agent', 'APPEND_SYSTEM.md');
    await fs.outputFile(piFile, `${LEGACY_BODY}\n`);

    await syncGlobalPrompts(opts());

    const backups = path.join(process.env.HOME as string, '.xtrm', 'migration-backups');
    const files = await fs.readdir(backups);
    expect(files.length).toBeGreaterThan(0);
    expect(await fs.readFile(path.join(backups, files[0]), 'utf8')).toBe(`${LEGACY_BODY}\n`);
  });

  it('preserves the target file mode', async () => {
    const piFile = path.join(process.env.HOME as string, '.pi', 'agent', 'APPEND_SYSTEM.md');
    await fs.outputFile(piFile, `${LEGACY_BODY}\n`);
    await fs.chmod(piFile, 0o600);

    await syncGlobalPrompts(opts());

    const stat = await fs.stat(piFile);
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it('refuses to write when the file changed between plan and write', async () => {
    const piFile = path.join(process.env.HOME as string, '.pi', 'agent', 'APPEND_SYSTEM.md');
    const original = `${LEGACY_BODY}\n`;
    await fs.outputFile(piFile, original);

    const readSpy = vi.spyOn(fs, 'readFile');
    readSpy.mockImplementation(async (file: any, ...rest: any[]) => {
      if (String(file).endsWith('APPEND_SYSTEM.md')) {
        // First call is the plan read, subsequent calls are the defense re-read.
        readSpy.mockImplementation(async (f: any) => String(f).endsWith('APPEND_SYSTEM.md') ? `${original}// concurrent edit` : await fs.readFile(f, 'utf8'));
        return original;
      }
      return await fs.readFile(file as string, rest[0] as BufferEncoding);
    });

    await expect(syncGlobalPrompts(opts())).rejects.toThrow(/concurrent modification/);
    readSpy.mockRestore();
    expect(await fs.readFile(piFile, 'utf8')).toBe(original); // untouched
  });
});

describe('shipped dist (deterministic rebuild + stale-dist guard)', () => {
  const CLI_PATH = path.join(__dirname, '../../dist/index.cjs');

  it('carries the corrected implementation and NOT the removed diagnostic command', () => {
    const bundle = fs.readFileSync(CLI_PATH, 'utf8');
    // New-only literals prove the tracked artifact was rebuilt from current
    // source (named owned marker + structural-validation error).
    expect(bundle).toContain('GLOBAL_PROMPT_OWNED_NAME');
    expect(bundle).toContain('refusing to claim any block');
    // The round-2 diagnostic command was deleted, not merely hidden.
    expect(bundle).not.toContain('_global-prompt-sync');
  });
});
