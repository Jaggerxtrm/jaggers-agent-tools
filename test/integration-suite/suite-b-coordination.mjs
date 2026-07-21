// Suite B — coordination-lifecycle conformance (audit §P2-01 steps 12-18).
//
// Drives the reply-obligation + wake + read-only-bridge lifecycle against a
// FULLY ISOLATED xtmux runtime: a private tmux server (`tmux -L`) and a private
// XDG_STATE_HOME. The operator's live tmux server and 300MB observability.db are
// never touched.
//
// Capability-gated: if tmux or the xtmux binary is unavailable, or a private
// server cannot be created, every step is reported SKIP and the process exits 0.
// This keeps the suite green on runners that lack a coordination runtime while
// still asserting hard where the runtime is present (local dev, ubuntu-latest).
//
// xtmux binary resolution: PATH by default; override with P201_XTMUX_BIN to
// point at a packed-install bin for stricter installed-artifact fidelity. Suite
// A already asserts the packed xtmux version conforms to Core's compat window.

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { makeSandbox, reporter, run } from './lib/harness.mjs';

const XTMUX = process.env.P201_XTMUX_BIN || which('xtmux');
const TMUX = which('tmux');
const SOCKET = `p201-${process.pid}`;
const r = reporter('suite-b');

function which(bin) {
  const res = run('sh', ['-c', `command -v ${bin} || true`]);
  const p = res.stdout.trim();
  return p && existsSync(p) ? p : null;
}

// ── capability gate ────────────────────────────────────────────────────────
if (!TMUX || !XTMUX) {
  const missing = [!TMUX && 'tmux', !XTMUX && 'xtmux'].filter(Boolean).join(' + ');
  for (const s of ['step 12-16 (message/obligation/wake)', 'step 17-18 (read-only bridge)']) {
    r.skip(s, `coordination runtime unavailable (missing ${missing})`);
  }
  r.summary();
  console.log('suite-b: SKIP (no coordination runtime)');
  process.exit(0);
}

const box = makeSandbox('xtrm-p201-b-');
const tmuxTmp = box.tmuxTmp;
const stateEnv = { ...box.env, TMUX_TMPDIR: tmuxTmp };

const tmux = (...args) => run(TMUX, ['-L', SOCKET, ...args], { env: stateEnv });

// Run a command inside a live pane (so xtmux attributes ownership to it) and
// return { rc, out }. Output is captured to a sandbox file via a sentinel, then
// polled — deterministic, no reliance on prompt timing.
function paneRun(paneId, tag, shellCmd) {
  const outFile = path.join(box.root, `${tag}.out`);
  const doneFile = path.join(box.root, `${tag}.done`);
  rmSync(outFile, { force: true });
  rmSync(doneFile, { force: true });
  tmux('send-keys', '-t', paneId, `{ ${shellCmd} ; } > ${outFile} 2>&1; echo $? > ${doneFile}`, 'Enter');
  for (let i = 0; i < 80; i++) {
    if (existsSync(doneFile)) {
      const rc = parseInt(readFileSync(doneFile, 'utf8').trim(), 10);
      const out = existsSync(outFile) ? readFileSync(outFile, 'utf8') : '';
      return { rc, out };
    }
    sleepMs(125);
  }
  throw new Error(`paneRun(${tag}) timed out`);
}

function sleepMs(ms) {
  // Synchronous sleep via a blocking child — keeps the runner linear/readable.
  run('sh', ['-c', `sleep ${ms / 1000}`]);
}

const xt = (paneId, tag, args) => paneRun(paneId, tag, `'${XTMUX}' ${args}`);
const parseJson = (out) => JSON.parse(out.trim().split('\n').filter(Boolean).pop());

try {
  // Private server; sh panes carry the isolated env so xtmux writes only to the
  // sandbox state db.
  const mk = (name) => {
    const res = tmux('new-session', '-d', '-s', name, '-x', '200', '-y', '50',
      '-e', `XDG_STATE_HOME=${box.state}`, '-e', `TMUX_TMPDIR=${tmuxTmp}`, 'sh');
    assert.equal(res.status, 0, `tmux new-session ${name} failed: ${res.stderr}`);
  };
  mk('orch');
  mk('coord');
  const oPane = tmux('list-panes', '-t', 'orch', '-F', '#{pane_id}').stdout.trim();
  const cPane = tmux('list-panes', '-t', 'coord', '-F', '#{pane_id}').stdout.trim();
  assert.ok(oPane && cPane, 'could not resolve isolated pane ids');

  // ── STEP 12: reply-required message from coordinator to main orchestrator ──
  const sent = xt(cPane, 'send',
    `message-send --to orch --to-pane '${oPane}' --from-pane '${cPane}' --text 'decision: A or B' --expects-reply --json`);
  assert.equal(sent.rc, 0, `message-send failed: ${sent.out}`);
  const msg = parseJson(sent.out);
  assert.equal(msg.expectsReply, true, 'message not marked reply-required');
  assert.equal(msg.senderPaneId, cPane, 'obligation not attributed to coordinator pane');
  const key = msg.messageKey;
  const mid = msg.messageId;

  let obl = parseJson(xt(cPane, 'obl0', `obligations list --pane '${cPane}' --json`).out);
  let mine = obl.find((o) => o.messageKey === key);
  assert.ok(mine, 'reply-required obligation not owned by coordinator pane');
  assert.equal(mine.replyStatus, 'pending', 'fresh obligation should be pending');
  assert.equal(mine.acked, false, 'fresh obligation should be unacked');
  r.ok('step 12: reply-required message → pending obligation', `key=${key}`);

  // ── STEP 13: acknowledge receipt WITHOUT fulfilling ────────────────────────
  const ack = xt(oPane, 'ack', `message-ack '${mid}' --by orch --json`);
  assert.equal(ack.rc, 0, `message-ack failed: ${ack.out}`);
  assert.equal(parseJson(ack.out).acked, true, 'ack did not record receipt');
  obl = parseJson(xt(cPane, 'obl1', `obligations list --pane '${cPane}' --json`).out);
  mine = obl.find((o) => o.messageKey === key);
  assert.ok(mine, 'obligation vanished on ack — ack must NOT fulfil');
  assert.equal(mine.replyStatus, 'pending', 'ack wrongly moved obligation past pending');
  assert.equal(mine.acked, true, 'ack not reflected on obligation');
  r.ok('step 13: ack is receipt-only (obligation still pending)', 'acked=true, replyStatus=pending');

  // ── STEP 14: correlated reply from the correct (recipient) pane ────────────
  const reply = xt(oPane, 'reply', `message-reply --in-reply-to '${key}' --text 'choose A' --json`);
  assert.equal(reply.rc, 0, `message-reply failed: ${reply.out}`);
  const rep = parseJson(reply.out);
  assert.equal(rep.fulfilled, true, 'reply did not fulfil the obligation');
  assert.equal(rep.senderPaneId, oPane, 'reply not attributed to the recipient pane');
  obl = parseJson(xt(cPane, 'obl2', `obligations list --pane '${cPane}' --json`).out);
  assert.ok(!obl.find((o) => o.messageKey === key), 'obligation still pending after correlated reply');
  r.ok('step 14: correlated reply fulfils obligation', 'fulfilled=true, obligation cleared');

  // ── STEP 15: consume the resulting wake exactly once ───────────────────────
  // The reply is the requester's continuation/wake. Exactly-once is enforced by
  // the durable store: a second reply to the same correlation is rejected rather
  // than producing a duplicate continuation.
  const dup = xt(oPane, 'reply2', `message-reply --in-reply-to '${key}' --text 'choose A again' --json`);
  const dupText = dup.out;
  assert.ok(
    dup.rc !== 0 || /CONFLICT|duplicate|already/i.test(dupText),
    `second reply was not rejected — wake could be consumed twice: ${dupText}`,
  );
  r.ok('step 15: wake consumed exactly once', 'second reply rejected (no double continuation)');

  // ── STEP 16: restart the adapter → no duplicate continuation ───────────────
  // A fresh xtmux process (new adapter instance) reading the SAME durable SQLite
  // must see the obligation gone and exactly one fulfilment — no replay.
  const afterRestart = parseJson(xt(cPane, 'obl3', `obligations list --pane '${cPane}' --json`).out);
  assert.ok(!afterRestart.find((o) => o.messageKey === key), 'restart replayed a fulfilled obligation');
  const status = xt(cPane, 'status', `message-status '${key}' --json`);
  assert.equal(status.rc, 0, `message-status failed: ${status.out}`);
  assert.match(status.out, new RegExp(key), 'durable status lost the message across restart');
  r.ok('step 16: restart replays no duplicate continuation', 'fresh process sees single fulfilment');

  // ── STEP 17: query the same state through the read-only bridge ─────────────
  const bridgeReq = [
    '{"id":1,"method":"bridge.hello"}',
    '{"id":2,"method":"topology.snapshot"}',
    '{"id":3,"method":"journal.query","params":{"limit":1}}',
    '{"id":4,"method":"bridge.mutate","params":{}}',
    '{"id":5,"method":"topology.mutate","params":{}}',
    '',
  ].join('\n');
  const bridge = run(XTMUX, ['bridge', '--stdio'], {
    env: { ...stateEnv, XTMUX_BRIDGE_READ_ONLY: '1' },
    input: bridgeReq,
  });
  const frames = bridge.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const byId = Object.fromEntries(frames.map((f) => [f.id, f]));
  assert.equal(byId[1]?.result?.read_only, true, 'bridge did not report read_only');
  assert.ok(byId[2]?.result?.topology?.sessions, 'bridge topology.snapshot returned no state');
  assert.ok('result' in (byId[3] || {}), 'bridge journal.query failed');
  r.ok('step 17: read-only bridge returns state', 'hello.read_only=true, topology + journal served');

  // ── STEP 18: remote mutation methods are refused ───────────────────────────
  const refused = (f) => f && (f.error || (f.result && f.result.refused));
  assert.ok(refused(byId[4]), 'bridge.mutate was NOT refused');
  assert.ok(refused(byId[5]), 'topology.mutate was NOT refused');
  r.ok('step 18: remote mutation refused', 'bridge.mutate + topology.mutate rejected');

  tmux('kill-server');
  r.summary();
  console.log('suite-b: PASS');
  process.exit(0);
} catch (err) {
  try { tmux('kill-server'); } catch { /* best effort */ }
  r.summary();
  console.error('suite-b: FAIL');
  console.error(err?.message || err);
  process.exit(1);
} finally {
  box.cleanup();
}
