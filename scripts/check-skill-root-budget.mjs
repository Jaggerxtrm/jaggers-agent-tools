#!/usr/bin/env node
// Keeps the universal XTRM skill roots small enough to remain routers/procedures.
// The hard 500-line Agent Skills ceiling is enforced by check-managed-skills;
// these tighter budgets protect the default cognition surface specifically.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillsDir = path.join(repoRoot, '.xtrm', 'skills', 'default');

const BUDGETS = {
  'using-xtrm':                 220,
  'starting-and-resuming-work': 180,
  multiplexing:                 180,
  planning:                     180,
  'engineering-quality':        180,
  'using-specialists':          180,
  gitnexus:                     120,
  'skill-creator':              180,
  'find-skills':                140,
};

let failed = false;
for (const [name, max] of Object.entries(BUDGETS)) {
  const p = path.join(skillsDir, name, 'SKILL.md');
  if (!existsSync(p)) {
    failed = true;
    console.error(`FAIL  ${name.padEnd(28)} missing SKILL.md`);
    continue;
  }
  const lines = readFileSync(p, 'utf8').split('\n').length;
  const status = lines <= max ? 'OK ' : 'FAIL';
  if (lines > max) failed = true;
  console.log(`${status}  ${name.padEnd(28)} ${String(lines).padStart(4)} / ${max}`);
}

const actual = new Set(
  Object.keys(BUDGETS),
);
for (const name of Object.keys(BUDGETS)) actual.delete(name);

if (failed) {
  console.error('\nskill-root-budget: universal skill root budget failed. Move detail to one-level references/scripts rather than raising budgets casually.');
  process.exit(1);
}
