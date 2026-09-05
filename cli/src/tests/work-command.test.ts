import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildLightweightWorkDescription,
  createWorkCommand,
  parseCreatedBeadId,
  selectSingleActiveBeadId,
  type BdRunner,
} from '../commands/work.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('xt work helpers', () => {
  it('builds a bounded execution check-in instead of a fake full contract', () => {
    const description = buildLightweightWorkDescription('Fix README wording', 'README matches runtime source');

    expect(description).toContain('WORK\nFix README wording');
    expect(description).toContain('VALIDATION\nREADME matches runtime source');
    expect(description).toContain('Lightweight XTRM execution check-in');
    expect(description).toContain('run /planning');
    expect(description).not.toContain('NON_GOALS');
  });

  it('parses bd create JSON id defensively', () => {
    expect(parseCreatedBeadId('{"id":"xtrm-123"}')).toBe('xtrm-123');
    expect(parseCreatedBeadId('{"id":42}')).toBeNull();
    expect(parseCreatedBeadId('not-json')).toBeNull();
  });

  it('selects an implicit active bead only when the state is unambiguous', () => {
    expect(selectSingleActiveBeadId('[{"id":"xtrm-1"}]')).toBe('xtrm-1');
    expect(selectSingleActiveBeadId('{"issues":[{"id":"xtrm-2"}]}')).toBe('xtrm-2');
    expect(selectSingleActiveBeadId('[{"id":"xtrm-1"},{"id":"xtrm-2"}]')).toBeNull();
    expect(selectSingleActiveBeadId('[]')).toBeNull();
  });
});

describe('xt work start', () => {
  it('creates, claims, relates, and emits a stable runtime receipt', async () => {
    const calls: string[][] = [];
    const writes: string[] = [];
    const runBd: BdRunner = (args) => {
      calls.push(args);
      if (args[0] === 'create') return { ok: true, stdout: '{"id":"xtrm-checkin"}', stderr: '', status: 0 };
      return { ok: true, stdout: '{}', stderr: '', status: 0 };
    };
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);

    const command = createWorkCommand({ runBd, cwd: () => '/repo', packageRoot: () => '/pkg' });
    await command.parseAsync([
      'node', 'work', 'start', 'Fix README wording',
      '--validation', 'README matches runtime source',
      '--relates', 'xtrm-parent',
      '--json',
    ]);

    expect(calls[0]).toEqual(expect.arrayContaining([
      'create', '--type', 'task', '--priority', '2', '--title', 'Fix README wording', '--json',
    ]));
    expect(calls[0].join(' ')).toContain('Lightweight XTRM execution check-in');
    expect(calls[1]).toEqual(['update', 'xtrm-checkin', '--claim', '--json']);
    expect(calls[2]).toEqual(['dep', 'relate', 'xtrm-checkin', 'xtrm-parent']);
    expect(writes.join('')).toContain('XTRM_WORK_RECEIPT {"schema":"xt.work.receipt.v1","action":"start","bead":"xtrm-checkin"}');
  });

  it('claims existing substantial work without creating a second bead', async () => {
    const calls: string[][] = [];
    const writes: string[] = [];
    const runBd: BdRunner = (args) => {
      calls.push(args);
      return { ok: true, stdout: '{}', stderr: '', status: 0 };
    };
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);

    const command = createWorkCommand({ runBd, cwd: () => '/repo', packageRoot: () => '/pkg' });
    await command.parseAsync(['node', 'work', 'start', '--bead', 'xtrm-planned', '--json']);

    expect(calls).toEqual([
      ['update', 'xtrm-planned', '--claim', '--json'],
    ]);
    expect(writes.join('')).toContain('XTRM_WORK_RECEIPT {"schema":"xt.work.receipt.v1","action":"start","bead":"xtrm-planned"}');
  });
});
