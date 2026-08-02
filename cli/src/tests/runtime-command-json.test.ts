import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
    launchWorktreeSession: vi.fn(async () => undefined),
}));

vi.mock('../utils/worktree-session.js', () => ({
    launchWorktreeSession: mocked.launchWorktreeSession,
}));

import { createClaudeCommand } from '../commands/claude.js';
import { createPiCommand } from '../commands/pi.js';

describe('structured detached runtime command flags', () => {
    beforeEach(() => mocked.launchWorktreeSession.mockClear());

    it.each([
        ['pi', createPiCommand],
        ['claude', createClaudeCommand],
    ] as const)('forwards --json and --no-attach from xt %s', async (runtime, createCommand) => {
        const command = createCommand();
        expect(command.helpInformation()).toContain('--json');

        await command.parseAsync(['node', 'xt', 'contract-smoke', '--no-attach', '--json']);

        expect(mocked.launchWorktreeSession).toHaveBeenCalledWith(expect.objectContaining({
            runtime,
            name: 'contract-smoke',
            attach: false,
            json: true,
        }));
    });
});
