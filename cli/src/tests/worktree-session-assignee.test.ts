import os from 'node:os';
import path from 'node:path';
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    assignBeadToRuntime,
    runtimeAssigneeFromOrigin,
    shouldAutoAssignBead,
} from '../utils/worktree-session.js';

const sandboxes: string[] = [];

async function withFakeCommands(
    options: { assignee?: string; instanceId?: string; updateFails?: boolean },
    run: (capture: string) => Promise<void>,
): Promise<void> {
    const root = path.join(os.tmpdir(), `xt-assignee-${process.pid}-${Math.random().toString(36).slice(2)}`);
    const bin = path.join(root, 'bin');
    const capture = path.join(root, 'updates.jsonl');
    mkdirSync(bin, { recursive: true });
    sandboxes.push(root);

    writeFileSync(path.join(bin, 'bd'), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === 'show') {
  process.stdout.write(JSON.stringify([{ assignee: process.env.TEST_BD_ASSIGNEE || undefined }]));
  process.exit(0);
}
if (args[0] === 'update') {
  fs.appendFileSync(process.env.TEST_BD_CAPTURE, JSON.stringify(args) + '\\n');
  process.exit(process.env.TEST_BD_UPDATE_FAIL === '1' ? 1 : 0);
}
process.exit(2);
`);
    writeFileSync(path.join(bin, 'xtmux'), `#!/usr/bin/env node
process.stdout.write(JSON.stringify({
  schema_version: 'xtrm.runtime-origin.v1',
  agent_instance_id: process.env.TEST_RUNTIME_INSTANCE || undefined,
}));
`);
    chmodSync(path.join(bin, 'bd'), 0o755);
    chmodSync(path.join(bin, 'xtmux'), 0o755);

    const previous = {
        path: process.env.PATH,
        capture: process.env.TEST_BD_CAPTURE,
        assignee: process.env.TEST_BD_ASSIGNEE,
        instance: process.env.TEST_RUNTIME_INSTANCE,
        updateFail: process.env.TEST_BD_UPDATE_FAIL,
    };
    process.env.PATH = `${bin}:${previous.path ?? ''}`;
    process.env.TEST_BD_CAPTURE = capture;
    process.env.TEST_BD_ASSIGNEE = options.assignee ?? '';
    process.env.TEST_RUNTIME_INSTANCE = options.instanceId ?? '';
    process.env.TEST_BD_UPDATE_FAIL = options.updateFails ? '1' : '0';
    try {
        await run(capture);
    } finally {
        const restore = (key: string, value: string | undefined): void => {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        };
        restore('PATH', previous.path);
        restore('TEST_BD_CAPTURE', previous.capture);
        restore('TEST_BD_ASSIGNEE', previous.assignee);
        restore('TEST_RUNTIME_INSTANCE', previous.instance);
        restore('TEST_BD_UPDATE_FAIL', previous.updateFail);
    }
}

afterEach(() => {
    vi.restoreAllMocks();
    while (sandboxes.length > 0) rmSync(sandboxes.pop()!, { recursive: true, force: true });
});

describe('runtime bead assignee', () => {
    it('uses the five-character runtime-origin short form for both runtimes', () => {
        expect(runtimeAssigneeFromOrigin('pi', 'd2e8cd02-03ce-4ac1-9b7f-b5114e6dbde6')).toBe('pi/d2e8c');
        expect(runtimeAssigneeFromOrigin('claude', 'xtrm://runtime/9y3mn')).toBe('claude/9y3mn');
    });

    it('preserves operator overrides but allows empty and prior runtime assignees', () => {
        expect(shouldAutoAssignBead(undefined)).toBe(true);
        expect(shouldAutoAssignBead('pi/4h2xk')).toBe(true);
        expect(shouldAutoAssignBead('claude/9y3mn')).toBe(true);
        expect(shouldAutoAssignBead('jaggerxtrm')).toBe(false);
    });
});

describe('assignBeadToRuntime', () => {
    it.each([
        ['pi' as const, '4h2xk-origin', 'pi/4h2xk'],
        ['claude' as const, '9y3mn-origin', 'claude/9y3mn'],
    ])('updates %s bead ownership from runtime-origin', async (runtime, instanceId, expected) => {
        await withFakeCommands({ instanceId }, async (capture) => {
            assignBeadToRuntime('xtrm-test', runtime, process.cwd());
            const args = JSON.parse(readFileSync(capture, 'utf8').trim());
            expect(args).toEqual(['update', 'xtrm-test', `--assignee=${expected}`, '--json']);
        });
    });

    it('updates a prior runtime assignee on restart', async () => {
        await withFakeCommands({ assignee: 'pi/old12', instanceId: 'new34-origin' }, async (capture) => {
            assignBeadToRuntime('xtrm-test', 'pi', process.cwd());
            expect(readFileSync(capture, 'utf8')).toContain('--assignee=pi/new34');
        });
    });

    it('preserves an operator assignee override', async () => {
        await withFakeCommands({ assignee: 'operator', instanceId: 'new34-origin' }, async (capture) => {
            assignBeadToRuntime('xtrm-test', 'pi', process.cwd());
            expect(() => readFileSync(capture, 'utf8')).toThrow();
        });
    });

    it('warns but does not abort when bd update fails', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        await withFakeCommands({ instanceId: '4h2xk-origin', updateFails: true }, async () => {
            expect(() => assignBeadToRuntime('xtrm-test', 'pi', process.cwd())).not.toThrow();
        });
        expect(error).toHaveBeenCalledWith(expect.stringContaining('session launch continues'));
    });
});
