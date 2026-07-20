#!/usr/bin/env node
// Validate that every "is deprecated —" / "is retired —" string emitted
// from cli/src/commands/**/*.ts is recorded in docs/command-deprecations.json.
//
// Direction enforced: code → ledger. A code string with no ledger entry
// fails the check. A ledger entry with no code hit is warned about (stale
// entry) but does not fail — deliberately, so a PR can add the ledger
// entry before the code message drops in the same PR.
//
// Also enforces:
//   - ledger.schema_version matches expected constant
//   - every entry has {command, deprecated_since, remove_in, replacement, behavior, code_ref}
//   - behavior ∈ {execute-with-warning, fail-with-redirect, execute}
//   - remove_in is a valid semver-ish tag (starts with v?<digits>.<digits>.<digits>)
//   - code_ref file exists

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const ledgerPath = path.join(repoRoot, 'docs', 'command-deprecations.json');
const commandsDir = path.join(repoRoot, 'cli', 'src', 'commands');

const EXPECTED_SCHEMA = 'xtrm.command-deprecations.v1';
const REQUIRED_FIELDS = ['command', 'deprecated_since', 'remove_in', 'replacement', 'behavior', 'code_ref'];
const VALID_BEHAVIORS = new Set(['execute-with-warning', 'fail-with-redirect', 'execute']);
const SEMVER_RE = /^v?\d+\.\d+\.\d+$/;

// Matches, e.g.
//   'xt bootstrap is deprecated —'
//   "xt pi install is retired —"
//   'xt pi setup --check is deprecated —'
// Group 1 is the command token (everything between the leading quote and " is (deprecated|retired) —").
// Token allows `/` so combined announcements ("xt claude reload/reinstall")
// map to a single ledger entry.
const DEPRECATION_RE = /['"`]((?:xt|xtrm)(?:\s+[\w/-]+)+(?:\s+--[\w-]+)?)\s+is\s+(?:deprecated|retired)\s+—/g;

function collectTsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectTsFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

function scanCode() {
  const hits = new Map(); // token → [{ file, line }]
  for (const file of collectTsFiles(commandsDir)) {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      DEPRECATION_RE.lastIndex = 0;
      let m;
      while ((m = DEPRECATION_RE.exec(line)) !== null) {
        const token = m[1].replace(/\s+/g, ' ').trim();
        if (!hits.has(token)) hits.set(token, []);
        hits.get(token).push({ file: path.relative(repoRoot, file), line: i + 1 });
      }
    }
  }
  return hits;
}

function validateLedger(ledger) {
  const errors = [];
  if (ledger.schema_version !== EXPECTED_SCHEMA) {
    errors.push(`schema_version mismatch: expected ${EXPECTED_SCHEMA}, got ${ledger.schema_version}`);
  }
  if (!Array.isArray(ledger.entries)) {
    errors.push('entries: expected array');
    return errors;
  }
  const seen = new Set();
  for (const entry of ledger.entries) {
    for (const field of REQUIRED_FIELDS) {
      if (!(field in entry)) errors.push(`${entry.command ?? '<unknown>'}: missing field ${field}`);
    }
    if (entry.command && seen.has(entry.command)) errors.push(`${entry.command}: duplicate entry`);
    if (entry.command) seen.add(entry.command);
    if (entry.behavior && !VALID_BEHAVIORS.has(entry.behavior)) {
      errors.push(`${entry.command}: behavior must be one of ${[...VALID_BEHAVIORS].join(', ')}, got ${entry.behavior}`);
    }
    if (entry.remove_in && !SEMVER_RE.test(entry.remove_in)) {
      errors.push(`${entry.command}: remove_in must be v?X.Y.Z, got ${entry.remove_in}`);
    }
    if (entry.deprecated_since && !SEMVER_RE.test(entry.deprecated_since)) {
      errors.push(`${entry.command}: deprecated_since must be v?X.Y.Z, got ${entry.deprecated_since}`);
    }
    if (entry.code_ref) {
      const codePath = path.join(repoRoot, entry.code_ref);
      if (!fs.existsSync(codePath)) errors.push(`${entry.command}: code_ref points to missing file ${entry.code_ref}`);
    }
  }
  return errors;
}

function main() {
  if (!fs.existsSync(ledgerPath)) {
    console.error(`Missing ledger: ${path.relative(repoRoot, ledgerPath)}`);
    process.exit(1);
  }
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  const ledgerErrors = validateLedger(ledger);
  const ledgerCommands = new Set(ledger.entries.map((e) => e.command));

  const codeHits = scanCode();
  const missingFromLedger = [];
  for (const [token, locations] of codeHits) {
    if (!ledgerCommands.has(token)) {
      missingFromLedger.push({ token, locations });
    }
  }

  const staleEntries = [];
  for (const command of ledgerCommands) {
    if (!codeHits.has(command)) staleEntries.push(command);
  }

  if (ledgerErrors.length || missingFromLedger.length) {
    if (ledgerErrors.length) {
      console.error('Ledger validation errors:');
      for (const err of ledgerErrors) console.error(`  - ${err}`);
    }
    if (missingFromLedger.length) {
      console.error('Deprecation strings missing from ledger:');
      for (const { token, locations } of missingFromLedger) {
        console.error(`  - "${token}" (found at ${locations.map((l) => `${l.file}:${l.line}`).join(', ')})`);
      }
    }
    console.error('\nAdd missing entries to docs/command-deprecations.json.');
    process.exit(1);
  }

  console.log(`Deprecation ledger ok: ${ledger.entries.length} entries, ${codeHits.size} tokens in code.`);
  if (staleEntries.length) {
    console.log(`  Note: ${staleEntries.length} ledger entries have no matching code string (stale? or added-before-code):`);
    for (const c of staleEntries) console.log(`    - ${c}`);
  }
}

main();
