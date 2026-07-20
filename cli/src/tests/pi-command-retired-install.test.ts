import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
    launchWorktreeSession: vi.fn(async () => undefined),
}));

vi.mock('../utils/worktree-session.js', () => ({
    launchWorktreeSession: mocked.launchWorktreeSession,
}));

import { createPiCommand } from '../commands/pi.js';

describe('retired Pi install token', () => {
    beforeEach(() => {
        mocked.launchWorktreeSession.mockClear();
        process.exitCode = undefined;
    });

    afterEach(() => {
        process.exitCode = undefined;
        vi.restoreAllMocks();
    });

    it('redirects without launching a session', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        await createPiCommand().parseAsync(['node', 'xt', 'install']);

        expect(errorSpy).toHaveBeenCalledWith('xt pi install is retired — run: xt update --apply --repo <path> (planned removal: v0.13.0)');
        expect(process.exitCode).toBe(1);
        expect(mocked.launchWorktreeSession).not.toHaveBeenCalled();
    });

    it('handles --help as the retired token, not parent help', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        await createPiCommand().parseAsync(['node', 'xt', 'install', '--help']);

        expect(errorSpy).toHaveBeenCalledWith('xt pi install is retired — run: xt update --apply --repo <path> (planned removal: v0.13.0)');
        expect(process.exitCode).toBe(1);
        expect(mocked.launchWorktreeSession).not.toHaveBeenCalled();
    });

    it('still launches adjacent arbitrary session names', async () => {
        await createPiCommand().parseAsync(['node', 'xt', 'installx']);

        expect(mocked.launchWorktreeSession).toHaveBeenCalledWith(expect.objectContaining({
            runtime: 'pi',
            name: 'installx',
        }));
        expect(process.exitCode).toBeUndefined();
    });
});
