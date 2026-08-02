/**
 * Codex 0.146.0 hook-payload fixture validator (KAN-127 K1 / beads xtrm-ozknq.5)
 *
 * CHARACTERIZATION: this suite pins the Codex hook contract as it exists TODAY,
 * so a later shared-launcher refactor (or a Codex version bump) cannot silently
 * change what an adapter may assume. It asserts nothing about what the contract
 * SHOULD be.
 *
 * Fixtures in fixtures/codex/ are version-pinned schema documents extracted
 * statically from the codex 0.146.0 binary. Provenance, capture method and the
 * documented evidence gaps live in fixtures/codex/manifest.json. No Codex
 * session was started and no hook was invoked to produce them.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const FIXTURE_DIR = resolve(__dirname, 'fixtures', 'codex');
const MANIFEST_FILE = 'manifest.json';

interface JsonSchemaDoc {
  $schema?: string;
  type?: string;
  title?: string;
  required?: string[];
  properties?: Record<string, any>;
  definitions?: Record<string, any>;
  additionalProperties?: boolean;
}

interface Manifest {
  runtime: string;
  runtime_version: string;
  executable: string;
  codex_home: string;
  capture_date: string;
  expected_event_count: number;
  expected_file_count: number;
  redaction: { instance_data_captured: boolean; assertion: string };
  documented_gaps: string[];
  files: Record<string, { title: string; sha256: string; byte_offset: number; byte_length: number }>;
}

const schemaFiles = readdirSync(FIXTURE_DIR)
  .filter(f => f.endsWith('.json') && f !== MANIFEST_FILE)
  .sort();

const manifest = JSON.parse(readFileSync(join(FIXTURE_DIR, MANIFEST_FILE), 'utf8')) as Manifest;

const schemas = new Map<string, JsonSchemaDoc>(
  schemaFiles.map(f => [f, JSON.parse(readFileSync(join(FIXTURE_DIR, f), 'utf8')) as JsonSchemaDoc]),
);

const byTitle = (title: string): JsonSchemaDoc => {
  const doc = schemas.get(`${title}.json`);
  if (!doc) throw new Error(`missing fixture for schema title: ${title}`);
  return doc;
};

const inputFiles = schemaFiles.filter(f => f.endsWith('.command.input.json'));

// ── 3.1 Fixture shape ─────────────────────────────────────────────────────────

describe('codex 0.146.0 fixture set', () => {
  it('contains exactly the captured 21 schema documents', () => {
    // 11 events, but session-end has no output schema -> 21 not 22.
    expect(schemaFiles).toHaveLength(21);
    expect(schemaFiles).toHaveLength(manifest.expected_file_count);
  });

  it.each(schemaFiles)('%s is a draft-07 schema document', (file) => {
    const doc = schemas.get(file)!;
    expect(doc.$schema).toBe('http://json-schema.org/draft-07/schema#');
    expect(doc.type).toBe('object');
    expect(doc.title).toBe(file.replace(/\.json$/, ''));
    expect(doc.properties, 'schema has no properties').toBeTypeOf('object');
    // CHARACTERIZATION: current behavior, see xtrm-ozknq.5 — Codex declares
    // additionalProperties:false on every hook payload, so an adapter that
    // injects extra keys into an input document is rejected rather than ignored.
    expect(doc.additionalProperties).toBe(false);
  });

  it.each(inputFiles)('%s declares a required array', (file) => {
    const doc = schemas.get(file)!;
    expect(Array.isArray(doc.required), 'input schema missing required[]').toBe(true);
    expect(doc.required!.length).toBeGreaterThan(0);
  });

  it('declares no required array on any output schema', () => {
    // CHARACTERIZATION: current behavior, see xtrm-ozknq.5 — every field of every
    // hook OUTPUT is optional in 0.146.0, so a hook that returns `{}` is valid and
    // an adapter cannot rely on any output key being present.
    const outputs = schemaFiles.filter(f => f.endsWith('.command.output.json'));
    expect(outputs).toHaveLength(10);
    for (const file of outputs) {
      expect(schemas.get(file)!.required, `${file} unexpectedly has required[]`).toBeUndefined();
    }
  });
});

// ── 3.2 Event vocabulary ──────────────────────────────────────────────────────

describe('codex hook event vocabulary', () => {
  it('is exactly the 11 PascalCase event names of 0.146.0', () => {
    // Read from the fixtures, not from a hand-typed list, so a Codex version bump
    // that adds or removes an event FAILS here. That failure is the point.
    const observed = inputFiles
      .map(f => schemas.get(f)!.properties?.hook_event_name?.const as string | undefined)
      .filter((v): v is string => typeof v === 'string')
      .sort();

    expect(observed).toEqual([
      'PermissionRequest',
      'PostCompact',
      'PostToolUse',
      'PreCompact',
      'PreToolUse',
      'SessionEnd',
      'SessionStart',
      'Stop',
      'SubagentStart',
      'SubagentStop',
      'UserPromptSubmit',
    ]);
    expect(observed).toHaveLength(manifest.expected_event_count);
    // Every input schema contributes exactly one event name; none is missing it.
    expect(observed).toHaveLength(inputFiles.length);
  });

  it('names the event as hook_event_name on inputs only', () => {
    // CHARACTERIZATION: current behavior, see xtrm-ozknq.5 — inputs use snake_case
    // `hook_event_name` at the top level, outputs use camelCase `hookEventName`
    // nested under hookSpecificOutput. The two spellings are not interchangeable.
    for (const file of schemaFiles.filter(f => f.endsWith('.command.output.json'))) {
      expect(schemas.get(file)!.properties?.hook_event_name, `${file}`).toBeUndefined();
    }
  });
});

// ── 3.3 Required-key sets adapters depend on ──────────────────────────────────

describe('codex payload required-key sets', () => {
  it('pins session-start.command.input', () => {
    const doc = byTitle('session-start.command.input');
    expect([...doc.required!].sort()).toEqual([
      'cwd',
      'hook_event_name',
      'model',
      'permission_mode',
      'session_id',
      'source',
      'transcript_path',
    ]);
    expect(doc.properties!.source.enum).toEqual(['startup', 'resume', 'clear', 'compact']);
    // CHARACTERIZATION: current behavior, see xtrm-ozknq.5 — SessionStart carries
    // no turn_id, so a turn-scoped adapter keyed on turn_id has nothing to key on
    // at session start and must fall back to session_id.
    expect(doc.properties!.turn_id).toBeUndefined();
    expect(doc.required).not.toContain('turn_id');
  });

  it('pins session-end.command.input and the absence of a session-end output', () => {
    const doc = byTitle('session-end.command.input');
    expect([...doc.required!].sort()).toEqual([
      'cwd',
      'hook_event_name',
      'reason',
      'session_id',
      'transcript_path',
    ]);
    // CHARACTERIZATION: current behavior, see xtrm-ozknq.5 — `reason` is a const,
    // not an enum: Codex reports exactly one end reason, so an adapter cannot
    // distinguish clean exit from crash/logout at SessionEnd.
    expect(doc.properties!.reason.const).toBe('other');
    expect(doc.properties!.reason.enum).toBeUndefined();
    // CHARACTERIZATION: current behavior, see xtrm-ozknq.5 — SessionEnd is the one
    // event with no output schema, so a SessionEnd hook cannot return a decision.
    expect(schemaFiles).not.toContain('session-end.command.output.json');
  });

  it('pins user-prompt-submit.command.input', () => {
    const doc = byTitle('user-prompt-submit.command.input');
    expect([...doc.required!].sort()).toEqual([
      'cwd',
      'hook_event_name',
      'model',
      'permission_mode',
      'prompt',
      'session_id',
      'transcript_path',
      'turn_id',
    ]);
  });

  it('pins pre-tool-use.command.input', () => {
    const doc = byTitle('pre-tool-use.command.input');
    expect([...doc.required!].sort()).toEqual([
      'cwd',
      'hook_event_name',
      'model',
      'permission_mode',
      'session_id',
      'tool_input',
      'tool_name',
      'tool_use_id',
      'transcript_path',
      'turn_id',
    ]);
    // CHARACTERIZATION: current behavior, see xtrm-ozknq.5 — tool_input is the
    // permissive schema `true`, so its shape is entirely unconstrained per tool.
    expect(doc.properties!.tool_input).toBe(true);
  });

  it('pins post-tool-use.command.input as pre-tool-use plus tool_response', () => {
    const pre = byTitle('pre-tool-use.command.input');
    const post = byTitle('post-tool-use.command.input');
    expect([...post.required!].sort()).toEqual([...pre.required!, 'tool_response'].sort());
    expect(post.properties!.tool_response).toBe(true);
  });

  it('pins permission-request.command.input as carrying no tool_use_id', () => {
    const doc = byTitle('permission-request.command.input');
    expect(doc.required).toContain('tool_name');
    expect(doc.required).toContain('tool_input');
    // CHARACTERIZATION: current behavior, see xtrm-ozknq.5 — PermissionRequest has
    // no tool_use_id at all, so a PermissionRequest cannot be correlated with the
    // PreToolUse/PostToolUse pair for the same tool call.
    expect(doc.required).not.toContain('tool_use_id');
    expect(doc.properties!.tool_use_id).toBeUndefined();
  });

  it('pins the permission_mode enum shared by every mode-carrying input', () => {
    const expected = ['default', 'acceptEdits', 'plan', 'dontAsk', 'bypassPermissions'];
    const carriers = inputFiles.filter(f => schemas.get(f)!.properties?.permission_mode);
    expect(carriers.length).toBeGreaterThan(0);
    for (const file of carriers) {
      expect(schemas.get(file)!.properties!.permission_mode.enum, file).toEqual(expected);
    }
  });
});

// ── 3.4 Negative proof: redaction ─────────────────────────────────────────────

const FORBIDDEN_SUBSTRINGS = [
  'sk-',
  'OPENAI_API_KEY',
  'MILVUS_TOKEN',
  'CONTEXT7_API_KEY',
  'auth.json',
  'Bearer ',
  'access_token',
  'ANTHROPIC_API_KEY',
  'BEGIN PRIVATE KEY',
];

describe('codex fixture redaction', () => {
  it.each(schemaFiles)('%s contains no credential-shaped substring', (file) => {
    const raw = readFileSync(join(FIXTURE_DIR, file), 'utf8');
    for (const needle of FORBIDDEN_SUBSTRINGS) {
      expect(raw.includes(needle), `${file} contains forbidden substring ${JSON.stringify(needle)}`).toBe(false);
    }
  });

  it('records in the manifest that no instance data was captured', () => {
    expect(manifest.redaction.instance_data_captured).toBe(false);
    expect(manifest.redaction.assertion).toContain('no captured instance data');
  });
});

// ── 3.5 Negative proof: this is Codex, not Claude ─────────────────────────────

describe('codex contract is not the claude contract', () => {
  // Guard against mechanically copying Claude hook payloads into this fixture
  // set. The execution note for K1 is explicit: Codex behavior must not be
  // derived from Claude hooks. These assertions fail if a Claude-shaped document
  // is substituted for a Codex one.
  it('reports a single const SessionEnd reason, unlike Claude', () => {
    const reason = byTitle('session-end.command.input').properties!.reason;
    expect(reason.const).toBe('other');
    // Claude's SessionEnd carries several reasons (clear/logout/exit/...); a
    // Claude-derived fixture would present an enum here, not a const.
    expect(reason.enum).toBeUndefined();
  });

  it('defines a PermissionRequest event that Claude has no equivalent for', () => {
    expect(schemaFiles).toContain('permission-request.command.input.json');
    expect(schemaFiles).toContain('permission-request.command.output.json');
    expect(byTitle('permission-request.command.input').properties!.hook_event_name.const)
      .toBe('PermissionRequest');
  });

  it('uses the Codex-specific turn_id extension on turn-scoped events', () => {
    const doc = byTitle('pre-tool-use.command.input');
    expect(doc.properties!.turn_id.description).toContain('Codex extension');
  });

  it('defines no Notification event, which Claude does define', () => {
    const events = inputFiles.map(f => schemas.get(f)!.properties?.hook_event_name?.const);
    expect(events).not.toContain('Notification');
    expect(events).not.toContain('PreCompactHook');
  });
});

// ── 3.6 Manifest provenance + integrity ───────────────────────────────────────

describe('codex fixture manifest', () => {
  it('records the pinned runtime version and provenance', () => {
    expect(manifest.runtime).toBe('codex');
    expect(manifest.runtime_version).toBe('codex-cli 0.146.0');
    expect(manifest.executable).toContain('0.146.0-x86_64-unknown-linux-musl');
    expect(manifest.codex_home).toBe('/home/jagger/.codex');
    expect(manifest.capture_date).toBe('2026-08-02');
  });

  it('documents the evidence gaps rather than implying uncaptured evidence', () => {
    const gaps = manifest.documented_gaps.join('\n');
    expect(gaps).toContain('0.122.0');
    expect(gaps).toContain('No live hook INVOCATION was observed');
    expect(gaps).toContain('HookScope');
    expect(gaps).toContain('HookRunStatus');
  });

  it('lists every fixture file exactly once', () => {
    expect(Object.keys(manifest.files).sort()).toEqual(schemaFiles);
  });

  it.each(schemaFiles)('%s matches the sha256 recorded in the manifest', (file) => {
    const raw = readFileSync(join(FIXTURE_DIR, file));
    const actual = createHash('sha256').update(raw).digest('hex');
    expect(actual, `${file} was edited without updating manifest.json`).toBe(manifest.files[file].sha256);
  });
});
