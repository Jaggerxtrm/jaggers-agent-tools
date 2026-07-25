#!/usr/bin/env node
// Fails when a policed skill root SKILL.md exceeds its documented line budget.
// Budgets come from the xtrm-wiy5n.1.1 slim-roots contract.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillsDir = path.join(repoRoot, '.xtrm', 'skills', 'default');

const BUDGETS = {
  multiplexing:       { max: 160 },
  'multiplexing-team':{ max: 140 },
  // 'using-specialists' is specialists-owned and vendored via specialists-source.json.
  // Its slim must land in the specialists repo first, then re-vendor here. Re-add
  // with { max: 150 } once that lands.
  'deploy-monitor':   { max: 180 },
  'pr-reviewer':      { max: 160 },
};

let failed = false;
for (const [name, { max }] of Object.entries(BUDGETS)) {
  const p = path.join(skillsDir, name, 'SKILL.md');
  const lines = readFileSync(p, 'utf8').split('\n').length;
  const status = lines <= max ? 'OK ' : 'FAIL';
  if (lines > max) failed = true;
  console.log(`${status}  ${name.padEnd(20)} ${String(lines).padStart(4)} / ${max}`);
}
if (failed) {
  console.error('\nskill-root-budget: at least one root exceeds its documented budget.');
  process.exit(1);
}
