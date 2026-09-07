import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const hookPath = fileURLToPath(new URL('./project-memory.mjs', import.meta.url));

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'xtrm-project-memory-'));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function runHook(root, extraEnv = {}) {
  const input = JSON.stringify({ cwd: root });
  return spawnSync('node', [hookPath], {
    input,
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv },
    timeout: 15_000,
  });
}

function doctrinePayload(stdout) {
  try {
    return JSON.parse(stdout).hookSpecificOutput;
  } catch {
    return null;
  }
}

test('injects the canonical memory doctrine verbatim and never injects memory.md (xtrm-3ljgz.3)', (t) => {
  const fx = fixture();
  t.after(fx.cleanup);
  const instructions = join(fx.root, '.xtrm', 'config', 'instructions');
  mkdirSync(instructions, { recursive: true });
  const doctrine = '# BD Memory Doctrine\n\nUse `bd memories <topic>` when history is relevant.\n';
  writeFileSync(join(instructions, 'memory-doctrine.md'), doctrine);
  // A stale synthesized memory.md must not leak even when present.
  writeFileSync(join(fx.root, '.xtrm', 'memory.md'), 'stale synthesized state that must not leak');

  const result = runHook(fx.root);
  assert.equal(result.status, 0, result.stderr);
  const payload = doctrinePayload(result.stdout);
  assert.ok(payload, 'hook produced no JSON payload');
  assert.equal(payload.hookEventName, 'SessionStart');
  assert.equal(payload.additionalSystemPrompt, doctrine.trim());
  assert.ok(!result.stdout.includes('stale synthesized state'));
});

test('fails open when the doctrine file is missing (memory.md alone is not injected)', (t) => {
  const fx = fixture();
  t.after(fx.cleanup);
  mkdirSync(join(fx.root, '.xtrm'), { recursive: true });
  writeFileSync(join(fx.root, '.xtrm', 'memory.md'), 'stale synthesized state');

  const result = runHook(fx.root);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.ok(!result.stdout.includes('stale synthesized state'));
});

test('fails open when the doctrine file is unreadable or empty', (t) => {
  const fx = fixture();
  t.after(fx.cleanup);
  const instructions = join(fx.root, '.xtrm', 'config', 'instructions');
  mkdirSync(instructions, { recursive: true });
  writeFileSync(join(instructions, 'memory-doctrine.md'), '   \n  ');

  const result = runHook(fx.root);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
});
