#!/usr/bin/env node
// Hash-compares every vendored Specialists skill file against the upstream checkout at the
// pinned source.resolved_sha. check:specialists-vendor only proves vendored ≡ manifest, so a
// hand-edit of a vendored file with the manifest hash updated alongside it passes there and
// fails here.
// ponytail: skips when no Specialists checkout is reachable (CI has none). prepublishOnly
// re-vendors from the same checkout, so the release path cannot skip silently.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(path.join(repoRoot, '.xtrm/specialists-source.json'), 'utf8'));
const { resolved_sha: sha, source_path: sourcePath, repo_path: repoPath } = manifest.source;
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

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
let failures = 0;
for (const [skill, files] of Object.entries(manifest.files ?? {})) {
  for (const rel of Object.keys(files)) {
    const vendoredPath = path.join(repoRoot, '.xtrm/skills/default', skill, rel);
    let upstreamBytes;
    try {
      upstreamBytes = execFileSync('git', ['-C', upstream, 'show', `${sha}:${sourcePath}/${skill}/${rel}`], { maxBuffer: 1 << 28 });
    } catch {
      console.error(`${skill}/${rel}  missing upstream at ${sourcePath} @ ${sha.slice(0, 8)}`);
      failures += 1;
      continue;
    }
    const want = sha256(upstreamBytes);
    const got = existsSync(vendoredPath) ? sha256(readFileSync(vendoredPath)) : 'ABSENT';
    if (want !== got) {
      console.error(`${path.relative(repoRoot, vendoredPath)}  upstream=${want.slice(0, 16)} vendored=${got.slice(0, 16)}`);
      failures += 1;
    }
  }
}
if (failures) {
  console.error(`\nvendored-specialists-parity: ${failures} drifted file(s). Re-vendor with 'node scripts/vendor-specialists-from-manifest.mjs'.`);
  process.exit(1);
}
console.log(`vendored-specialists-parity OK — ${upstream} @ ${sha.slice(0, 8)}`);
