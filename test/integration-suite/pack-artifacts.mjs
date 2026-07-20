// Pack the three release-candidate artifacts (Core, Specialists, xtmux) into a
// cache dir and print their paths as JSON. Used for LOCAL runs against sibling
// dev checkouts; in CI the tarballs are produced by the workflow and passed via
// the P201_*_TARBALL env vars, which this helper honors verbatim.
//
//   node test/integration-suite/pack-artifacts.mjs [cacheDir]
//
// Overrides (skip packing, use an existing tarball):
//   P201_CORE_TARBALL, P201_SPECIALISTS_TARBALL, P201_XTMUX_TARBALL
// Source-repo overrides (pack a different checkout):
//   P201_SPECIALISTS_REPO (default ~/dev/specialists)
//   P201_XTMUX_REPO       (default ~/dev/xtmux)

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const coreRoot = path.resolve(here, '..', '..'); // worktree root == xtrm-tools package root
const home = os.homedir();

const cacheDir = process.argv[2] || mkdtempSync(path.join(os.tmpdir(), 'xtrm-p201-artifacts-'));
mkdirSync(cacheDir, { recursive: true });

function packOne(label, repoRoot, envOverride) {
  const override = process.env[envOverride];
  if (override) {
    if (!existsSync(override)) throw new Error(`${label}: ${envOverride}=${override} does not exist`);
    return path.resolve(override);
  }
  if (!existsSync(path.join(repoRoot, 'package.json'))) {
    throw new Error(`${label}: no package.json at ${repoRoot} (set ${envOverride} or the *_REPO override)`);
  }
  // --ignore-scripts: the dev checkout already carries built dist/; we archive
  // it faithfully without re-triggering bun/tsc prepack chains.
  const res = spawnSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', cacheDir], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 180_000,
  });
  if (res.status !== 0) {
    throw new Error(`${label}: npm pack failed (${res.status}): ${(res.stderr || res.stdout || '').slice(-800)}`);
  }
  const meta = JSON.parse(res.stdout);
  const filename = meta[0].filename;
  const produced = path.join(cacheDir, filename);
  if (existsSync(produced)) return produced;
  // Older npm ignores --pack-destination; fall back to cwd then relocate.
  const inCwd = path.join(repoRoot, filename);
  const dest = path.join(cacheDir, filename);
  copyFileSync(inCwd, dest);
  return dest;
}

const artifacts = {
  core: packOne('core', coreRoot, 'P201_CORE_TARBALL'),
  specialists: packOne(
    'specialists',
    process.env.P201_SPECIALISTS_REPO || path.join(home, 'dev', 'specialists'),
    'P201_SPECIALISTS_TARBALL',
  ),
  xtmux: packOne('xtmux', process.env.P201_XTMUX_REPO || path.join(home, 'dev', 'xtmux'), 'P201_XTMUX_TARBALL'),
  cacheDir,
};

console.log(JSON.stringify(artifacts, null, 2));
