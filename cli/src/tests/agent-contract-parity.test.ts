import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const CONTRACT = path.join(repoRoot, '.xtrm', 'config', 'instructions', 'agent-contract.md');
const AGENTS_TOP = path.join(repoRoot, '.xtrm', 'config', 'instructions', 'agents-top.md');
const CLAUDE_TOP = path.join(repoRoot, '.xtrm', 'config', 'instructions', 'claude-top.md');
const ROOT_AGENTS = path.join(repoRoot, 'AGENTS.md');
const ROOT_CLAUDE = path.join(repoRoot, 'CLAUDE.md');
const START = '<!-- contract:start -->';
const END = '<!-- contract:end -->';
const MAX_SUFFIX_LINES = 12;

function markerLineIndex(lines: string[], marker: string, from = 0): number {
  return lines.findIndex((line, index) => index >= from && line.trim() === marker);
}

function section(file: string): string {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const i = markerLineIndex(lines, START);
  const j = markerLineIndex(lines, END, i + 1);
  if (i === -1 || j === -1 || j <= i) throw new Error(`${file}: contract markers missing or unordered`);
  return lines.slice(i + 1, j).join('\n').trim();
}

function suffixLines(file: string): number {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const i = markerLineIndex(lines, END);
  if (i === -1) throw new Error(`${file}: contract end marker missing`);
  const tail = lines.slice(i + 1).join('\n').trim();
  return tail ? tail.split('\n').length : 0;
}

describe('agent-contract parity (ISSUE-136 + skills-v4)', () => {
  it('canonical source exists and both managed tops embed it byte-for-byte', () => {
    expect(fs.existsSync(CONTRACT)).toBe(true);
    expect(section(AGENTS_TOP)).toBe(section(CLAUDE_TOP));
    expect(section(AGENTS_TOP)).toBe(section(CONTRACT));
  });

  it('keeps session start targeted and bd prime opt-in only', () => {
    for (const file of [CONTRACT, AGENTS_TOP, CLAUDE_TOP]) {
      const text = fs.readFileSync(file, 'utf8');
      expect(text).toMatch(/targeted/i);
      expect(text).toMatch(/bd (list|ready|search|show)/i);
      expect(text).toMatch(/opt-in/i);
      expect(text).not.toMatch(/bd ?prime.{0,60}auto-injected/i);
      expect(text).not.toMatch(/auto-injected at session ?start/i);
      expect(text).not.toMatch(/session ?start[^\n]{0,80}bd ?prime/i);
      expect(text).not.toMatch(/^1\.\s*`bd prime`/m);
      expect(text).not.toMatch(/run `bd ?prime` (at|before|during) session start/i);
    }
  });

  it('root generated guides do not reintroduce mandatory bd prime outside the managed block', () => {
    for (const file of [ROOT_AGENTS, ROOT_CLAUDE]) {
      const text = fs.readFileSync(file, 'utf8');
      expect(text).not.toMatch(/run `bd ?prime`[^\n]{0,100}(?:before starting work|at session start)/i);
      expect(text).not.toMatch(/`bd ?prime`[^\n]{0,100}(?:required|mandatory|automatic at session start)/i);
    }
  });

  it('routes only through the skills-v4 universal surface', () => {
    const body = section(CONTRACT);
    for (const skill of [
      '/using-xtrm', '/starting-and-resuming-work', '/multiplexing', '/planning',
      '/engineering-quality', '/using-specialists', '/gitnexus', '/skill-creator', '/find-skills',
    ]) {
      expect(body).toContain(skill);
    }
    for (const retired of [
      '/test-planning', '/sync-docs', '/xt-end', '/session-close-report', '/xt-merge',
      '/using-quality-gates', '/using-tdd', '/gitnexus-debugging', '/gitnexus-exploring',
      '/multiplexing-team', '/issue-triage',
    ]) {
      expect(body).not.toContain(retired);
    }
  });

  it('preserves Beads authority while allowing runtime-local execution tracking', () => {
    const body = section(CONTRACT);
    expect(body).toMatch(/Beads (owns|remains).*durable/i);
    expect(body).toMatch(/ephemeral execution tracking/i);
    expect(body).toMatch(/Bead is the prompt/i);
    expect(body).toMatch(/contract:draft.*not dispatchable/i);
  });

  it('does not reintroduce tmux-first coordination doctrine', () => {
    const body = section(CONTRACT);
    expect(body).toMatch(/Prefer native\/runtime communication surfaces over tmux scraping/);
    expect(body).toContain('/multiplexing');
  });

  it('managed tops never point the fleet at a core-only file unconditionally', () => {
    for (const file of [AGENTS_TOP, CLAUDE_TOP]) {
      const text = fs.readFileSync(file, 'utf8');
      if (text.includes('XTRM-GUIDE.md')) {
        expect(text).toMatch(/XTRM-GUIDE\.md` where present/);
        expect(text).toMatch(/Full reference: `\/using-xtrm` skill/);
      }
    }
  });

  it('contract body never defers to the other file', () => {
    const body = section(AGENTS_TOP);
    expect(body).not.toMatch(/see AGENTS\.md/i);
    expect(body).not.toMatch(/see CLAUDE\.md/i);
    expect(body).not.toMatch(/read AGENTS\.md/i);
  });

  it('common contract body stays compact (ISSUE-136 c.12969 — compact routing, not manuals)', () => {
    const body = section(CONTRACT).trim().split('\n');
    expect(body.length).toBeGreaterThanOrEqual(15);
    expect(body.length).toBeLessThanOrEqual(55);
  });

  it('per-runtime suffixes stay small and additive', () => {
    for (const file of [AGENTS_TOP, CLAUDE_TOP]) {
      const n = suffixLines(file);
      expect(n).toBeGreaterThan(0);
      expect(n).toBeLessThanOrEqual(MAX_SUFFIX_LINES);
    }
  });
});
