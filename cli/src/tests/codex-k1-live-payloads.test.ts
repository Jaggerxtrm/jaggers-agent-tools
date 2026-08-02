/**
 * Codex 0.146.0 LIVE hook-payload characterization (KAN-127 K1 / beads xtrm-ozknq.5)
 *
 * Sibling of codex-k1-payload-fixtures.test.ts. That suite pins the schemas Codex
 * DECLARES (read statically out of the 0.146.0 binary). This suite pins what Codex
 * actually EMITTED during an operator-approved capture window on 2026-08-02, and
 * checks the two against each other.
 *
 * Evidence: fixtures/codex/0.146.0/live/*.observed.json (raw hook stdin, redacted) and
 * fixtures/codex/0.146.0/live/rollout-0.146.0.observed.jsonl (a real 0.146.0 rollout).
 * Provenance, the exact capture command, the hook mechanism, the redaction rule
 * and the remaining evidence gaps live in fixtures/codex/0.146.0/manifest.json -> live.
 *
 * CHARACTERIZATION ONLY: these assertions describe the contract as it is today so
 * that a shared-launcher refactor or a Codex version bump cannot change it
 * silently. They say nothing about what the contract SHOULD be.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const FIXTURE_DIR = resolve(__dirname, 'fixtures', 'codex', '0.146.0');
const LIVE_DIR = join(FIXTURE_DIR, 'live');

const manifest = JSON.parse(readFileSync(join(FIXTURE_DIR, 'manifest.json'), 'utf8'));
const live = manifest.live;

const readLive = (file: string): string => readFileSync(join(LIVE_DIR, file), 'utf8');
const readLiveJson = (file: string): Record<string, unknown> =>
  JSON.parse(readLive(file)) as Record<string, unknown>;
const readSchema = (file: string): any => JSON.parse(readFileSync(join(FIXTURE_DIR, file), 'utf8'));

const observed = {
  sessionStart: readLiveJson('session-start.observed.json'),
  userPromptSubmit: readLiveJson('user-prompt-submit.observed.json'),
  stop: readLiveJson('stop.observed.json'),
  sessionEnd: readLiveJson('session-end.observed.json'),
};

const ROLLOUT_FILE = 'rollout-0.146.0.observed.jsonl';
const rolloutLines = readLive(ROLLOUT_FILE)
  .split('\n')
  .filter(l => l.length > 0)
  .map(l => JSON.parse(l) as { type: string; timestamp: string; payload: any });

const rolloutOfType = (type: string) => rolloutLines.filter(l => l.type === type);
const soleRolloutLine = (type: string) => {
  const hits = rolloutOfType(type);
  expect(hits, `expected exactly one ${type} line`).toHaveLength(1);
  return hits[0];
};

/** The session UUID Codex used for the hook-capture run. */
const CAPTURE_SESSION_ID = '019fc3d5-fb32-7f80-b292-9134f94f01eb';
/** The turn UUID for the single turn of that run. */
const CAPTURE_TURN_ID = '019fc3d5-fbbd-7d03-9e18-1ec6b74b8dd2';

// ── 4.1 Live fixture integrity + provenance ───────────────────────────────────

describe('codex live capture provenance', () => {
  it('records runtime, version, capture command and capture date', () => {
    expect(live.runtime).toBe('codex');
    expect(live.runtime_version).toBe('codex-cli 0.146.0');
    expect(live.capture_date).toBe('2026-08-02');
    expect(live.codex_home).toBe('<CODEX_HOME>');
    expect(live.capture_command).toBe(
      'codex exec --skip-git-repo-check -s read-only -C <empty tmp dir> --json -o <file> "reply with the single word ok"',
    );
    expect(live.sandbox_flag_used).toBe('-s read-only');
  });

  it('records that hook trust was granted interactively and no bypass flag was used', () => {
    // The capture must never be readable as evidence that a bypass flag is safe
    // or normal. It was not used.
    expect(live.hook_mechanism.trust).toContain('INTERACTIVELY');
    expect(live.hook_mechanism.trust).toContain('--dangerously-bypass-hook-trust was NOT used');
    expect(live.hook_mechanism.summary).toContain('cat > <file>');
    expect(live.hook_mechanism.hook_marker).toContain('xtrm-k1-capture');
    expect(live.hook_mechanism.teardown).toContain('restored byte-identically');
  });

  it('lists exactly the five live fixture files', () => {
    const files = Object.keys(live.files).sort();
    expect(files).toEqual([
      'rollout-0.146.0.observed.jsonl',
      'session-end.observed.json',
      'session-start.observed.json',
      'stop.observed.json',
      'user-prompt-submit.observed.json',
    ]);
    expect(files).toHaveLength(live.expected_file_count);
  });

  it.each(
    Object.keys(
      JSON.parse(readFileSync(join(FIXTURE_DIR, 'manifest.json'), 'utf8')).live.files as Record<string, unknown>,
    ).sort(),
  )('live/%s matches the sha256 recorded in the manifest', (file: string) => {
    const raw = readFileSync(join(LIVE_DIR, file));
    const actual = createHash('sha256').update(raw).digest('hex');
    expect(actual, `live/${file} was edited without updating manifest.json`).toBe(live.files[file].sha256);
    expect(raw.byteLength, `live/${file} byte length drifted`).toBe(live.files[file].bytes);
  });

  it('documents that the rollout is a different session than the hook capture', () => {
    // Honesty gate: the two artifacts are both real 0.146.0 evidence, but they are
    // not the same run. Any claim that joins them must say so.
    const gaps = (live.documented_gaps as string[]).join('\n');
    expect(gaps).toContain('is NOT the transcript of the hook-capture session');
    expect(gaps).toContain('unauthorized');
    expect(gaps).toContain('last_assistant_message as possibly null');
  });
});

// ── 4.2 Schema-vs-reality conformance ─────────────────────────────────────────

const conformanceCases: Array<[string, Record<string, unknown>, string]> = [
  ['SessionStart', observed.sessionStart, 'session-start.command.input.json'],
  ['UserPromptSubmit', observed.userPromptSubmit, 'user-prompt-submit.command.input.json'],
  ['Stop', observed.stop, 'stop.command.input.json'],
  ['SessionEnd', observed.sessionEnd, 'session-end.command.input.json'],
];

describe('observed payload conforms to the schema codex declares', () => {
  it.each(conformanceCases)(
    '%s carries every required key the schema declares',
    (event, payload, schemaFile) => {
      const schema = readSchema(schemaFile);
      expect(payload.hook_event_name).toBe(event);
      expect(schema.properties.hook_event_name.const).toBe(event);
      for (const key of schema.required as string[]) {
        expect(Object.keys(payload), `${event} is missing required key ${key}`).toContain(key);
      }
    },
  );

  it.each(conformanceCases)(
    '%s carries no key the schema does not declare',
    (event, payload, schemaFile) => {
      // The schemas declare additionalProperties:false, so an undeclared observed
      // key would mean Codex emits payloads its own schema rejects. If this ever
      // fails, the OBSERVED reality wins and the finding must be written up —
      // do not "fix" it by widening the schema fixture.
      const declared = Object.keys(readSchema(schemaFile).properties as Record<string, unknown>);
      const undeclared = Object.keys(payload).filter(k => !declared.includes(k));
      expect(undeclared, `${event} emitted keys absent from its schema: ${undeclared.join(', ')}`).toEqual([]);
    },
  );

  it('pins the exact observed key set of each of the four events', () => {
    // Verbatim reality, in emission order. A Codex version bump that adds or drops
    // a key fails here, which is the point.
    expect(Object.keys(observed.sessionStart)).toEqual([
      'session_id',
      'transcript_path',
      'cwd',
      'hook_event_name',
      'model',
      'permission_mode',
      'source',
    ]);
    expect(Object.keys(observed.userPromptSubmit)).toEqual([
      'session_id',
      'turn_id',
      'transcript_path',
      'cwd',
      'hook_event_name',
      'model',
      'permission_mode',
      'prompt',
    ]);
    expect(Object.keys(observed.stop)).toEqual([
      'session_id',
      'turn_id',
      'transcript_path',
      'cwd',
      'hook_event_name',
      'model',
      'permission_mode',
      'stop_hook_active',
      'last_assistant_message',
    ]);
    expect(Object.keys(observed.sessionEnd)).toEqual([
      'session_id',
      'transcript_path',
      'cwd',
      'hook_event_name',
      'reason',
    ]);
  });

  it('emits none of the optional keys the schemas allow but the run did not exercise', () => {
    // user-prompt-submit declares agent_id and agent_type as OPTIONAL. The capture
    // was a single-agent `codex exec` run and emitted neither. An adapter must not
    // assume they are present.
    const schema = readSchema('user-prompt-submit.command.input.json');
    expect(Object.keys(schema.properties)).toContain('agent_id');
    expect(Object.keys(schema.properties)).toContain('agent_type');
    expect(schema.required).not.toContain('agent_id');
    expect(schema.required).not.toContain('agent_type');
    expect(observed.userPromptSubmit.agent_id).toBeUndefined();
    expect(observed.userPromptSubmit.agent_type).toBeUndefined();
  });

  it('reports the same model on every model-carrying event', () => {
    expect(observed.sessionStart.model).toBe('gpt-5.6-sol');
    expect(observed.userPromptSubmit.model).toBe('gpt-5.6-sol');
    expect(observed.stop.model).toBe('gpt-5.6-sol');
  });

  it('reports source=startup on SessionStart', () => {
    expect(observed.sessionStart.source).toBe('startup');
    expect(readSchema('session-start.command.input.json').properties.source.enum).toContain('startup');
  });
});

// ── 4.3 Stop hands the assistant text over directly ───────────────────────────

describe('Stop carries the assistant message in the payload', () => {
  it('exposes last_assistant_message as a non-empty string', () => {
    // THE SINGLE MOST IMPORTANT ADAPTER DIFFERENCE (xtrm-ozknq.5).
    //
    // The Claude turn-capture hook has to tail-read transcript_path and scan
    // BACKWARDS for the last assistant entry
    // (xtmux hooks/claude/claude-agent-turn-capture.mjs:41-84). Codex does not
    // require that: it hands the assistant text over inside the Stop payload.
    //
    // xtmux must NOT port the Claude transcript-scraping approach to Codex. Doing
    // so would add a filesystem read, a parse, and a race against rollout flush,
    // to recover a value already sitting in stdin.
    const value = observed.stop.last_assistant_message;
    expect(typeof value).toBe('string');
    expect((value as string).length).toBeGreaterThan(0);
    expect(value).toBe('ok');
  });

  it('matches the agent_message the --json event stream reported for the same turn', () => {
    // The recorded --json stream for this run emitted
    // item.completed -> item.type=agent_message -> text="ok". The hook payload and
    // the event stream agree, so an adapter may use either surface for turn text.
    const itemCompleted = (live.observed_event_stream as string[]).map(l => JSON.parse(l)).find(
      (e: any) => e.type === 'item.completed',
    );
    expect(itemCompleted.item.type).toBe('agent_message');
    expect(itemCompleted.item.text).toBe(observed.stop.last_assistant_message);
  });

  it('declares last_assistant_message REQUIRED but NULLABLE, so null must be handled', () => {
    // Schema-vs-reality nuance: the key is always present, but its type is
    // NullableString. The captured value is non-null only because the turn
    // succeeded. The auth-failed rollout in this same fixture set records
    // task_complete.last_agent_message = null, which is the shape an adapter will
    // meet on a failed turn. Treat the value as `string | null`, never `string`.
    const schema = readSchema('stop.command.input.json');
    expect(schema.required).toContain('last_assistant_message');
    expect(schema.properties.last_assistant_message.$ref).toBe('#/definitions/NullableString');

    const taskComplete = rolloutOfType('event_msg').find(l => l.payload.type === 'task_complete');
    expect(taskComplete!.payload.last_agent_message).toBeNull();
    expect(taskComplete!.payload.error.codex_error_info).toBe('unauthorized');
  });

  it('reports stop_hook_active=false on a first, non-reentrant Stop', () => {
    expect(observed.stop.stop_hook_active).toBe(false);
  });
});

// ── 4.4 The identity join ─────────────────────────────────────────────────────

describe('session_id is the one join key', () => {
  it('is identical across all four hook payloads', () => {
    expect(observed.sessionStart.session_id).toBe(CAPTURE_SESSION_ID);
    expect(observed.userPromptSubmit.session_id).toBe(CAPTURE_SESSION_ID);
    expect(observed.stop.session_id).toBe(CAPTURE_SESSION_ID);
    expect(observed.sessionEnd.session_id).toBe(CAPTURE_SESSION_ID);
  });

  it('equals the thread_id the --json event stream reported', () => {
    // Surface 2 of 4: `codex exec --json` announces the run as thread.started with
    // a thread_id. That thread_id IS the hook session_id — no translation table.
    const started = (live.observed_event_stream as string[]).map(l => JSON.parse(l)).find(
      (e: any) => e.type === 'thread.started',
    );
    expect(started.thread_id).toBe(CAPTURE_SESSION_ID);
  });

  it('appears in the rollout filename inside transcript_path', () => {
    // Surface 3 of 4: the rollout file is named
    // rollout-<iso-local-timestamp>-<session_id>.jsonl under
    // <CODEX_HOME>/sessions/<yyyy>/<mm>/<dd>/. An adapter can locate the transcript
    // from the session id alone, and can recover the session id from a bare path.
    const paths = [
      observed.sessionStart.transcript_path,
      observed.userPromptSubmit.transcript_path,
      observed.stop.transcript_path,
      observed.sessionEnd.transcript_path,
    ] as string[];
    for (const p of paths) {
      expect(p).toBe(
        `<CODEX_HOME>/sessions/2026/08/02/rollout-2026-08-02T20-56-48-${CAPTURE_SESSION_ID}.jsonl`,
      );
      const basename = p.split('/').pop()!;
      expect(basename).toMatch(
        /^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/,
      );
      expect(basename).toContain(CAPTURE_SESSION_ID);
    }
    // All four events point at the same transcript.
    expect(new Set(paths).size).toBe(1);
  });

  it('is repeated as both id and session_id inside the rollout session_meta', () => {
    // Surface 4 of 4: the rollout header carries the same UUID twice, under `id`
    // and under `session_id`. `id` is also what the state DB stores as threads.id.
    //
    // DOCUMENTED GAP: the rollout fixture is a DIFFERENT run than the hook capture
    // (see manifest.live.documented_gaps), so this pins the WITHIN-artifact join
    // shape, not a cross-artifact match with CAPTURE_SESSION_ID.
    const meta = soleRolloutLine('session_meta');
    expect(meta.payload.id).toBe(meta.payload.session_id);
    expect(meta.payload.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(meta.payload.id).toBe('019fc3bc-fb7a-7ae0-9536-125624bf726b');
    expect(meta.payload.id).not.toBe(CAPTURE_SESSION_ID);
  });
});

// ── 4.5 The turn-correlation contract ─────────────────────────────────────────

describe('turn_id correlates a turn and only a turn', () => {
  it('is identical on UserPromptSubmit and Stop', () => {
    expect(observed.userPromptSubmit.turn_id).toBe(CAPTURE_TURN_ID);
    expect(observed.stop.turn_id).toBe(CAPTURE_TURN_ID);
    expect(observed.stop.turn_id).toBe(observed.userPromptSubmit.turn_id);
  });

  it('is a different UUID than session_id', () => {
    expect(observed.stop.turn_id).not.toBe(observed.stop.session_id);
  });

  it('is absent from SessionStart and SessionEnd', () => {
    // Session-scoped events have no turn to name. An adapter keyed on turn_id has
    // nothing to key on at session open/close and must fall back to session_id.
    expect(Object.keys(observed.sessionStart)).not.toContain('turn_id');
    expect(Object.keys(observed.sessionEnd)).not.toContain('turn_id');
    expect(observed.sessionStart.turn_id).toBeUndefined();
    expect(observed.sessionEnd.turn_id).toBeUndefined();
  });

  it('is the same id the rollout uses to tag task_started, turn_context and task_complete', () => {
    const started = rolloutOfType('event_msg').find(l => l.payload.type === 'task_started')!;
    const complete = rolloutOfType('event_msg').find(l => l.payload.type === 'task_complete')!;
    const turnContext = soleRolloutLine('turn_context');
    expect(turnContext.payload.turn_id).toBe(started.payload.turn_id);
    expect(complete.payload.turn_id).toBe(started.payload.turn_id);
  });
});

// ── 4.6 SessionEnd is the thinnest payload ────────────────────────────────────

describe('SessionEnd', () => {
  it('reports reason "other"', () => {
    // The schema declares reason as a const, not an enum, and reality agrees: Codex
    // reports exactly one end reason. An adapter cannot tell a clean exit from a
    // crash or a logout at SessionEnd.
    expect(observed.sessionEnd.reason).toBe('other');
    expect(readSchema('session-end.command.input.json').properties.reason.const).toBe('other');
  });

  it('carries no model and no permission_mode', () => {
    // Anything an adapter wants to know about the model or the mode at teardown
    // must be carried over from SessionStart, keyed by session_id.
    expect(Object.keys(observed.sessionEnd)).not.toContain('model');
    expect(Object.keys(observed.sessionEnd)).not.toContain('permission_mode');
    expect(observed.sessionEnd.model).toBeUndefined();
    expect(observed.sessionEnd.permission_mode).toBeUndefined();
  });
});

// ── 4.7 NEGATIVE PROOF: the permission_mode trap ──────────────────────────────

describe('permission_mode is NOT the sandbox setting', () => {
  it('reports bypassPermissions on every event even though the run used -s read-only', () => {
    // ############################################################################
    // CHARACTERIZATION + TRAP (xtrm-ozknq.5)
    //
    // The capture ran:
    //   codex exec --skip-git-repo-check -s read-only -C <empty tmp dir> --json ...
    //
    // Every hook payload nevertheless reports permission_mode="bypassPermissions".
    // permission_mode does NOT reflect --sandbox. It is a separate axis, and on a
    // non-interactive `codex exec` run it reads as bypassPermissions regardless of
    // how tightly the sandbox is clamped.
    //
    // CONSEQUENCE: any safety-profile assertion that trusts permission_mode from a
    // hook payload is WRONG. A launch outcome must record the safety profile from
    // the argv Core actually emitted, never from a hook payload.
    //
    // This test exists to FAIL LOUDLY if someone "fixes" the fixture to agree with
    // the sandbox flag. The disagreement is the finding.
    // ############################################################################
    expect(live.sandbox_flag_used).toBe('-s read-only');
    expect(observed.sessionStart.permission_mode).toBe('bypassPermissions');
    expect(observed.userPromptSubmit.permission_mode).toBe('bypassPermissions');
    expect(observed.stop.permission_mode).toBe('bypassPermissions');
    expect(live.trap).toContain('Never derive a safety profile from a hook payload');
  });

  it('is contradicted by the rollout, which records the read-only sandbox truthfully', () => {
    // The rollout DOES carry the real safety posture, under different key names:
    // turn_context.sandbox_policy.type and turn_context.permission_profile. Neither
    // is called permission_mode, and permission_mode does not appear in the rollout
    // at all. The two surfaces use disjoint vocabularies for the same concern.
    const turnContext = soleRolloutLine('turn_context');
    expect(turnContext.payload.sandbox_policy.type).toBe('read-only');
    expect(turnContext.payload.approval_policy).toBe('never');
    expect(turnContext.payload.permission_profile.type).toBe('managed');
    expect(turnContext.payload.permission_profile.network).toBe('restricted');
    expect(Object.keys(turnContext.payload)).not.toContain('permission_mode');
    expect(readLive(ROLLOUT_FILE)).not.toContain('permission_mode');
  });
});

// ── 4.8 Rollout shape at 0.146.0, and its drift from 0.122.0 ──────────────────

/**
 * Baseline recorded from the newest rollout that existed on this host BEFORE the
 * capture window (cli_version 0.122.0), documented in manifest.documented_gaps.
 * It is a constant here on purpose: the 0.122.0 file is not a fixture, and the
 * only thing this suite needs from it is the delta.
 */
const SESSION_META_KEYS_0_122_0 = [
  'base_instructions',
  'cli_version',
  'cwd',
  'id',
  'model_provider',
  'originator',
  'source',
  'timestamp',
];

describe('0.146.0 rollout shape', () => {
  it('is version-pinned: cli_version is exactly 0.146.0', () => {
    const meta = soleRolloutLine('session_meta');
    expect(meta.payload.cli_version).toBe('0.146.0');
    expect(live.runtime_version).toContain('0.146.0');
  });

  it('pins the session_meta payload key set', () => {
    const meta = soleRolloutLine('session_meta');
    expect(Object.keys(meta.payload).sort()).toEqual([
      'base_instructions',
      'cli_version',
      'context_window',
      'cwd',
      'history_mode',
      'id',
      'model_provider',
      'originator',
      'session_id',
      'source',
      'thread_source',
      'timestamp',
    ]);
  });

  it('drifted from 0.122.0 by adding exactly four session_meta keys and dropping none', () => {
    // THIS IS WHY FIXTURES MUST BE VERSION-PINNED. Two minor versions moved the
    // rollout header from 8 keys to 12. A transcript parser written against
    // 0.122.0 and reused unchanged is a latent break.
    const observedKeys = Object.keys(soleRolloutLine('session_meta').payload).sort();
    expect(SESSION_META_KEYS_0_122_0).toHaveLength(8);
    expect(observedKeys).toHaveLength(12);

    const added = observedKeys.filter(k => !SESSION_META_KEYS_0_122_0.includes(k));
    const removed = SESSION_META_KEYS_0_122_0.filter(k => !observedKeys.includes(k));
    expect(added).toEqual(['context_window', 'history_mode', 'session_id', 'thread_source']);
    expect(removed).toEqual([]);
  });

  it('pins the turn_context payload key set', () => {
    expect(Object.keys(soleRolloutLine('turn_context').payload).sort()).toEqual([
      'approval_policy',
      'approvals_reviewer',
      'collaboration_mode',
      'comp_hash',
      'current_date',
      'cwd',
      'model',
      'multi_agent_version',
      'permission_profile',
      'personality',
      'realtime_active',
      'sandbox_policy',
      'summary',
      'timezone',
      'turn_id',
      'workspace_roots',
    ]);
  });

  it('drifted from 0.122.0 by adding five turn_context keys and dropping truncation_policy', () => {
    const keys = Object.keys(soleRolloutLine('turn_context').payload);
    for (const added of [
      'approvals_reviewer',
      'comp_hash',
      'multi_agent_version',
      'permission_profile',
      'workspace_roots',
    ]) {
      expect(keys, `0.146.0 turn_context should carry ${added}`).toContain(added);
    }
    // 0.122.0 carried truncation_policy and none of the five above. 0.146.0 is the
    // mirror image.
    expect(keys).not.toContain('truncation_policy');
    expect(readLive(ROLLOUT_FILE)).not.toContain('truncation_policy');
  });

  it('pins the rollout line-type set, which now includes world_state', () => {
    const types = [...new Set(rolloutLines.map(l => l.type))].sort();
    expect(types).toEqual(['event_msg', 'response_item', 'session_meta', 'turn_context', 'world_state']);
    // world_state did not exist at 0.122.0. A reader with an exhaustive switch over
    // 0.122.0 line types hits an unknown variant on a 0.146.0 transcript.
    expect(rolloutOfType('world_state')).toHaveLength(1);
    expect(soleRolloutLine('world_state').payload.full).toBe(true);
  });

  it('gives every rollout line a type, a timestamp and a payload', () => {
    expect(rolloutLines).toHaveLength(live.files[ROLLOUT_FILE].lines);
    for (const line of rolloutLines) {
      expect(Object.keys(line).sort()).toEqual(['payload', 'timestamp', 'type']);
      expect(typeof line.timestamp).toBe('string');
    }
  });
});

// ── 4.9 NEGATIVE PROOF: redaction ─────────────────────────────────────────────

const LIVE_FILES = [
  'rollout-0.146.0.observed.jsonl',
  'session-end.observed.json',
  'session-start.observed.json',
  'stop.observed.json',
  'user-prompt-submit.observed.json',
];

const FORBIDDEN_LITERALS = [
  'Bearer ',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'access_token',
  'auth.json',
  ['BEGIN', 'PRIVATE KEY'].join(' '),
];
const HOST_HOME_PATH = /\/(?:home|Users)\/[^/"\s]+/;

describe('live fixture redaction', () => {
  it.each(LIVE_FILES)('live/%s contains no host path and no credential-shaped substring', (file) => {
    const raw = readLive(file);
    for (const needle of FORBIDDEN_LITERALS) {
      expect(raw.includes(needle), `live/${file} contains forbidden substring ${JSON.stringify(needle)}`)
        .toBe(false);
    }
    expect(raw, `live/${file} contains a host home path`).not.toMatch(HOST_HOME_PATH);
  });

  it.each(LIVE_FILES)('live/%s contains no OpenAI sk- key prefix', (file) => {
    // `sk-` is checked with a left boundary, not as a bare substring: the Codex
    // system prompt embedded in the rollout legitimately contains the English word
    // "task-specific". A bare-substring check would fire on that and would have to
    // be deleted, which would remove the real key check with it.
    const raw = readLive(file);
    expect(raw.match(/(?<![A-Za-z0-9_])sk-/g), `live/${file} contains an sk- key prefix`).toBeNull();
    // Prove the boundary rule is doing work rather than silently matching nothing:
    // every raw "sk-" trigram in the fixture set must be inside the word "task-".
    for (const m of raw.match(/.{2}sk-/g) ?? []) {
      expect(m, `unexpected sk- context in live/${file}: ${m}`).toBe('task-');
    }
  });

  it('applied the documented placeholders instead of dropping the values', () => {
    // Redaction must be a substitution, not a deletion: the placeholders have to be
    // present, otherwise a host-path negative assertion would also pass on an empty file.
    expect(readLive('stop.observed.json')).toContain('<CODEX_HOME>/sessions/');
    expect(observed.stop.cwd).toBe('<CWD>');
    // The rollout carries a SECOND redaction pass beyond path replacement: xtrm-dev/core is a
    // PUBLIC repo, so provider prompt text and the operator's host_skills inventory were replaced
    // with size-annotated placeholders. That pass is also a substitution, not a deletion - every
    // scrubbed value still reports the byte count it stood in for, and host_skills keeps its key.
    // `<HOME>/` no longer appears in the rollout because it only ever occurred inside those long
    // strings; the path-substitution proof for the rollout is the `<CWD>` assertion below.
    const rollout = readLive(ROLLOUT_FILE);
    expect(rollout).toContain('<CWD>');
    expect(rollout).toMatch(
      /<REDACTED-FOR-PUBLIC-REPO: \d+ bytes of provider prompt\/host inventory; structure preserved>/,
    );
    expect(rollout).toContain('"host_skills"');
  });

  it('records the redaction rule in the manifest', () => {
    expect(live.redaction.replacements).toEqual([
      ['<CAPTURE_CODEX_HOME>', '<CODEX_HOME>'],
      ['<CAPTURE_CWD_2>', '<CWD>'],
      ['<CAPTURE_CWD_1>', '<CWD>'],
      ['<CAPTURE_HOME>', '<HOME>'],
    ]);
    expect(live.redaction.kept_deliberately).toContain('UUIDs are NOT redacted');
    expect(live.redaction.verified_by).toContain('cli/src/tests/codex-k1-live-payloads.test.ts');
  });

  it('holds manifest.json to the same credential and host-path rules', () => {
    const raw = readFileSync(join(FIXTURE_DIR, 'manifest.json'), 'utf8');
    for (const needle of FORBIDDEN_LITERALS) {
      expect(raw.includes(needle), `manifest.json contains forbidden substring ${JSON.stringify(needle)}`)
        .toBe(false);
    }
    expect(raw, 'manifest.json contains a host home path').not.toMatch(HOST_HOME_PATH);
    expect(raw.match(/(?<![A-Za-z0-9_])sk-/g), 'manifest.json contains an sk- key prefix').toBeNull();
    expect(manifest.executable).toContain('<CODEX_HOME>');
    expect(manifest.codex_home).toBe('<CODEX_HOME>');
  });

  it('keeps the UUIDs that prove the join', () => {
    expect(readLive('session-start.observed.json')).toContain(CAPTURE_SESSION_ID);
    expect(readLive('stop.observed.json')).toContain(CAPTURE_TURN_ID);
  });
});
