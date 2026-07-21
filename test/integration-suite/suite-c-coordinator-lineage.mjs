// Suite C — coordinator-lineage conformance (audit §P2-01 steps 2-5, 7-11).
//
// GRADUATED from the BLOCKED probe stub by xtrm-6hey0 (audit P0-05 `--subordinate`
// + P1-02 lineage metadata). This is the live, capability-gated lane the stub
// promised: it launches a real subordinate chain coordinator through the packed
// Core artifact and asserts the lineage invariants on the resulting pane.
//
//   node test/integration-suite/suite-c-coordinator-lineage.mjs <core.tgz>
//
// ── Isolation ───────────────────────────────────────────────────────────────
// Private tmux server (`tmux -L`), isolated HOME/XDG_STATE_HOME/TMUX_TMPDIR, and
// a throwaway git repo. The operator's live tmux server, real worktrees and
// 300MB observability.db are never touched. Same discipline as Suite B.
//
// ── What is faithful, and what is shimmed (declared, not hidden) ────────────
// • Core is the REAL packed artifact — `xt` runs from cli/dist/index.cjs of the
//   tarball under test. Every assertion below is against that binary.
// • `sp` and the runtime binary (`claude`) are SHIMS. Suite C's subject is
//   *Core's* lineage contract — which worktree, branch, parent, role and bead a
//   launch publishes — not Specialists' task rendering (Suite A asserts the
//   installed Specialists artifact at contract level) and not a real LLM turn.
//   Shimming them is what makes steps 2-5 and 11 assertable at all: a real
//   `sp render-task` needs a beads database, and a real agent needs an API key.
// • Steps 7-10 dispatch an actual specialist chain and inspect its branches.
//   That is Specialists-side behavior requiring live agents, so they stay SKIP
//   with a stated reason rather than being faked into a pass.
//
// Exit code is 0 when the capability gate closes (no tmux / no git / no core
// tarball); non-zero only on a genuine conformance failure.

import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { makeSandbox, reporter, run } from './lib/harness.mjs';

const r = reporter('suite-c');
const SOCKET = `p201c-${process.pid}`;
const BEAD = 'xtrm-6hey0';
const SLUG = 'coord';

// Steps this lane cannot honestly assert without live agents. Kept explicit so
// the ledger shows what is still uncovered instead of silently omitting it.
const LIVE_ONLY = [
  ['step 7: dispatch a specialist child from the coordinator', 'needs a live specialist chain (real agent + API credentials)'],
  ['step 8: verify specialist branch derives from coordinator branch', 'sp creates specialist branches; Core only publishes the base via @agent_branch (audit P1-03)'],
  ['step 9: verify descendant runtime-origin lineage', 'runtime-origin propagation is Specialists-side (SupervisorStatus), needs a dispatched job'],
  ['step 10: merge accepted specialist branch into coordinator branch', 'needs step 7-8 branches to exist'],
];

function which(bin) {
  const res = run('sh', ['-c', `command -v ${bin} || true`]);
  const p = res.stdout.trim();
  return p && existsSync(p) ? p : null;
}

const TMUX = which('tmux');
const GIT = which('git');
const coreTgz = process.argv[2] || process.env.P201_CORE_TARBALL;

// ── capability gate ─────────────────────────────────────────────────────────
if (!TMUX || !GIT || !coreTgz || !existsSync(coreTgz)) {
  const missing = [!TMUX && 'tmux', !GIT && 'git', (!coreTgz || !existsSync(coreTgz)) && 'core tarball'].filter(Boolean).join(' + ');
  for (const s of ['step 2-5, 11 (coordinator lineage)']) r.skip(s, `lineage runtime unavailable (missing ${missing})`);
  for (const [s, why] of LIVE_ONLY) r.skip(s, why);
  r.summary();
  console.log('suite-c: SKIP (no lineage runtime)');
  process.exit(0);
}

const box = makeSandbox('xtrm-p201-c-');
const { project, installPrefix, tmuxTmp } = box;
const env = { ...box.env, TMUX_TMPDIR: tmuxTmp };
const tmux = (...args) => run(TMUX, ['-L', SOCKET, ...args], { env });
const git = (cwd, ...args) => run(GIT, args, { cwd, env });

function sleepMs(ms) {
  run('sh', ['-c', `sleep ${ms / 1000}`]);
}

// Prepended to every pane command. tmux's `-e PATH=…` does NOT survive into the
// pane: tmux runs the pane shell as a login shell, which re-sources the
// profile and rebuilds PATH from scratch. Exporting inside the command is the
// only placement the profile cannot undo — without it the pane silently
// resolves the operator's REAL `sp`/`claude` instead of the sandbox shims.
let panePathPrefix = '';

// Run a command inside a live pane so Core sees a real $TMUX and a real parent
// session. Output is captured through a sentinel file and polled — no reliance
// on prompt timing. Same technique as Suite B's paneRun.
function paneRun(paneId, tag, shellCmd, tries = 160) {
  const outFile = path.join(box.root, `${tag}.out`);
  const doneFile = path.join(box.root, `${tag}.done`);
  rmSync(outFile, { force: true });
  rmSync(doneFile, { force: true });
  tmux('send-keys', '-t', paneId, `{ ${panePathPrefix}${shellCmd} ; } > ${outFile} 2>&1; echo $? > ${doneFile}`, 'Enter');
  for (let i = 0; i < tries; i++) {
    if (existsSync(doneFile)) {
      return {
        rc: parseInt(readFileSync(doneFile, 'utf8').trim(), 10),
        out: existsSync(outFile) ? readFileSync(outFile, 'utf8') : '',
      };
    }
    sleepMs(125);
  }
  throw new Error(`paneRun(${tag}) timed out`);
}

const paneOption = (paneId, key) =>
  tmux('show-options', '-p', '-t', paneId, '-qv', key).stdout.trim();

function writeShim(dir, name, body) {
  const file = path.join(dir, name);
  writeFileSync(file, body);
  chmodSync(file, 0o755);
  return file;
}

try {
  // ── fixture: packed Core + shimmed sp/runtime on an isolated PATH ──────────
  const installed = run('npm', [
    'install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-save',
    '--prefix', installPrefix, coreTgz,
  ], { cwd: project, env });
  assert.equal(installed.status, 0, `core install failed: ${installed.stderr.slice(-800)}`);

  const cli = path.join(installPrefix, 'node_modules', 'xtrm-tools', 'cli', 'dist', 'index.cjs');
  assert.ok(existsSync(cli), 'core: cli/dist/index.cjs missing from packed install');

  const bin = path.join(box.root, 'bin');
  mkdirSync(bin, { recursive: true });
  writeShim(bin, 'xt', `#!/bin/sh\nexec "${process.execPath}" "${cli}" "$@"\n`);
  // Runtime shim: stays alive so the pane (and its @agent_* options) survives
  // long enough to be inspected. Args are irrelevant — Core's contract here is
  // the metadata it writes, not what the agent does with the prompt.
  writeShim(bin, 'claude', '#!/bin/sh\nexec sleep 120\n');
  // sp shim: answers the three sub-commands the role launch path calls. The
  // JSON mirrors the real chain-coordinator envelope's shape (P1-01).
  writeShim(bin, 'sp', [
    '#!/bin/sh',
    'case "$1" in',
    '  view) printf \'%s\\n\' \'{"specialist":{"metadata":{"name":"chain-coordinator"},"execution":{"interactive":true},"prompt":{"system":"You coordinate one epic."},"skills":{"paths":[]}}}\' ;;',
    '  render-skill-prefix) exit 1 ;;',
    `  render-task) printf '%s\\n' '{"ok":true,"initial_prompt":"Coordinate ${BEAD}.","prompt_hash":"suite-c-fixture","components":[]}' ;;`,
    '  *) exit 1 ;;',
    'esac',
  ].join('\n') + '\n');
  panePathPrefix = `export PATH="${bin}:$PATH"; `;

  // Throwaway git repo standing in for the operator's main checkout.
  mkdirSync(project, { recursive: true });
  assert.equal(git(project, 'init', '-b', 'main').status, 0, 'git init failed');
  git(project, 'config', 'user.email', 'suite-c@example.invalid');
  git(project, 'config', 'user.name', 'suite-c');
  writeFileSync(path.join(project, 'README.md'), '# suite-c fixture\n');
  // Mirror a real xtrm repo: the worktree root is ignored, so step 11's
  // porcelain check stays meaningful (it catches real edits to main's tree
  // rather than tripping over the coordinator's own worktree directory).
  writeFileSync(path.join(project, '.gitignore'), '.xtrm/\n');
  git(project, 'add', '-A');
  assert.equal(git(project, 'commit', '-m', 'fixture').status, 0, 'fixture commit failed');
  const mainShaBefore = git(project, 'rev-parse', 'main').stdout.trim();
  assert.ok(mainShaBefore, 'could not resolve fixture main sha');

  // ── STEP 2: launch main orchestrator from the main worktree ───────────────
  const started = tmux(
    'new-session', '-d', '-s', 'orch', '-x', '200', '-y', '50', '-c', project,
    '-e', `XDG_STATE_HOME=${box.state}`, '-e', `TMUX_TMPDIR=${tmuxTmp}`,
    '-e', `HOME=${box.home}`, 'sh',
  );
  assert.equal(started.status, 0, `tmux new-session orch failed: ${started.stderr}`);
  const orchPane = tmux('list-panes', '-t', 'orch', '-F', '#{pane_id}').stdout.trim();
  const orchSession = tmux('display-message', '-p', '-t', 'orch', '#{session_id}').stdout.trim();
  assert.ok(orchPane && orchSession, 'could not resolve orchestrator pane/session');
  const orchCwd = tmux('display-message', '-p', '-t', orchPane, '#{pane_current_path}').stdout.trim();
  // The orchestrator sits in the MAIN worktree — the invariant P1-02 names.
  assert.ok(!orchCwd.includes(path.join('.xtrm', 'worktrees')), `orchestrator is not in the main worktree: ${orchCwd}`);
  r.ok('step 2: launch main orchestrator from main worktree', `${orchSession} @ ${orchCwd}`);

  // ── STEP 3: launch subordinate chain coordinator through Core ─────────────
  const launch = paneRun(
    orchPane, 'launch',
    `xt claude ${SLUG} --role chain-coordinator --bead ${BEAD} --subordinate`,
  );
  assert.equal(launch.rc, 0, `xt --subordinate failed (rc=${launch.rc}):\n${launch.out.slice(-2000)}`);

  // --no-attach stdout contract: exactly one `session_name:pane_id` line, even
  // though the human-facing launcher chatter shares the same stream.
  const coordLine = launch.out.split('\n').map((l) => l.trim())
    .filter((l) => /^role-claude-chain-coordinator[\w.-]*:%\d+$/.test(l));
  assert.equal(coordLine.length, 1, `expected exactly one session:pane line, got ${coordLine.length}:\n${launch.out.slice(-2000)}`);
  const [coordSessionName, coordPane] = coordLine[0].split(':');
  // The orchestrator's own pane was NOT hijacked — the whole point of P0-05.
  assert.notEqual(coordPane, orchPane, '--subordinate ran in the orchestrator pane');
  assert.equal(paneOption(orchPane, '@agent_role'), '', 'orchestrator pane acquired coordinator metadata');
  r.ok('step 3: launch subordinate chain coordinator through Core', coordLine[0]);

  // ── STEP 4: verify distinct coordinator worktree and branch ───────────────
  const coordWorktree = paneOption(coordPane, '@agent_worktree');
  const coordBranch = paneOption(coordPane, '@agent_branch');
  assert.ok(coordWorktree && existsSync(coordWorktree), `@agent_worktree missing or absent on disk: ${coordWorktree}`);
  assert.ok(
    coordWorktree.startsWith(path.join(project, '.xtrm', 'worktrees') + path.sep),
    `coordinator worktree is not under the repo's worktree root: ${coordWorktree}`,
  );
  assert.notEqual(coordWorktree, project, 'coordinator is using the main worktree');
  const headBranch = git(coordWorktree, 'rev-parse', '--abbrev-ref', 'HEAD').stdout.trim();
  assert.equal(headBranch, coordBranch, `@agent_branch (${coordBranch}) disagrees with the checked-out branch (${headBranch})`);
  assert.notEqual(headBranch, 'main', 'coordinator branch is not distinct from main');
  r.ok('step 4: verify distinct coordinator worktree and branch', `${coordBranch} @ ${coordWorktree}`);

  // ── STEP 5: verify parent session, role and bead pane metadata ────────────
  assert.equal(paneOption(coordPane, '@agent_parent_session'), orchSession, '@agent_parent_session does not point at the orchestrator');
  assert.equal(paneOption(coordPane, '@agent_role'), 'chain-coordinator', '@agent_role missing or wrong');
  assert.equal(paneOption(coordPane, '@agent_bead'), BEAD, '@agent_bead missing or wrong');
  assert.equal(paneOption(coordPane, '@agent_task'), 'role:chain-coordinator', '@agent_task missing or wrong');
  assert.equal(paneOption(coordPane, '@agent_state'), 'idle', '@agent_state not primed to idle');
  r.ok('step 5: verify parent session, role and bead pane metadata', `parent=${orchSession} role=chain-coordinator bead=${BEAD}`);

  // ── STEPS 7-10: live specialist chain (not assertable here) ───────────────
  for (const [s, why] of LIVE_ONLY) r.skip(s, why);

  // ── STEP 11: confirm main remains unchanged ───────────────────────────────
  assert.equal(git(project, 'rev-parse', 'main').stdout.trim(), mainShaBefore, 'main moved during a coordinator launch');
  assert.equal(git(project, 'rev-parse', '--abbrev-ref', 'HEAD').stdout.trim(), 'main', 'main worktree left the main branch');
  assert.equal(git(project, 'status', '--porcelain').stdout.trim(), '', 'coordinator launch dirtied the main worktree');
  r.ok('step 11: confirm main remains unchanged', mainShaBefore.slice(0, 12));

  const summary = r.summary();
  console.log(`suite-c: ${summary.blocked ? 'BLOCKED' : 'PASS'} (${summary.pass} live, ${summary.skip} deferred to a live-agent lane)`);
  process.exit(0);
} catch (error) {
  console.error(`\n  [FAIL] suite-c: ${error?.message ?? error}`);
  r.summary();
  process.exit(1);
} finally {
  tmux('kill-server');
  box.cleanup();
}
