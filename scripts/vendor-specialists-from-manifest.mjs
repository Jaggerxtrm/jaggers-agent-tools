#!/usr/bin/env node
// Re-vendor specialists using the ref recorded in .xtrm/specialists-source.json.
// Prefers the immutable resolved_sha over the moving ref (e.g. master), so
// prepublishOnly cannot silently replace a reviewed snapshot at publish time.
//
// Forwards any extra argv to scripts/vendor-specialists-skills.mjs (e.g.
// --specialists-tarball, --specialists-package) — this wrapper only owns
// the ref-resolution policy.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(repoRoot, '.xtrm', 'specialists-source.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const originalRef = manifest.source?.ref;
const originalRepoPath = manifest.source?.repo_path;
const ref = manifest.source?.resolved_sha || originalRef;
if (!ref) {
  console.error(`${manifestPath}: missing both source.resolved_sha and source.ref`);
  process.exit(1);
}

const extra = process.argv.slice(2);
const args = [
  path.join(repoRoot, 'scripts', 'vendor-specialists-skills.mjs'),
  '--specialists-package', 'specialists',
  '--specialists-ref', ref,
  ...extra,
];
const result = spawnSync('node', args, { stdio: 'inherit', cwd: repoRoot });
if (result.status !== 0) process.exit(result.status ?? 1);

// vendor-specialists-skills.mjs records the concrete checkout used for the
// operation. Preserve operator-facing source metadata from the reviewed
// manifest: ref stays human-readable and repo_path stays stable even when CI
// supplies SPECIALISTS_REPO_PATH pointing at a temporary checkout. The
// immutable resolved_sha and per-file Git blob identities remain authoritative.
const rewritten = JSON.parse(readFileSync(manifestPath, 'utf8'));
let changed = false;
if (originalRef && originalRef !== ref && rewritten.source?.ref === ref) {
  rewritten.source.ref = originalRef;
  changed = true;
}
if (originalRepoPath && rewritten.source?.repo_path !== originalRepoPath) {
  rewritten.source.repo_path = originalRepoPath;
  changed = true;
}
if (changed) {
  writeFileSync(manifestPath, JSON.stringify(rewritten, null, 2) + '\n');
}
