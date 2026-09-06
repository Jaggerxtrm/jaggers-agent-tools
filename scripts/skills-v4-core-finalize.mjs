import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const OLD_SHA = 'e7a8dadd9adfb4115ddade8713a4eb1cd4378a77';
const FROZEN_SHA = 'f8cac893159959655d7787806704ce89d834d381';
const SELF = 'scripts/skills-v4-core-finalize.mjs';
const PROVENANCE_FILES = [
  '.xtrm/specialists-source.json',
  'docs/skills-ownership.json',
  'docs/skills-ownership.release.json',
];

for (const path of PROVENANCE_FILES) {
  const current = readFileSync(path, 'utf8');
  const count = current.split(OLD_SHA).length - 1;
  if (count === 0) {
    if (!current.includes(FROZEN_SHA)) throw new Error(`${path}: neither old nor frozen Specialists SHA found`);
    continue;
  }
  if (count !== 1) throw new Error(`${path}: expected exactly one old Specialists SHA, found ${count}`);
  writeFileSync(path, current.replace(OLD_SHA, FROZEN_SHA));
}

// Keep the canonical vendor entry point explicit for CI, releases, and local
// maintenance rather than requiring callers to know the underlying script path.
const packagePath = 'package.json';
const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
packageJson.scripts ??= {};
packageJson.scripts['vendor:specialists'] = 'node scripts/vendor-specialists-from-manifest.mjs';
writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

// Fail if a fourth durable tracked provenance surface still points at the
// superseded pin. This one-shot finalizer necessarily contains OLD_SHA and is
// removed before the durable commit, so exclude only this exact path.
try {
  const raw = execFileSync('git', ['grep', '-n', OLD_SHA], { encoding: 'utf8' }).trim();
  const stale = raw.split('\n').filter((line) => line && !line.startsWith(`${SELF}:`));
  if (stale.length) throw new Error(`stale Specialists SHA remains in tracked tree:\n${stale.join('\n')}`);
} catch (error) {
  if (error?.status !== 1) throw error; // git grep returns 1 when no matches exist.
}

console.log(`Core Specialists provenance pinned to ${FROZEN_SHA}`);
