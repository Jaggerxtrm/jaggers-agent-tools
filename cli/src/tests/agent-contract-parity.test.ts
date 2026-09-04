import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ISSUE-136 authority correction: AGENTS.md and CLAUDE.md MUST expose the
// same effective repository contract. agents-top.md and claude-top.md share
// one canonical body (byte-identical between contract markers); only a small
// per-runtime suffix may differ. A CLAUDE.md that merely says "see AGENTS.md"
// is NOT acceptable — Claude loads CLAUDE.md directly into context.

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const CONTRACT = path.join(repoRoot, '.xtrm', 'config', 'instructions', 'agent-contract.md');
const AGENTS_TOP = path.join(repoRoot, '.xtrm', 'config', 'instructions', 'agents-top.md');
const CLAUDE_TOP = path.join(repoRoot, '.xtrm', 'config', 'instructions', 'claude-top.md');

const START = '<!-- contract:start -->';
const END = '<!-- contract:end -->';

// Suffix budget: runtime-specific notes must stay small and additive.
const MAX_SUFFIX_LINES = 12;

function section(file: string): string {
  const text = fs.readFileSync(file, 'utf8');
  const i = text.indexOf(START);
  const j = text.indexOf(END);
  if (i === -1 || j === -1 || j <= i) throw new Error(`${file}: contract markers missing or unordered`);
  return text.slice(i + START.length, j).trim();
}

function suffixLines(file: string): number {
  const text = fs.readFileSync(file, 'utf8');
  const tail = text.slice(text.indexOf(END) + END.length).trim();
  return tail ? tail.split('\n').length : 0;
}

describe('agent-contract parity (ISSUE-136)', () => {
  it('canonical contract source exists with markers', () => {
    expect(fs.existsSync(CONTRACT)).toBe(true);
    const text = fs.readFileSync(CONTRACT, 'utf8');
    expect(text).toContain(START);
    expect(text).toContain(END);
  });

  it('agents-top and claude-top embed the identical contract body', () => {
    expect(section(AGENTS_TOP)).toBe(section(CLAUDE_TOP));
  });

  it('embedded body matches the canonical source', () => {
    expect(section(AGENTS_TOP)).toBe(section(CONTRACT));
  });

  it('contract body carries the targeted session-start (no mandatory bd prime)', () => {
    const body = section(AGENTS_TOP);
    expect(body).toMatch(/targeted/i);
    expect(body).toMatch(/service-knowledge index query/);
    expect(body).not.toMatch(/Run `bd prime` at session start/);
    expect(body).not.toMatch(/1\. `bd prime` — load workflow context/);
  });

  it('contract body never defers to the other file', () => {
    const body = section(AGENTS_TOP);
    expect(body).not.toMatch(/see AGENTS\.md/i);
    expect(body).not.toMatch(/see CLAUDE\.md/i);
    expect(body).not.toMatch(/read AGENTS\.md/i);
  });

  it('per-runtime suffixes stay small and additive', () => {
    for (const file of [AGENTS_TOP, CLAUDE_TOP]) {
      const n = suffixLines(file);
      expect(n).toBeGreaterThan(0);
      expect(n).toBeLessThanOrEqual(MAX_SUFFIX_LINES);
    }
  });
});
