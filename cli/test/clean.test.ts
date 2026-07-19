import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '../..');
const CLI_ENTRY = path.join(__dirname, '../src/index.ts');

const CLI_BIN = process.env.XTRM_CLI_BIN ?? path.join(__dirname, '../dist/index.cjs');

function runClean(
  args: string[],
  env: Record<string, string> = {},
): { stdout: string; stderr: string; status: number } {
  const r = spawnSync('node', [CLI_BIN, 'clean', ...args], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
    timeout: 30000,
  });
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', status: r.status ?? -1 };
}

// ── ownership and canonical wiring validation ────────────────────────────────

describe('xtrm clean — ownership safety', () => {
  it('preserves unknown Claude hook files and wiring in dry-run and apply', () => {
    const tmpHome = mkdtempSync(path.join(os.tmpdir(), 'xtrm-clean-test-'));
    const hooksDir = path.join(tmpHome, '.claude', 'hooks');
    mkdirSync(path.join(tmpHome, '.claude'), { recursive: true });
    mkdirSync(hooksDir, { recursive: true });
    const customHook = path.join(hooksDir, 'custom.mjs');
    writeFileSync(customHook, '# user hook');
    const managedCache = path.join(tmpHome, '.claude', 'plugins', 'cache', 'xtrm-tools');
    const userCache = path.join(tmpHome, '.claude', 'plugins', 'cache', 'user-cache');
    mkdirSync(managedCache, { recursive: true });
    mkdirSync(userCache, { recursive: true });

    const settingsPath = path.join(tmpHome, '.claude', 'settings.json');
    writeFileSync(settingsPath, JSON.stringify({
      hooks: {
        PreToolUse: [
          { hooks: [{ type: 'command', command: `node "${customHook}"` }] },
        ],
      },
    }, null, 2));

    try {
      const dryRun = runClean(['--dry-run', '--hooks-only'], { HOME: tmpHome });
      expect(dryRun.stdout, `stdout:\n${dryRun.stdout}\nstderr:\n${dryRun.stderr}`).toContain(
        'preserved ~/.claude/hooks/*',
      );
      expect(existsSync(customHook)).toBe(true);
      expect(existsSync(managedCache)).toBe(true);

      const applied = runClean(['--yes', '--hooks-only'], { HOME: tmpHome });
      expect(applied.status, `stdout:\n${applied.stdout}\nstderr:\n${applied.stderr}`).toBe(0);
      expect(existsSync(customHook)).toBe(true);
      expect(existsSync(userCache)).toBe(true);
      expect(existsSync(managedCache)).toBe(false);
      expect(JSON.parse(readFileSync(settingsPath, 'utf8')).hooks.PreToolUse).toHaveLength(1);
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  it('keeps canonical matcher: gitnexus-hook.cjs with Read|Grep|Glob prefix', () => {
    const tmpHome = mkdtempSync(path.join(os.tmpdir(), 'xtrm-clean-test-'));
    const hooksDir = path.join(tmpHome, '.claude', 'hooks');
    mkdirSync(path.join(tmpHome, '.claude'), { recursive: true });
    mkdirSync(path.join(hooksDir, 'gitnexus'), { recursive: true });
    writeFileSync(path.join(hooksDir, 'gitnexus', 'gitnexus-hook.cjs'), '// stub');

    writeFileSync(path.join(tmpHome, '.claude', 'settings.json'), JSON.stringify({
      hooks: {
        PostToolUse: [
          {
            // Canonical: current hooks.json includes Read|Grep|Glob prefix
            matcher: 'Read|Grep|Glob|Bash|mcp__serena__find_symbol|mcp__serena__get_symbols_overview',
            hooks: [{ type: 'command', command: `node "${path.join(hooksDir, 'gitnexus/gitnexus-hook.cjs')}"`, timeout: 10000 }],
          },
        ],
      },
    }, null, 2));

    try {
      const r = runClean(['--dry-run', '--hooks-only'], { HOME: tmpHome });
      expect(r.stdout).toContain('preserved ~/.claude/hooks/*');
      expect(r.stdout).not.toMatch(/gitnexus-hook\.cjs.*stale wiring/i);
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  it.skip('keeps branch-state.mjs as canonical (outdated - no UserPromptSubmit in hooks.json)', () => {
    const tmpHome = mkdtempSync(path.join(os.tmpdir(), 'xtrm-clean-test-'));
    const hooksDir = path.join(tmpHome, '.claude', 'hooks');
    mkdirSync(path.join(tmpHome, '.claude'), { recursive: true });
    mkdirSync(hooksDir, { recursive: true });
    writeFileSync(path.join(hooksDir, 'branch-state.mjs'), '// stub');

    writeFileSync(path.join(tmpHome, '.claude', 'settings.json'), JSON.stringify({
      hooks: {
        UserPromptSubmit: [
          { hooks: [{ type: 'command', command: `node "${path.join(hooksDir, 'branch-state.mjs')}"`, timeout: 3000 }] },
        ],
      },
    }, null, 2));

    try {
      const r = runClean(['--dry-run', '--hooks-only'], { HOME: tmpHome });
      expect(r.stdout).toContain('No orphaned hook entries found');
      expect(r.stdout).not.toContain('branch-state.mjs');
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  it.skip('keeps canonical entries that match config/hooks.json exactly (outdated)', () => {
    const tmpHome = mkdtempSync(path.join(os.tmpdir(), 'xtrm-clean-test-'));
    const hooksDir = path.join(tmpHome, '.claude', 'hooks');
    mkdirSync(path.join(tmpHome, '.claude'), { recursive: true });
    mkdirSync(hooksDir, { recursive: true });
    writeFileSync(path.join(hooksDir, 'main-guard.mjs'), '// stub');

    writeFileSync(path.join(tmpHome, '.claude', 'settings.json'), JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            matcher: 'Write|Edit|MultiEdit|mcp__serena__rename_symbol|mcp__serena__replace_symbol_body|mcp__serena__insert_after_symbol|mcp__serena__insert_before_symbol',
            hooks: [{ type: 'command', command: `node "${path.join(hooksDir, 'beads-edit-gate.mjs')}"`, timeout: 5000 }],
          },
          {
            matcher: 'Bash',
            hooks: [{ type: 'command', command: `node "${path.join(hooksDir, 'beads-edit-gate.mjs')}"`, timeout: 5000 }],
          },
        ],
      },
    }, null, 2));

    try {
      const r = runClean(['--dry-run', '--hooks-only'], { HOME: tmpHome });
      expect(r.stdout).toContain('No orphaned hook entries found');
      expect(r.stdout).not.toContain('beads-edit-gate.mjs');
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  it('preserves unknown hook wiring instead of removing non-canonical scripts', () => {
    const tmpHome = mkdtempSync(path.join(os.tmpdir(), 'xtrm-clean-test-'));
    const hooksDir = path.join(tmpHome, '.claude', 'hooks');
    mkdirSync(path.join(tmpHome, '.claude'), { recursive: true });
    mkdirSync(hooksDir, { recursive: true });

    writeFileSync(path.join(tmpHome, '.claude', 'settings.json'), JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [{ type: 'command', command: `node "${path.join(hooksDir, 'some-old-hook.mjs')}"` }],
          },
        ],
      },
    }, null, 2));

    try {
      const r = runClean(['--dry-run', '--hooks-only'], { HOME: tmpHome });
      expect(r.stdout).toContain('preserved ~/.claude/hooks/*');
      expect(r.stdout).not.toContain('some-old-hook.mjs');
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  it('prunes only retired skill links proven to target managed default content', () => {
    const tmpHome = mkdtempSync(path.join(os.tmpdir(), 'xtrm-clean-test-'));
    const defaultRoot = path.join(tmpHome, '.xtrm', 'skills', 'default');
    const activeRoot = path.join(tmpHome, '.xtrm', 'skills', 'active');
    const retiredSkill = path.join(defaultRoot, 'retired-skill');
    const userActiveDir = path.join(activeRoot, 'user-owned');
    mkdirSync(retiredSkill, { recursive: true });
    mkdirSync(activeRoot, { recursive: true });
    mkdirSync(userActiveDir, { recursive: true });
    writeFileSync(path.join(retiredSkill, 'SKILL.md'), '# retired\n');
    symlinkSync(path.join('..', 'default', 'retired-skill'), path.join(activeRoot, 'retired-skill'));
    writeFileSync(path.join(userActiveDir, 'SKILL.md'), '# user\n');

    try {
      const dryRun = runClean(['--dry-run', '--skills-only'], { HOME: tmpHome });
      expect(dryRun.status, `stdout:\n${dryRun.stdout}\nstderr:\n${dryRun.stderr}`).toBe(0);
      expect(existsSync(retiredSkill)).toBe(true);
      expect(existsSync(path.join(activeRoot, 'retired-skill'))).toBe(true);
      expect(existsSync(userActiveDir)).toBe(true);

      const applied = runClean(['--yes', '--skills-only'], { HOME: tmpHome });
      expect(applied.status, `stdout:\n${applied.stdout}\nstderr:\n${applied.stderr}`).toBe(0);
      expect(existsSync(retiredSkill)).toBe(false);
      expect(existsSync(path.join(activeRoot, 'retired-skill'))).toBe(false);
      expect(existsSync(userActiveDir)).toBe(true);
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });
});
