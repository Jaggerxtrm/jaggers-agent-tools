#!/usr/bin/env node
// Fails on the documentation drift named in docs/design/audit-reconcile-v0724.md §5.2.
// Scans core-owned skill docs + managed instruction blocks. Specialists-vendored skills
// are excluded — they are policed by check-vendored-specialists-skill-parity.mjs and must
// be fixed upstream first (docs/skills-ownership.md).
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendored = new Set(JSON.parse(readFileSync(path.join(repoRoot, '.xtrm/specialists-source.json'), 'utf8')).skills);

const RULES = [
  // `sp run --background` IS supported (specialists src/cli/run.ts:938-996, documented by
  // specialists#228 with a help/flag parity test). The inverse is the real drift: a trailing
  // `&` does not survive an agent bash tool, which reaps descendants on return or timeout.
  { id: 'sp-run-ampersand-detach', why: 'a trailing `&` does not detach `sp run` from an agent pane; use --background',
    test: (l) => /\bsp run\b/.test(l) && /(>|2>&1)?\s*&\s*$/.test(l) && !/--background/.test(l) },
  // Exemption must be the negative wording valid guidance uses — merely naming `final-result`
  // would let "use capture-pane as the final-result protocol" through.
  { id: 'capture-pane-as-result', why: 'capture-pane is live-state diagnosis only; terminal truth is `sp result` / `agent-last` / `message-get`',
    test: (l) => l.includes('capture-pane') && !/live[- ](state|ui)|never as (a )?final-result/i.test(l) },
  { id: 'job-status-spelling', why: 'specialist job statuses are starting|running|waiting|done|error|cancelled',
    test: (l) => /`(completed|queued|failed)`/.test(l) && /\b(sp |specialist|job)/i.test(l) },
  // Pane component may be a literal, a <placeholder>, or a $variable — all teach the same
  // unsupported combined target.
  { id: 'combined-session-pane', why: 'xtmux takes session and pane as separate flags; never a combined session:pane target',
    test: (l) => /--(to|for|pane|target)[= ]+["']?[<${]?[A-Za-z0-9_-]+[>}]?:[<${]?[A-Za-z0-9_-]/.test(l) },
];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (entry.isFile() && p.endsWith('.md')) out.push(p);
  }
  return out;
}

const skillsDir = path.join(repoRoot, '.xtrm', 'skills', 'default');
const instructionsDir = path.join(repoRoot, '.xtrm', 'config', 'instructions');
const files = [
  ...walk(skillsDir).filter((p) => !vendored.has(path.relative(skillsDir, p).split(path.sep)[0])),
  ...walk(instructionsDir),
];

let failures = 0;
for (const file of files) {
  const rel = path.relative(repoRoot, file);
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    for (const rule of RULES) {
      if (!rule.test(line)) continue;
      failures += 1;
      console.error(`${rel}:${i + 1}  [${rule.id}] ${rule.why}\n    ${line.trim()}`);
    }
  });
}
console.log(`forbidden-phrases: scanned ${files.length} files, ${failures} violation(s)`);
if (failures) process.exit(1);
