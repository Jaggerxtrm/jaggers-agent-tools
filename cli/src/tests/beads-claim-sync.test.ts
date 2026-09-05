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

async function runHook(command: string, stdout = '') {
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
    tool_response: { exit_code: 0, stdout },
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
  ])('keeps raw bd %s compatibility without emitting a competing lifecycle database', async (_name, command) => {
    const { root, result } = await runHook(command);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('XTRM work');
    expect(await exists(join(root, '.xtrm', 'debug.db'))).toBe(false);
  });

  it('binds xt work start receipt to the current Claude session', async () => {
    const { root, result } = await runHook(
      'xt work start "Fix README"',
      'XTRM_WORK_RECEIPT {"schema":"xt.work.receipt.v1","action":"start","bead":"xtrm-checkin"}\n✓ work created + claimed: xtrm-checkin',
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('claimed `xtrm-checkin`');
    expect(await exists(join(root, '.xtrm', 'statusline-claim'))).toBe(true);
  });

  it('records xt work done receipt as a close lifecycle transition', async () => {
    const { root, result } = await runHook(
      'xt work done xtrm-checkin --reason "validated"',
      'XTRM_WORK_RECEIPT {"schema":"xt.work.receipt.v1","action":"done","bead":"xtrm-checkin"}',
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('`xtrm-checkin` closed');
    expect(await exists(join(root, '.xtrm', 'debug.db'))).toBe(false);
  });
});
