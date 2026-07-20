import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI_BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '../dist/index.cjs');

function run(args: string[]): { stdout: string; stderr: string; status: number } {
  const result = spawnSync(process.execPath, [CLI_BIN, ...args], { encoding: 'utf8' });
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', status: result.status ?? -1 };
}

describe('command migration help matrix', () => {
  it('keeps the staged primary hierarchy visible', () => {
    const result = run(['--help']);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/init/);
    expect(result.stdout).toMatch(/update/);
    expect(result.stdout).toMatch(/doctor/);
    expect(result.stdout).toMatch(/migrate/);
    expect(result.stdout).not.toMatch(/^\s+install\b/im);
  });

  it.each([
    [['bootstrap', '--help'], /deprecated.*update.*--apply.*--force/i],
    [['clean', '--help'], /deprecated.*update/i],
    [['pi', 'setup', '--help'], /--check.*pi status/i],
    [['pi', 'doctor', '--help'], /deprecated.*xt doctor/i],
    [['pi', 'reload', '--help'], /deprecated.*update.*--apply/i],
    [['claude', 'reload', '--help'], /deprecated.*claude install/i],
    [['claude', 'doctor', '--help'], /deprecated.*xt doctor/i],
  ] as const)('documents %s compatibility routing', (args, expected) => {
    const result = run(args);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(expected);
  });

  it('keeps distinct migration and domain commands documented', () => {
    const result = run(['help']);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/xt migrate/);
    expect(result.stdout).toMatch(/xt reset/);
    expect(result.stdout).toMatch(/xt skills/);
    expect(result.stdout).toMatch(/xt claude-sync/);
  });
});
