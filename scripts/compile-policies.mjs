#!/usr/bin/env node
// compile-policies.mjs — generate .xtrm/config/hooks.json from policies/*.json
//
// Usage:
//   node scripts/compile-policies.mjs             # write .xtrm/config/hooks.json
//   node scripts/compile-policies.mjs --dry-run   # print output, no write
//   node scripts/compile-policies.mjs --check     # exit 1 if hooks.json would change
//   node scripts/compile-policies.mjs --check-pi  # verify deployed Pi extensions match policy declarations
//
// Policy files: policies/*.json (schema: policies/schema.json)
// Output:       .xtrm/config/hooks.json

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// xtrm-wiy5n.4.38 Codex P2 (isolation) — the compiler reads from POLICIES_DIR
// and validates against HOOKS_PAYLOAD_DIR. Both default to the repo layout;
// tests can override via env vars to spawn the script against a temp fixture
// tree without touching the real `policies/` directory (which cli's parallel
// test files also read).

// Inlined from the former hooks/guard-rules.mjs (removed as dead hook)
const WRITE_TOOLS = [
  'Edit',
  'Write',
  'MultiEdit',
  'NotebookEdit',
  'mcp__serena__rename_symbol',
  'mcp__serena__replace_symbol_body',
  'mcp__serena__insert_after_symbol',
  'mcp__serena__insert_before_symbol',
];

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const POLICIES_DIR = process.env.XTRM_POLICIES_DIR || join(ROOT, 'policies');
const OUTPUT_FILE = process.env.XTRM_HOOKS_OUTPUT_FILE || join(ROOT, '.xtrm', 'config', 'hooks.json');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const CHECK = args.includes('--check');
const CHECK_PI = args.includes('--check-pi');

const WRITE_TOOLS_MATCHER = WRITE_TOOLS.join('|');
const PI_AGENT_DIR = process.env.PI_AGENT_DIR || join(process.env.HOME || '', '.pi', 'agent');
const PI_DEPLOYED_EXT_DIR = join(PI_AGENT_DIR, 'extensions');

function resolveMatcherMacro(matcher) {
  if (typeof matcher !== 'string') return matcher;
  return matcher.replace(/\$WRITE_TOOLS\b/g, WRITE_TOOLS_MATCHER);
}

// ── Load and sort policy files ────────────────────────────────────────────────

const policyFiles = readdirSync(POLICIES_DIR)
  .filter(f => f.endsWith('.json') && f !== 'schema.json')
  .sort(); // alphabetical within same order value

const policies = policyFiles.map(f => {
  const content = JSON.parse(readFileSync(join(POLICIES_DIR, f), 'utf8'));
  return { file: f, ...content };
});

// Sort by `order` field (default 50), then by filename for stability
policies.sort((a, b) => {
  const oa = a.order ?? 50;
  const ob = b.order ?? 50;
  if (oa !== ob) return oa - ob;
  return a.file.localeCompare(b.file);
});

// ── Build hooks.json ──────────────────────────────────────────────────────────
// Structure: { hooks: { EventName: [ { matcher?, hooks: [ { type, command, timeout? } ] } ] } }
//
// Groups are keyed by (event, matcher). Multiple policies can contribute to
// the same group — their hook entries are appended in policy order.

const eventGroups = new Map(); // key: "EventName\0matcher" → array of hook entries

for (const policy of policies) {
  const runtime = policy.runtime ?? 'both';
  if (runtime === 'pi') continue; // Claude-only output; skip pi-only policies

  const hooks = policy.claude?.hooks ?? [];
  for (const hook of hooks) {
    const resolvedMatcher = resolveMatcherMacro(hook.matcher ?? '');
    const key = `${hook.event}\0${resolvedMatcher}`;
    if (!eventGroups.has(key)) eventGroups.set(key, []);
    const entry = { type: 'command', command: hook.command };
    if (hook.timeout != null) entry.timeout = hook.timeout;
    eventGroups.get(key).push(entry);
  }
}

// Assemble final structure, preserving event insertion order
const hooksOutput = {};
for (const [key, hookEntries] of eventGroups) {
  const [event, matcher] = key.split('\0');
  if (!hooksOutput[event]) hooksOutput[event] = [];
  const preferredScript = hookEntries
    .map((hook) => hook.command.match(/beads-compact-(restore|save)\.mjs/)?.[0])
    .find(Boolean);
  const group = {
    ...(matcher ? { matcher } : {}),
    ...(preferredScript ? { script: preferredScript } : {}),
    hooks: hookEntries,
  };
  hooksOutput[event].push(group);
}

// ── Payload/wiring parity gate ────────────────────────────────────────────────
// xtrm-wiy5n.4.38 — a hook command in `policies/*.json` typically looks like
// `node ${CLAUDE_PLUGIN_ROOT}/hooks/<relpath>` (also with $CLAUDE_PLUGIN_ROOT
// unbraced). The relpath must exist under `.xtrm/hooks/<relpath>` in this
// repo, or the wire will point at a file that does not ship. The compiled
// config then propagates through the global-hooks bootstrap into
// ~/.xtrm/config/hooks.json and through the runtime sync into
// ~/.claude/settings.json, so a mismatch here becomes a broken hook on every
// session start that fires it. Fail loud instead — never emit a bad hook wire.
const PLUGIN_ROOT_HOOK_RE = /\$\{?CLAUDE_PLUGIN_ROOT\}?\/hooks\/([A-Za-z0-9_\-./]+)/g;
const HOOKS_PAYLOAD_DIR = process.env.XTRM_HOOKS_PAYLOAD_DIR || join(ROOT, '.xtrm', 'hooks');

// xtrm-wiy5n.4.38 Codex P2 (directories) — a command that accidentally omits
// the filename and targets a directory (`${CLAUDE_PLUGIN_ROOT}/hooks/gitnexus`)
// would pass `existsSync`, so the gate has to require a regular file. Missing
// paths and non-file entries are both rejected as mismatches.
function payloadEntryStatus(absPath) {
  try {
    const stat = statSync(absPath);
    if (stat.isFile()) return 'ok';
    return `not a regular file (${stat.isDirectory() ? 'directory' : 'other'})`;
  } catch (err) {
    if (err && err.code === 'ENOENT') return 'missing';
    throw err;
  }
}

function collectReferencedHookFiles(policiesData) {
  const missing = new Map(); // relpath -> array of {policyFile, event, command, reason}
  for (const policy of policiesData) {
    const runtime = policy.runtime ?? 'both';
    // Only Claude-side commands ship via .xtrm/hooks. Pi extensions live
    // under packages/pi-extensions/ and are covered by --check-pi.
    if (runtime === 'pi') continue;
    for (const hook of policy.claude?.hooks ?? []) {
      const command = hook.command ?? '';
      let match;
      // Reset the RegExp between iterations because /g regexes are stateful.
      PLUGIN_ROOT_HOOK_RE.lastIndex = 0;
      while ((match = PLUGIN_ROOT_HOOK_RE.exec(command)) !== null) {
        const rel = match[1];
        const absPath = join(HOOKS_PAYLOAD_DIR, rel);
        const status = payloadEntryStatus(absPath);
        if (status === 'ok') continue;
        if (!missing.has(rel)) missing.set(rel, []);
        missing.get(rel).push({ policyFile: policy.file, event: hook.event, command, reason: status });
      }
    }
  }
  return missing;
}

function runPayloadWiringCheck(policiesData) {
  const missing = collectReferencedHookFiles(policiesData);
  if (missing.size === 0) return;
  console.error('✗ Payload/wiring mismatch — the following hook paths referenced by policies are missing or are not regular files under .xtrm/hooks/:');
  for (const [rel, refs] of missing) {
    // All refs for this rel share the same absolute path, so the reason is
    // identical — pull it from the first ref.
    const reason = refs[0]?.reason ?? 'missing';
    console.error(`  - .xtrm/hooks/${rel} (${reason})`);
    for (const ref of refs) {
      console.error(`      referenced by ${ref.policyFile} (event=${ref.event}) → ${ref.command}`);
    }
  }
  console.error('  Fix: ship a regular file at .xtrm/hooks/<name>, or remove the hook entry from the policy.');
  process.exit(1);
}

runPayloadWiringCheck(policies);

const output = JSON.stringify({ hooks: hooksOutput }, null, 2) + '\n';

function listPiExtensionDirs(dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  return readdirSync(dir)
    .filter((name) => {
      const extDir = join(dir, name);
      return statSync(extDir).isDirectory()
        && existsSync(join(extDir, 'index.ts'))
        && existsSync(join(extDir, 'package.json'));
    })
    .sort();
}

function runPiCheck(policiesData) {
  const policyExtPaths = policiesData
    .filter((policy) => ['pi', 'both'].includes(policy.runtime ?? 'both'))
    .map((policy) => policy.pi?.extension)
    .filter(Boolean)
    .sort();

  const missingSource = policyExtPaths.filter((relPath) => !existsSync(join(ROOT, relPath)));

  if (missingSource.length > 0) {
    console.error('✗ Missing Pi extension files referenced by policies:');
    missingSource.forEach((file) => console.error(`  - ${file}`));
    process.exit(1);
  }

  const expectedNames = policyExtPaths
    .map((p) => p.replace(/^packages\/pi-extensions\/extensions\//, ''))
    .map((p) => p.replace(/\/index\.ts$/, ''));
  const expectedSet = new Set(expectedNames);

  const deployedNames = listPiExtensionDirs(PI_DEPLOYED_EXT_DIR);
  const deployedSet = new Set(deployedNames);

  const missingDeployed = expectedNames.filter((name) => !deployedSet.has(name));
  const extraDeployed = deployedNames.filter((name) => !expectedSet.has(name));

  if (missingDeployed.length > 0) {
    console.error('✗ Pi extension deployment drift detected');
    console.error(`  Expected (from policies): ${expectedNames.length}`);
    console.error(`  Deployed (~/.pi/agent/extensions): ${deployedNames.length}`);
    console.error('  Missing deployed extensions:');
    missingDeployed.forEach((file) => console.error(`    - ${file}`));
    process.exit(1);
  }

  if (extraDeployed.length > 0) {
    console.log('ℹ Additional installed Pi extensions not policy-managed:');
    extraDeployed.forEach((file) => console.log(`  - ${file}`));
  }

  console.log('✓ Pi extensions are in sync with policy declarations');
}

// ── Output ────────────────────────────────────────────────────────────────────

if (DRY_RUN) {
  process.stdout.write(output);
  process.exit(0);
}

if (CHECK_PI) {
  runPiCheck(policies);
  if (!CHECK) {
    process.exit(0);
  }
}

if (CHECK) {
  const current = readFileSync(OUTPUT_FILE, 'utf8');
  if (current === output) {
    console.log('✓ .xtrm/config/hooks.json is up to date');
    process.exit(0);
  } else {
    console.error('✗ .xtrm/config/hooks.json is out of sync with policies/');
    console.error('  Run: node scripts/compile-policies.mjs');
    process.exit(1);
  }
}

writeFileSync(OUTPUT_FILE, output);
console.log(`✓ Generated .xtrm/config/hooks.json from ${policies.length} policies`);
policies.forEach(p => {
  const count = (p.claude?.hooks ?? []).length;
  if (count > 0) console.log(`  ${p.file}: ${count} hook(s)`);
});
