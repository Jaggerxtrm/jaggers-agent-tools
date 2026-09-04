#!/usr/bin/env node
// Hash-compares every vendored Specialists skill file against the exact upstream
// source.resolved_sha and the placement declared in the v2 vendor manifest.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(path.join(repoRoot, '.xtrm/specialists-source.json'), 'utf8'));
if (manifest.version !== 2) {
  console.error('vendored-specialists-parity: expected specialists-source manifest v2');
  process.exit(1);
}

const { resolved_sha: sha, source_path: sourcePath, repo_path: repoPath } = manifest.source ?? {};
if (!sha || !sourcePath) {
  console.error('vendored-specialists-parity: manifest source.resolved_sha / source_path missing');
  process.exit(1);
}

const upstream = [process.env.SPECIALISTS_REPO_PATH, repoPath, '../specialists', '../../../../specialists']
  .filter(Boolean)
  .map((p) => path.resolve(repoRoot, p))
  .find((p) => existsSync(path.join(p, '.git')));

if (!upstream) {
  console.log('vendored-specialists-parity: SKIP — no Specialists checkout (set SPECIALISTS_REPO_PATH)');
  process.exit(0);
}

function destination(skill, rel) {
  const placement = manifest.placements?.[skill] ?? { tier: 'default' };
  if (placement.tier === 'default') return path.join(repoRoot, '.xtrm/skills/default', skill, rel);
  if (placement.tier === 'optional' && placement.pack) {
    return path.join(repoRoot, '.xtrm/skills/optional', placement.pack, skill, rel);
  }
  throw new Error(`invalid placement for ${skill}: ${JSON.stringify(placement)}`);
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
let failures = 0;
for (const [skill, files] of Object.entries(manifest.files ?? {})) {
  for (const rel of Object.keys(files)) {
    const vendoredPath = destination(skill, rel);
    let upstreamBytes;
    try {
      upstreamBytes = execFileSync('git', ['-C', upstream, 'show', `${sha}:${sourcePath}/${skill}/${rel}`], { maxBuffer: 1 << 28 });
    } catch {
      console.error(`${skill}/${rel}  missing upstream at ${sourcePath} @ ${sha.slice(0, 12)}`);
      failures += 1;
      continue;
    }

    const want = sha256(upstreamBytes);
    const got = existsSync(vendoredPath) ? sha256(readFileSync(vendoredPath)) : 'ABSENT';
    const manifestHash = files[rel];
    if (want !== manifestHash) {
      console.error(`${skill}/${rel}  manifest=${String(manifestHash).slice(0, 16)} upstream=${want.slice(0, 16)}`);
      failures += 1;
    }
    if (want !== got) {
      console.error(`${path.relative(repoRoot, vendoredPath)}  upstream=${want.slice(0, 16)} vendored=${got.slice(0, 16)}`);
      failures += 1;
    }
  }
}

if (failures) {
  console.error(`\nvendored-specialists-parity: ${failures} drift finding(s). Re-vendor with 'node scripts/vendor-specialists-from-manifest.mjs'.`);
  process.exit(1);
}
console.log(`vendored-specialists-parity OK — ${upstream} @ ${sha.slice(0, 12)}`);
