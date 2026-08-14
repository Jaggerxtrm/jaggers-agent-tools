import path from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const {
  runPiRuntimeSyncMock,
  syncGlobalPromptsMock,
  printGlobalPromptSyncSummaryMock,
  isPiInstalledMock,
  isPnpmInstalledMock,
} = vi.hoisted(() => ({
  runPiRuntimeSyncMock: vi.fn(),
  syncGlobalPromptsMock: vi.fn(),
  printGlobalPromptSyncSummaryMock: vi.fn(),
  isPiInstalledMock: vi.fn(),
  isPnpmInstalledMock: vi.fn(),
}));

vi.mock('../core/pi-runtime.js', () => ({
  runPiRuntimeSync: runPiRuntimeSyncMock,
}));

vi.mock('../core/global-prompt-sync.js', () => ({
  syncGlobalPrompts: syncGlobalPromptsMock,
  printGlobalPromptSyncSummary: printGlobalPromptSyncSummaryMock,
}));

vi.mock('../core/machine-bootstrap.js', () => ({
  isPiInstalled: isPiInstalledMock,
  isPnpmInstalled: isPnpmInstalledMock,
}));

import { runPiInstall } from '../commands/pi-install.js';

describe('runPiInstall global prompt sync wiring (xtrm-3ljgz.2)', () => {
  beforeEach(() => {
    runPiRuntimeSyncMock.mockReset();
    runPiRuntimeSyncMock.mockResolvedValue({
      extensionsAdded: [],
      extensionsUpdated: [],
      extensionsRemoved: [],
      packagesInstalled: [],
      failed: [],
      changed: false,
    });
    syncGlobalPromptsMock.mockReset();
    syncGlobalPromptsMock.mockResolvedValue({ targets: [] });
    printGlobalPromptSyncSummaryMock.mockReset();
    isPiInstalledMock.mockReset();
    isPiInstalledMock.mockReturnValue(true);
    isPnpmInstalledMock.mockReset();
    isPnpmInstalledMock.mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs the global prompt sync exactly once per invocation on init/install', async () => {
    await runPiInstall(false, false, path.join('/tmp', 'project'));

    expect(syncGlobalPromptsMock).toHaveBeenCalledTimes(1);
    expect(syncGlobalPromptsMock).toHaveBeenCalledWith({ dryRun: false });
    expect(printGlobalPromptSyncSummaryMock).toHaveBeenCalledTimes(1);
  });

  it('propagates dry-run to the prompt sync without mutating', async () => {
    await runPiInstall(true, false, path.join('/tmp', 'project'));

    expect(syncGlobalPromptsMock).toHaveBeenCalledTimes(1);
    expect(syncGlobalPromptsMock).toHaveBeenCalledWith({ dryRun: true });
  });

  it('skips the prompt sync when the update flow already ran it once', async () => {
    await runPiInstall(false, false, path.join('/tmp', 'project'), { skipGlobalPromptSync: true });

    expect(syncGlobalPromptsMock).not.toHaveBeenCalled();
    expect(printGlobalPromptSyncSummaryMock).not.toHaveBeenCalled();
  });
});
