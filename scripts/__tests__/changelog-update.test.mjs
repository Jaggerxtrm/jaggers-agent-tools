// The committed [Unreleased] is an empty placeholder — that is the whole point of
// bead xtrm-wiy5n.4.28. If this drifts back to "keep it fresh from the git log", every
// merge to main starts conflicting every other open PR again.
//
// Only the placeholder paths are covered: --preview and --tag shell out to git-cliff,
// which needs the real repo history and a network-capable npx.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

const SCRIPT = fileURLToPath(new URL('../changelog-update.mjs', import.meta.url));

const HEADER = '# Changelog\n\nPreamble.\n\n---\n';
const RELEASED = '## [v0.1.0] — 2026-01-01\n\n### Added\n\n- **Something released** — 2026-01-01\n';
const WITH_ENTRIES = `${HEADER}\n## [Unreleased]\n\n### Added\n\n- **A branch commit** — 2026-07-26\n\n${RELEASED}`;
const PLACEHOLDER = `${HEADER}\n## [Unreleased]\n\n${RELEASED.trimEnd()}\n`;

let dir;
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'changelog-update-'));
  mkdirSync(join(dir, 'changelog'), { recursive: true });
});
after(() => rmSync(dir, { recursive: true, force: true }));

/** @returns {{code: number, stderr: string}} */
function run(...args) {
  try {
    execFileSync(process.execPath, [SCRIPT, ...args], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
    return { code: 0, stderr: '' };
  } catch (err) {
    return { code: err.status, stderr: String(err.stderr) };
  }
}

const write = (content) => writeFileSync(join(dir, 'CHANGELOG.md'), content);
const read = () => readFileSync(join(dir, 'CHANGELOG.md'), 'utf8');

test('--check rejects generated entries on a branch', () => {
  write(WITH_ENTRIES);
  const { code, stderr } = run('--check');
  assert.equal(code, 1, '--check must fail when [Unreleased] carries entries');
  assert.match(stderr, /empty placeholder/);
  assert.equal(read(), WITH_ENTRIES, '--check must not write');
});

test('the default run clears the block and keeps released sections', () => {
  write(WITH_ENTRIES);
  assert.equal(run().code, 0);
  assert.equal(read(), PLACEHOLDER);
  assert.match(read(), /## \[v0\.1\.0\]/, 'released sections survive');
});

test('--check passes on the placeholder, and clearing is idempotent', () => {
  write(PLACEHOLDER);
  assert.equal(run('--check').code, 0);
  assert.equal(run().code, 0);
  assert.equal(read(), PLACEHOLDER);
});

test('a --prepend-corrupted file is refused, not silently rewritten', () => {
  write('## [Unreleased]\n\n# Changelog\n\n' + RELEASED);
  const { code, stderr } = run();
  assert.equal(code, 1);
  assert.match(stderr, /prepend-corrupted/);
});
