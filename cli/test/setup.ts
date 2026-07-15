import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach } from 'vitest';

const tempRoot = path.resolve(os.tmpdir());
const runnerCwd = path.resolve(process.cwd());
const tmpGitPath = path.join(tempRoot, '.git');
const runnerStartsOutsideTmp = runnerCwd !== tempRoot && !runnerCwd.startsWith(`${tempRoot}${path.sep}`);

// HOME LEAK DETECTOR (xtrm-8zsi1).
// A prior full-suite run wiped the operator's real ~/.xtrm/skills/default and
// ~/.xtrm/hooks/ payload because tests that trigger init/install/bootstrap
// paths did not sandbox HOME. A universal HOME override was too aggressive
// (pi-runtime tests fall back to `npm view` when their PI_AGENT_DIR is
// package-empty, adding 5s network timeouts per managed package). Instead:
//
//   * Each leaky test file (init-phases, prune-retired-managed-skills, etc.)
//     sandboxes HOME in its own beforeEach/afterEach.
//   * This setup DETECTS regressions: if the guarded state.json files under
//     the real user's ~/.xtrm/{hooks,skills}/ ever change mtime during the
//     test process, throw immediately in afterEach so the offender is named.
const realHome = process.env.HOME ?? os.homedir();
const guardedPaths = [
  path.join(realHome, '.xtrm', 'hooks', 'state.json'),
  path.join(realHome, '.xtrm', 'skills', 'state.json'),
];

async function currentMtime(p: string): Promise<number> {
  try { return (await fs.stat(p)).mtimeMs; } catch { return -1; }
}

const initialMtimes = new Map<string, number>();
for (const p of guardedPaths) {
  // eslint-disable-next-line no-await-in-loop
  initialMtimes.set(p, await currentMtime(p));
}

async function assertRealHomeUntouched(): Promise<void> {
  for (const p of guardedPaths) {
    // eslint-disable-next-line no-await-in-loop
    const now = await currentMtime(p);
    const initial = initialMtimes.get(p) ?? -1;
    if (now !== initial) {
      // Update baseline so subsequent tests aren't spammed with the same
      // failure — but throw once loudly so the responsible test is named.
      initialMtimes.set(p, now);
      throw new Error(
        `test setup: real user's ${p} was touched during a test `
        + `(mtime ${initial} -> ${now}). This is the class of leak that wiped `
        + `~/.xtrm/skills/default and ~/.xtrm/hooks/ in xtrm-8zsi1. `
        + `Sandbox HOME in this test's beforeEach: `
        + `previousHome = process.env.HOME; process.env.HOME = fs.mkdtempSync(...); `
        + `and restore in afterEach.`,
      );
    }
  }
}

// A stale /tmp/.git makes git treat /tmp as a project root. Guard only runners
// started outside /tmp; never alter a suite whose real project root is /tmp.
async function removeTmpGitPollution(): Promise<void> {
  if (runnerStartsOutsideTmp) await fs.rm(tmpGitPath, { recursive: true, force: true });
}

await removeTmpGitPollution();

beforeEach(removeTmpGitPollution);
afterEach(async () => {
  await removeTmpGitPollution();
  await assertRealHomeUntouched();
});
