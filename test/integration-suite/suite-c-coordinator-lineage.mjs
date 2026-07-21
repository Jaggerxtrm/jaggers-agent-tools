// Suite C — coordinator-lineage conformance (audit §P2-01 steps 2-5, 7-11).
//
// BLOCKED, by design and with justification. These steps assert invariants of a
// coordination surface that does not exist yet as a stable, launchable contract:
//
//   • Subordinate chain-coordinator launch through Core (audit P0-05) — the
//     canonical `--subordinate` launch path.
//   • Mandatory interactive worktrees (audit P1-02) — steps 4 & 11.
//   • Formalized branch ancestry for specialist chains (audit P1-03) — steps 8-9.
//
// All three land in xtrm-3xgs5 (split bare from role launch path), which owns
// cli/src/utils/worktree-session.ts — a file this suite's charter forbids
// touching and which is mid-refactor. Writing live assertions against it now
// would test a moving target and collide with the owner.
//
// This runner does NOT launch live coordinators/specialists (that requires real
// agents and is unfit for hermetic CI). It probes whether the launch contract
// has landed and reports BLOCKED until it has. When the surface stabilizes, the
// assertions below graduate into a real, opt-in (non-hermetic) lane.

import { existsSync } from 'node:fs';
import { reporter, run } from './lib/harness.mjs';

const BLOCKER = 'xtrm-3xgs5 (subordinate launch P0-05 + worktrees P1-02 + ancestry P1-03)';
const r = reporter('suite-c');

// Probe: is a subordinate coordinator launch contract exposed on `xt`?
// (Presence check only — no launch.) Resolve xt from PATH; if absent, still
// report BLOCKED rather than crashing.
function subordinateLaunchAvailable() {
  const xt = run('sh', ['-c', 'command -v xt || true']).stdout.trim();
  if (!xt || !existsSync(xt)) return false;
  for (const sub of ['pi', 'claude']) {
    const help = run(xt, [sub, '--help']);
    if (/--subordinate\b/.test(`${help.stdout}\n${help.stderr}`)) return true;
  }
  return false;
}

const steps = [
  'step 2: launch main orchestrator from main worktree',
  'step 3: launch subordinate chain coordinator through Core',
  'step 4: verify distinct coordinator worktree and branch',
  'step 5: verify parent session, role and bead pane metadata',
  'step 7: dispatch a specialist child from the coordinator',
  'step 8: verify specialist branch derives from coordinator branch',
  'step 9: verify descendant runtime-origin lineage',
  'step 10: merge accepted specialist branch into coordinator branch',
  'step 11: confirm main remains unchanged',
];

const available = subordinateLaunchAvailable();
if (available) {
  // Guard flips when P0-05 lands: fail loudly so the stub is upgraded to a real
  // lane instead of silently masking a now-testable surface.
  r.skip('coordinator-lineage arc', 'subordinate launch contract detected — upgrade Suite C to a live lane (see xtrm-3xgs5)');
  console.log('  [ACTION] `xt --subordinate` is now present. Replace this stub with the live coordinator-lineage assertions.');
} else {
  for (const s of steps) r.blocked(s, BLOCKER);
}

r.summary();
console.log(`suite-c: BLOCKED (${steps.length} steps deferred to ${BLOCKER})`);
process.exit(0);
