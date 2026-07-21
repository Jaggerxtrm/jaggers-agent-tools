// Orchestrate the full P2-01 integration suite: pack (or reuse) the three RC
// artifacts, then run Suite A (hermetic), Suite B (coordination lifecycle,
// capability-gated) and Suite C (coordinator-lineage, BLOCKED).
//
//   node test/integration-suite/run-all.mjs
//
// Artifacts: honors P201_CORE_TARBALL / P201_SPECIALISTS_TARBALL /
// P201_XTMUX_TARBALL when all three are set; otherwise packs from sibling dev
// checkouts via pack-artifacts.mjs.
//
// Exit code: non-zero if Suite A or B fails. Suite C is BLOCKED-by-design and
// never fails the run.

import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const node = process.execPath;

function sh(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { stdio: 'inherit', encoding: 'utf8', ...opts });
}

// ── ensure artifacts ────────────────────────────────────────────────────────
let core = process.env.P201_CORE_TARBALL;
let specialists = process.env.P201_SPECIALISTS_TARBALL;
let xtmux = process.env.P201_XTMUX_TARBALL;

if (!(core && specialists && xtmux)) {
  console.log('▶ packing RC artifacts (core + specialists + xtmux)…');
  const cache = mkdtempSync(path.join(os.tmpdir(), 'xtrm-p201-run-'));
  const packed = spawnSync(node, [path.join(here, 'pack-artifacts.mjs'), cache], { encoding: 'utf8' });
  if (packed.status !== 0) {
    console.error('pack-artifacts failed:\n' + (packed.stderr || packed.stdout));
    process.exit(2);
  }
  const artifacts = JSON.parse(packed.stdout);
  core = core || artifacts.core;
  specialists = specialists || artifacts.specialists;
  xtmux = xtmux || artifacts.xtmux;
}

console.log(`▶ artifacts:\n    core=${core}\n    specialists=${specialists}\n    xtmux=${xtmux}\n`);

// ── run suites ──────────────────────────────────────────────────────────────
const results = [];

console.log('════════ Suite A — installed-artifact (steps 1,6,19,20) ════════');
results.push(['suite-a', sh(node, [path.join(here, 'suite-a-installed-artifact.mjs'), core, specialists, xtmux]).status]);

console.log('\n════════ Suite B — coordination-lifecycle (steps 12-18) ════════');
results.push(['suite-b', sh(node, [path.join(here, 'suite-b-coordination.mjs')]).status]);

console.log('\n════════ Suite C — coordinator-lineage (steps 2-5, 11; 7-10 live-only) ════════');
results.push(['suite-c', sh(node, [path.join(here, 'suite-c-coordinator-lineage.mjs'), core]).status]);

// ── verdict ─────────────────────────────────────────────────────────────────
// Suite C became gating in xtrm-6hey0: it now launches a real subordinate
// coordinator through the packed Core artifact instead of probing for a
// contract that did not exist. It still exits 0 when its capability gate closes
// (no tmux/git), so runners without a lineage runtime stay green.
console.log('\n════════ P2-01 integration suite summary ════════');
let failed = 0;
for (const [name, status] of results) {
  const verdict = status === 0 ? 'PASS' : 'FAIL';
  if (status !== 0) failed++;
  console.log(`  ${name}: ${verdict}`);
}
process.exit(failed ? 1 : 0);
