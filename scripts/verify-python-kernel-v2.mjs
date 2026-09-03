#!/usr/bin/env node
// verify-python-kernel-v2.mjs — verify the python-kernel v2 (skillbridge + QoL +
// audit seam) features are present in the package source before release.
//
// Purpose: this is the "verify" half of the release path (bead xtrm-h7uwi.4).
// Publishing is out of scope here (no push / no publish per the brief); this
// script proves the shipped source would expose the new surface, replacing the
// manual "reinstall + fresh session" check the full deploy path performs.
//
//   node scripts/verify-python-kernel-v2.mjs [--quiet]
//
// Exit 0 = all checks pass. Exit 1 = at least one feature marker missing.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const extPath = path.join(repoRoot, "packages", "pi-extensions", "extensions", "python-kernel", "index.ts");
const testPath = path.join(repoRoot, "packages", "pi-extensions", "tests", "python-kernel.test.ts");
const quiet = process.argv.includes("--quiet");

const failures = [];
const ok = (label) => !quiet && console.log(`  ✓ ${label}`);
const fail = (label, detail) => {
  failures.push(label);
  if (!quiet) console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
};

if (!fs.existsSync(extPath)) {
  console.error(`python-kernel extension source not found: ${extPath}`);
  process.exit(1);
}

const src = fs.readFileSync(extPath, "utf8");
const tests = fs.existsSync(testPath) ? fs.readFileSync(testPath, "utf8") : "";

// --- skillbridge (xtrm-h7uwi.1) ---
const skillbridgeMarkers = [
  ["driver mounts skill paths (PI_SKILL_PATHS)", /PI_SKILL_PATHS/],
  ["driver imports skill modules (PI_SKILL_IMPORTS)", /PI_SKILL_IMPORTS/],
  ["_sk_errors surfacing", /_sk_errors/],
  ["reload_skills tool param", /reload_skills/],
  ["pyc cache disabled", /dont_write_bytecode/],
  ["discovery scan (discoverSkillModules)", /discoverSkillModules/],
  ["importable modules line in description", /Importable skill modules/],
];
for (const [label, re] of skillbridgeMarkers) {
  if (re.test(src)) ok(label);
  else fail(label);
}

// --- QoL (xtrm-h7uwi.2) ---
const qolMarkers = [
  ["stdlib prelude (_apply_prelude)", /_apply_prelude/],
  ["prelude bound into _ns", /_ns\.update\(\{"json": json/],
  ["prelude survives reset", /_apply_prelude\(\)/],
  ["output cap (max_output)", /max_output/],
  ["truncation head+marker+tail", /\[truncated/],
  ["shape hint", /shape_hint/],
  ["full output temp file path", /full_output_path/],
];
for (const [label, re] of qolMarkers) {
  if (re.test(src)) ok(label);
  else fail(label);
}

// --- audit seam (xtrm-h7uwi.3) ---
const auditMarkers = [
  ["_AUDIT initialized in driver", /_ns\["_AUDIT"\] = \[\]/],
  ["_AUDIT bound into skill modules", /setattr\(_mod, "_AUDIT"/],
  ["_AUDIT copied into replies", /_ns\.get\("_AUDIT", \[\]\)/],
  ["audit in tool details", /audit: audit\.length > 0/],
  ["policy hook behind flag (auditPolicy)", /auditPolicy/],
];
for (const [label, re] of auditMarkers) {
  if (re.test(src)) ok(label);
  else fail(label);
}

// --- memory doctrine: preflight digest ---
const preflightMarkers = [
  ["preflight digest defined", /def preflight\(repo, path/],
  ["preflight bound into _ns", /_ns\["preflight"\] = preflight/],
  ["preflight survives reset (durable prelude)", /try:\n        _ns\["preflight"\] = preflight/],
  ["full-body record format", /--format=%x1e%x1f%h%x1f%ad%x1f%s%x1f%b/],
];
for (const [label, re] of preflightMarkers) {
  if (re.test(src)) ok(label);
  else fail(label);
}

// --- test coverage ---
const testMarkers = [
  ["discovery unit test", /discoverSkillModules\(\[fx\.dir\]\)/],
  ["mount fixture test", /sre_chain\.load\(\)/],
  ["reload test", /reloadSkills\(\)/],
  ["truncation test", /truncateOutput/],
  ["audit flow test", /audit seam: kernel-side mutation entries/],
  ["preflight binding test", /preflight: durable prelude binding/],
];
for (const [label, re] of testMarkers) {
  if (re.test(tests)) ok(label);
  else fail(label, "python-kernel.test.ts");
}

if (failures.length > 0) {
  console.error(`\nverify-python-kernel-v2: ${failures.length} check(s) FAILED:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`\nverify-python-kernel-v2: all ${skillbridgeMarkers.length + qolMarkers.length + auditMarkers.length + preflightMarkers.length + testMarkers.length} checks passed.`);
process.exit(0);
