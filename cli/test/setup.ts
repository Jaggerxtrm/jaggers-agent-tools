import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach } from 'vitest';

const tempRoot = path.resolve(os.tmpdir());
const runnerCwd = path.resolve(process.cwd());
const tmpGitPath = path.join(tempRoot, '.git');
const runnerStartsOutsideTmp = runnerCwd !== tempRoot && !runnerCwd.startsWith(`${tempRoot}${path.sep}`);

// A stale /tmp/.git makes git treat /tmp as a project root. Guard only runners
// started outside /tmp; never alter a suite whose real project root is /tmp.
async function removeTmpGitPollution(): Promise<void> {
  if (runnerStartsOutsideTmp) await fs.rm(tmpGitPath, { recursive: true, force: true });
}

await removeTmpGitPollution();
beforeEach(removeTmpGitPollution);
afterEach(removeTmpGitPollution);
