#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

// Batch G: per-runtime active/{claude,pi} subdirs were removed. These paths are
// now definitively dead code — the guard prevents accidental re-introduction.
const staleActiveTiers = ['.xtrm/skills/active/claude', '.xtrm/skills/active/pi'];
const transientAllowlist = [
  '.beads/',
  '.xtrm/reports/',
  '.specialists/jobs/',
  '.specialists/trace.jsonl',
  '.specialists/executor-result.md',
  '.xtrm/skills/default/update-xt/SKILL.md',
  // self-reference: this script contains the staleActiveTiers strings by
  // necessity to detect them elsewhere; skip itself to avoid a false positive.
  'scripts/check-layout-guards.mjs',
  // Legitimate references — code and docs that name the retired paths in
  // order to detect / strip / describe them. Adding these to the guard's
  // stale-tier check would forbid the very mechanism that keeps the
  // fleet clean of the drift.
  //
  //   pi-runtime.ts: LEGACY_XTRM_SKILLS_ENTRIES set (strips them from .pi/settings.json)
  //   pi-runtime-safeguards.test.ts: regression case that feeds them in and asserts they get stripped
  //   cli/dist/*: bundled build artifact of pi-runtime.ts
  //   CHANGELOG.md: describes the strip fix (xtrm-ec9um in v0.10.2)
  'cli/src/core/pi-runtime.ts',
  'cli/src/tests/pi-runtime-safeguards.test.ts',
  'cli/dist/index.cjs',
  'cli/dist/index.cjs.map',
  'CHANGELOG.md',
];

function trackedFiles() {
  const out = spawnSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' });
  if (out.status !== 0) throw new Error(out.stderr || 'git ls-files failed');
  return out.stdout.split('\0').filter(Boolean);
}

function ignored(p) {
  return transientAllowlist.some((x) => p === x || p.startsWith(x));
}

async function main() {
  const files = trackedFiles();
  const offenders = [];

  for (const file of files) {
    if (ignored(file)) continue;
    let text;
    try {
      text = await readFile(path.join(repoRoot, file), 'utf8');
    } catch {
      continue;
    }
    for (const stale of staleActiveTiers) {
      if (text.includes(stale)) offenders.push(`${file} -> ${stale}`);
    }
  }

  const packLeaks = files.filter((f) => f.startsWith('.xtrm/skills/active/'));

  if (offenders.length || packLeaks.length) {
    console.error('check-layout-guards failed');
    if (offenders.length) {
      console.error('stale active tier references:');
      for (const x of offenders) console.error(`  - ${x}`);
    }
    if (packLeaks.length) {
      console.error('pack includes forbidden active view paths:');
      for (const x of packLeaks) console.error(`  - ${x}`);
    }
    process.exit(1);
  }

  console.log('check-layout-guards passed');
}

await main();
