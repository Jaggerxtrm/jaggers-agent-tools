import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  normaliseCommand,
  indexGlobal,
  pruneSettings,
  auditProject,
} from '../dedupe-legacy-hooks.mjs';

const HOME = os.homedir();
const GLOBAL_HOOKS = path.join(HOME, '.xtrm', 'hooks');

test('normalises project hook paths onto the global hooks dir', () => {
  const cmd = normaliseCommand('node "/repo/.xtrm/hooks/beads-memory-gate.mjs"', '/repo');
  assert.equal(cmd, `node "${GLOBAL_HOOKS}/beads-memory-gate.mjs"`);
});

test('leaves commands that do not reference project hooks untouched', () => {
  const cmd = normaliseCommand('python3 "$CLAUDE_PROJECT_DIR/tool.py"', '/repo');
  assert.equal(cmd, 'python3 "$CLAUDE_PROJECT_DIR/tool.py"');
});

test('prune drops only the planned commands and collapses empty entries', () => {
  const settings = {
    permissions: { allow: ['Read'] },
    hooks: {
      Stop: [{ hooks: [{ command: 'a' }, { command: 'b' }] }],
      PreToolUse: [{ matcher: 'Bash', hooks: [{ command: 'c' }] }],
    },
  };
  const next = pruneSettings(settings, [
    { event: 'Stop', matcher: '', command: 'a' },
    { event: 'PreToolUse', matcher: 'Bash', command: 'c' },
  ]);

  assert.deepEqual(next.permissions, { allow: ['Read'] }, 'non-hook keys survive');
  assert.deepEqual(next.hooks, { Stop: [{ hooks: [{ command: 'b' }] }] });
});

test('prune removes the hooks key entirely when nothing survives', () => {
  const next = pruneSettings({ hooks: { Stop: [{ hooks: [{ command: 'a' }] }] } }, [
    { event: 'Stop', matcher: '', command: 'a' },
  ]);
  assert.equal('hooks' in next, false);
});

test('audit plans identical duplicates and preserves drift, uncovered and foreign entries', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dedupe-hooks-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const hooksDir = path.join(dir, '.xtrm', 'hooks');
  await fs.mkdir(hooksDir, { recursive: true });
  await fs.mkdir(path.join(dir, '.claude'), { recursive: true });

  // matches the real global copy byte-for-byte -> safe duplicate
  const canonical = await fs.readFile(path.join(GLOBAL_HOOKS, 'beads-memory-gate.mjs'));
  await fs.writeFile(path.join(hooksDir, 'beads-memory-gate.mjs'), canonical);
  // same name as a global hook but different bytes -> must be preserved
  await fs.writeFile(path.join(hooksDir, 'beads-stop-gate.mjs'), '// locally patched\n');

  const q = (name) => `node "${path.join(hooksDir, name)}"`;
  await fs.writeFile(
    path.join(dir, '.claude', 'settings.json'),
    JSON.stringify({
      hooks: {
        Stop: [
          {
            hooks: [
              { command: q('beads-memory-gate.mjs') },
              { command: q('beads-stop-gate.mjs') },
              { command: q('not-in-global.mjs') },
              { command: 'python3 "$CLAUDE_PROJECT_DIR/mine.py"' },
            ],
          },
        ],
      },
    }),
  );

  const globalIndex = indexGlobal({
    hooks: {
      Stop: [
        {
          hooks: [
            { command: `node "${GLOBAL_HOOKS}/beads-memory-gate.mjs"` },
            { command: `node "${GLOBAL_HOOKS}/beads-stop-gate.mjs"` },
          ],
        },
      ],
    },
  });

  const result = await auditProject(dir, globalIndex);

  assert.deepEqual(
    result.planned.map((p) => p.command),
    [q('beads-memory-gate.mjs')],
    'only the byte-identical, globally-covered hook is planned for removal',
  );
  assert.deepEqual(
    result.preserved.map((p) => p.classification),
    ['xt-owned-drift', 'xt-owned-uncovered', 'foreign'],
  );
  assert.equal(result.failed.length, 0);
});
