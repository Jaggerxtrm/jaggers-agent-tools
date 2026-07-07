import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';

const printedNudges = new Set<string>();

function getNudgeStatePath(key: string): string {
  return path.join(os.homedir(), '.xtrm', 'nudges', `${key}.json`);
}

export async function printNudgeOnce(key: string, lines: readonly string[]): Promise<boolean> {
  if (printedNudges.has(key)) {
    return false;
  }

  printedNudges.add(key);
  console.log(lines.join('\n'));

  const statePath = getNudgeStatePath(key);
  await fs.ensureDir(path.dirname(statePath));
  await fs.writeJson(statePath, {
    key,
    shownAt: new Date().toISOString(),
  }, { spaces: 2 });
  await fs.appendFile(statePath, '\n');
  return true;
}
