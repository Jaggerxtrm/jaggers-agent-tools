import { access, chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const hookPath = new URL('../../../.xtrm/hooks/beads-claim-sync.mjs', import.meta.url);
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function runHook(command: string) {
  const root = await mkdtemp(join(tmpdir(), 'beads-claim-sync-'));
  tempDirs.push(root);
  await mkdir(join(root, '.beads'));
  const bin = join(root, 'bin');
  await mkdir(bin);
  const bd = join(bin, 'bd');
  await writeFile(bd, '#!/bin/sh\nexit 0\n');
  await chmod(bd, 0o755);

  const input = JSON.stringify({
    hook_event_name: 'PostToolUse',
    tool_name: 'Bash',
    cwd: root,
    session_id: 'session-1',
    tool_input: { command },
    tool_response: { exit_code: 0 },
  });
  const result = spawnSync(process.execPath, [hookPath.pathname], {
    input,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });

  return { root, result };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

describe('beads claim sync lifecycle ownership', () => {
  it.each([
    ['claim', 'bd update xtrm-1 --claim'],
    ['close', 'bd close xtrm-1 --reason done'],
  ])('keeps %s workflow behavior without emitting a competing lifecycle database', async (_name, command) => {
    const { root, result } = await runHook(command);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Beads');
    expect(await exists(join(root, '.xtrm', 'debug.db'))).toBe(false);
  });
});
