import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  checkDriftMock,
  runInstallMock,
  assureXtManagedPiPackagesMock,
  resolvePackageRootMock,
  ensureBdAutoStagePatchMock,
  runDependencyMaintenanceMock,
  ensureServiceSkillsMock,
  reconcileProjectClaudeHooksMock,
  ensureGlobalSkillsBootstrappedMock,
  ensureGlobalHooksBootstrappedMock,
  reconcileGlobalClaudeHooksMock,
  reconcileGlobalPiHooksMock,
  logBootstrapTriggerMock,
} = vi.hoisted(() => ({
  checkDriftMock: vi.fn(),
  runInstallMock: vi.fn(),
  assureXtManagedPiPackagesMock: vi.fn(),
  resolvePackageRootMock: vi.fn(),
  ensureBdAutoStagePatchMock: vi.fn(),
  runDependencyMaintenanceMock: vi.fn(),
  ensureServiceSkillsMock: vi.fn(),
  reconcileProjectClaudeHooksMock: vi.fn(),
  ensureGlobalSkillsBootstrappedMock: vi.fn(),
  ensureGlobalHooksBootstrappedMock: vi.fn(),
  reconcileGlobalClaudeHooksMock: vi.fn(),
  reconcileGlobalPiHooksMock: vi.fn(),
  logBootstrapTriggerMock: vi.fn(),
}));

vi.mock('../core/drift.js', () => ({
  checkDrift: checkDriftMock,
}));

vi.mock('../core/registry-scaffold.js', () => ({
  resolvePackageRoot: resolvePackageRootMock,
}));

vi.mock('../core/pi-runtime.js', () => ({
  assureXtManagedPiPackages: assureXtManagedPiPackagesMock,
}));

vi.mock('../commands/install.js', () => ({
  runInstall: runInstallMock,
  isStrictRegistryMode: (opts: { strictRegistry?: boolean }) => opts.strictRegistry ?? process.env.XTRM_STRICT_REGISTRY === '1',
}));

vi.mock('../core/bd-auto-stage-patch.js', () => ({
  ensureBdAutoStagePatch: ensureBdAutoStagePatchMock,
  summarizeBdAutoStagePatch: (result: { config: string; hook: string }) => `bd export.git-add: ${result.config}, pre-commit shim: ${result.hook}`,
}));

vi.mock('../core/dependency-maintenance.js', () => ({
  runDependencyMaintenance: runDependencyMaintenanceMock,
  printDependencyMaintenanceSummary: vi.fn(),
}));

vi.mock('../core/service-skills-ensure.js', () => ({
  ensureServiceSkills: ensureServiceSkillsMock,
}));

vi.mock('../core/claude-runtime-sync.js', () => ({
  reconcileProjectClaudeHooks: reconcileProjectClaudeHooksMock,
  reconcileGlobalClaudeHooks: reconcileGlobalClaudeHooksMock,
}));

vi.mock('../core/global-skills-bootstrap.js', () => ({
  ensureGlobalSkillsBootstrapped: ensureGlobalSkillsBootstrappedMock,
  logBootstrapTrigger: logBootstrapTriggerMock,
}));

vi.mock('../core/global-hooks-bootstrap.js', () => ({
  ensureGlobalHooksBootstrapped: ensureGlobalHooksBootstrappedMock,
}));

vi.mock('../core/pi-runtime-hooks.js', () => ({
  reconcileGlobalPiHooks: reconcileGlobalPiHooksMock,
}));

vi.mock('../core/global-hooks-flag.js', () => ({
  shouldUseGlobalHooks: () => process.env.XTRM_GLOBAL_HOOKS === '1',
}));

import { createUpdateCommand } from '../commands/update.js';

let tmpDir = '';
let previousCwd = '';

beforeEach(() => {
  previousCwd = process.cwd();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xtrm-update-test-'));
  process.chdir(tmpDir);
  checkDriftMock.mockReset();
  runInstallMock.mockReset();
  assureXtManagedPiPackagesMock.mockReset();
  resolvePackageRootMock.mockReset();
  ensureBdAutoStagePatchMock.mockReset();
  runDependencyMaintenanceMock.mockReset();
  checkDriftMock.mockResolvedValue({ missing: ['asset.txt'], upToDate: [], drifted: [] });
  assureXtManagedPiPackagesMock.mockResolvedValue({
    statuses: [],
    missing: [],
    outdated: [],
    installed: [],
    refreshed: [],
    failed: [],
  });
  ensureBdAutoStagePatchMock.mockResolvedValue({ changed: false, config: 'already-disabled', hook: 'already-present', warnings: [] });
  runDependencyMaintenanceMock.mockResolvedValue({
    tools: [],
    bdDoctor: { state: 'checked' },
    gitnexusIndex: { state: 'current' },
  });
  ensureServiceSkillsMock.mockReset();
  ensureServiceSkillsMock.mockResolvedValue({ applicable: false, migratedPacks: [], alreadyCurrent: true, notes: [] });
  reconcileProjectClaudeHooksMock.mockReset();
  reconcileProjectClaudeHooksMock.mockResolvedValue({ settingsPath: '', changed: false, hooksEntries: 0 });
  ensureGlobalSkillsBootstrappedMock.mockReset();
  ensureGlobalSkillsBootstrappedMock.mockResolvedValue({ installedVersion: '1.0.0', changed: false });
  ensureGlobalHooksBootstrappedMock.mockReset();
  ensureGlobalHooksBootstrappedMock.mockResolvedValue({ installedVersion: '1.0.0', changed: false });
  reconcileGlobalClaudeHooksMock.mockReset();
  reconcileGlobalClaudeHooksMock.mockResolvedValue({ settingsPath: '', changed: false, hooksEntries: 0 });
  reconcileGlobalPiHooksMock.mockReset();
  reconcileGlobalPiHooksMock.mockResolvedValue({ settingsPath: '', changed: false, hooksEntries: 0 });
  logBootstrapTriggerMock.mockReset();
  logBootstrapTriggerMock.mockResolvedValue(undefined);
});

afterEach(() => {
  process.chdir(previousCwd);
  fs.removeSync(tmpDir);
  vi.restoreAllMocks();
});

async function runUpdateCli(args: string[]): Promise<{ logs: string[]; json?: unknown; exitCode: number | undefined }> {
  const logs: string[] = [];
  const logSpy = vi.spyOn(console, 'log').mockImplementation((...values: unknown[]) => {
    logs.push(values.map(String).join(' '));
  });
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;

  try {
    const command = createUpdateCommand();
    await command.parseAsync(['node', 'xtrm-update-test', ...args]);
    const jsonText = logs.join('\n');
    return { logs, json: jsonText.includes('{') ? JSON.parse(jsonText) : undefined, exitCode: process.exitCode };
  } finally {
    process.exitCode = previousExitCode;
    logSpy.mockRestore();
  }
}

function writePackageRoot(root: string): string {
  fs.ensureDirSync(path.join(root, '.xtrm'));
  fs.writeJsonSync(path.join(root, '.xtrm', 'registry.json'), {
    version: '1',
    assets: {},
  }, { spaces: 2 });
  return root;
}

function writeRepo(root: string, name: string): string {
  const repo = path.join(root, name);
  fs.ensureDirSync(path.join(repo, '.xtrm'));
  fs.writeJsonSync(path.join(repo, '.xtrm', 'registry.json'), {
    version: '1',
    assets: {},
  }, { spaces: 2 });
  return repo;
}

describe('xtrm update', () => {
  it('dry-run reports changes when current package registry differs from old installed registry', async () => {
    const packageRoot = writePackageRoot(path.join(tmpDir, 'package-root'));
    fs.writeJsonSync(path.join(packageRoot, 'package.json'), { version: '1.2.3' });
    const repo = writeRepo(tmpDir, 'repo-a');
    resolvePackageRootMock.mockReturnValue(packageRoot);

    const result = await runUpdateCli(['--repo', repo]);

    expect(checkDriftMock).toHaveBeenCalledWith(path.join(packageRoot, '.xtrm', 'registry.json'), path.join(repo, '.xtrm'), undefined);
    expect(runInstallMock).not.toHaveBeenCalled();
    expect(assureXtManagedPiPackagesMock).toHaveBeenCalledWith(false);
    expect(result.logs.join('\n')).toContain('refreshed');
    expect(result.logs.join('\n')).not.toContain('already-current');
  });

  it('dry-run reports refresh when only bd auto-stage patch is missing', async () => {
    const packageRoot = writePackageRoot(path.join(tmpDir, 'package-root'));
    fs.writeJsonSync(path.join(packageRoot, 'package.json'), { version: '1.2.3' });
    const repo = writeRepo(tmpDir, 'repo-a');
    await fs.ensureDir(path.join(repo, '.beads'));
    resolvePackageRootMock.mockReturnValue(packageRoot);
    checkDriftMock.mockResolvedValue({ missing: [], upToDate: ['asset.txt'], drifted: [] });
    ensureBdAutoStagePatchMock.mockResolvedValue({ changed: true, config: 'updated', hook: 'updated', warnings: [] });

    const result = await runUpdateCli(['--repo', repo]);

    expect(runInstallMock).not.toHaveBeenCalled();
    expect(result.logs.join('\n')).toContain('refreshed');
    expect(result.logs.join('\n')).toContain('bd export.git-add: updated');
  });

  it('apply patches bd auto-stage without running registry install when registry is current', async () => {
    const packageRoot = writePackageRoot(path.join(tmpDir, 'package-root'));
    fs.writeJsonSync(path.join(packageRoot, 'package.json'), { version: '1.2.3' });
    const repo = writeRepo(tmpDir, 'repo-a');
    await fs.ensureDir(path.join(repo, '.beads'));
    await fs.writeFile(path.join(repo, '.beads', 'config.yaml'), 'dolt:\n  shared-server: true\n');
    resolvePackageRootMock.mockReturnValue(packageRoot);
    checkDriftMock.mockResolvedValue({ missing: [], upToDate: ['asset.txt'], drifted: [] });
    ensureBdAutoStagePatchMock
      .mockResolvedValueOnce({ changed: true, config: 'updated', hook: 'updated', warnings: [] })
      .mockResolvedValueOnce({ changed: true, config: 'updated', hook: 'updated', warnings: [] });

    const result = await runUpdateCli(['--apply', '--repo', repo]);

    expect(runInstallMock).not.toHaveBeenCalled();
    expect(ensureBdAutoStagePatchMock).toHaveBeenLastCalledWith(repo, true);
    expect(result.logs.join('\n')).toContain('refreshed');
  });

  it('apply refreshes repo once when current package registry differs from old installed registry', async () => {
    const packageRoot = writePackageRoot(path.join(tmpDir, 'package-root'));
    fs.writeJsonSync(path.join(packageRoot, 'package.json'), { version: '1.2.3' });
    const repo = writeRepo(tmpDir, 'repo-a');
    resolvePackageRootMock.mockReturnValue(packageRoot);
    runInstallMock.mockResolvedValue(undefined);

    const result = await runUpdateCli(['--apply', '--repo', repo]);

    expect(checkDriftMock).toHaveBeenCalledWith(path.join(packageRoot, '.xtrm', 'registry.json'), path.join(repo, '.xtrm'), undefined);
    expect(runInstallMock).toHaveBeenCalledTimes(1);
    expect(assureXtManagedPiPackagesMock).toHaveBeenCalledWith(true);
    expect(result.logs.join('\n')).toContain('refreshed');
  });

  it('root walk updates every managed repo and continues after failures', async () => {
    const packageRoot = writePackageRoot(path.join(tmpDir, 'package-root'));
    fs.writeJsonSync(path.join(packageRoot, 'package.json'), { version: '1.2.3' });
    const root = path.join(tmpDir, 'root');
    const repoA = writeRepo(root, 'a');
    const repoB = writeRepo(root, 'b');
    const repoC = writeRepo(root, 'c');
    resolvePackageRootMock.mockReturnValue(packageRoot);
    runInstallMock.mockResolvedValue(undefined);

    const result = await runUpdateCli(['--apply', '--root', root]);

    expect(runInstallMock).toHaveBeenCalledTimes(3);
    expect(result.logs.join('\n')).toContain(repoA);
    expect(result.logs.join('\n')).toContain(repoB);
    expect(result.logs.join('\n')).toContain(repoC);
  });

  it('apply reconciles claude settings hooks even when registry is already current', async () => {
    const packageRoot = writePackageRoot(path.join(tmpDir, 'package-root'));
    fs.writeJsonSync(path.join(packageRoot, 'package.json'), { version: '1.2.3' });
    const repo = writeRepo(tmpDir, 'repo-a');
    resolvePackageRootMock.mockReturnValue(packageRoot);
    checkDriftMock.mockResolvedValue({ missing: [], upToDate: ['asset.txt'], drifted: [] });

    await runUpdateCli(['--apply', '--repo', repo]);

    expect(reconcileProjectClaudeHooksMock).toHaveBeenCalledWith(repo, { dryRun: false });
    expect(runInstallMock).not.toHaveBeenCalled();
  });

  it('apply self-heals dormant repo: hook rewiring alone flips already-current to refreshed', async () => {
    const packageRoot = writePackageRoot(path.join(tmpDir, 'package-root'));
    fs.writeJsonSync(path.join(packageRoot, 'package.json'), { version: '1.2.3' });
    const repo = writeRepo(tmpDir, 'repo-a');
    resolvePackageRootMock.mockReturnValue(packageRoot);
    checkDriftMock.mockResolvedValue({ missing: [], upToDate: ['asset.txt'], drifted: [] });
    reconcileProjectClaudeHooksMock.mockResolvedValue({ settingsPath: '', changed: true, hooksEntries: 3 });

    const result = await runUpdateCli(['--apply', '--repo', repo]);

    const out = result.logs.join('\n');
    expect(out).toContain('refreshed');
    expect(out).toContain('claude hooks rewired');
  });

  it('json output is valid JSON', async () => {
    const packageRoot = writePackageRoot(path.join(tmpDir, 'package-root'));
    fs.writeJsonSync(path.join(packageRoot, 'package.json'), { version: '1.2.3' });
    const repo = writeRepo(tmpDir, 'repo-a');
    resolvePackageRootMock.mockReturnValue(packageRoot);
    checkDriftMock.mockResolvedValue({ missing: [], upToDate: ['asset.txt'], drifted: [] });

    const result = await runUpdateCli(['--json', '--repo', repo]);

    expect(result.json).toEqual({
      repos: [{
        repo,
        status: 'already-current',
        maintenance: { tools: [], bdDoctor: { state: 'checked' }, gitnexusIndex: { state: 'current' } },
      }],
      packages: { statuses: [], missing: [], outdated: [], installed: [], refreshed: [], failed: [] },
    });
  });

  it('apply exits non-zero in strict registry env when registry source missing', async () => {
    const repo = writeRepo(tmpDir, 'repo-a');
    const packageRoot = writePackageRoot(path.join(tmpDir, 'package-root'));
    fs.writeJsonSync(path.join(packageRoot, 'package.json'), { version: '1.2.3' });
    resolvePackageRootMock.mockReturnValue(packageRoot);
    checkDriftMock.mockResolvedValue({ missing: ['missing/file.md'], upToDate: [], drifted: [] });
    runInstallMock.mockImplementation(async (opts: { strictRegistry?: boolean }) => {
      expect(opts.strictRegistry).toBe(true);
      throw new Error('Registry/source mismatch: missing package source files.\n    • .xtrm/skills/default/missing/file.md');
    });
    assureXtManagedPiPackagesMock.mockResolvedValue({
      statuses: [], missing: [], outdated: [], installed: [], refreshed: [], failed: [],
    });
    const previousStrict = process.env.XTRM_STRICT_REGISTRY;
    process.env.XTRM_STRICT_REGISTRY = '1';

    try {
      const result = await runUpdateCli(['--apply', '--repo', repo]);
      expect(result.exitCode).toBe(1);
      expect(result.logs.join('\n')).toContain('failed');
      expect(result.logs.join('\n')).not.toContain('/missing/file.md');
    } finally {
      process.env.XTRM_STRICT_REGISTRY = previousStrict;
    }
  });

  it('apply bootstraps global skills before drift check', async () => {
    const packageRoot = writePackageRoot(path.join(tmpDir, 'package-root'));
    fs.writeJsonSync(path.join(packageRoot, 'package.json'), { version: '1.2.3' });
    const repo = writeRepo(tmpDir, 'repo-a');
    resolvePackageRootMock.mockReturnValue(packageRoot);

    await runUpdateCli(['--apply', '--repo', repo]);

    expect(logBootstrapTriggerMock).toHaveBeenCalledWith({ command: 'update', cwd: tmpDir, pkgVersion: '1.2.3' });
    expect(ensureGlobalSkillsBootstrappedMock).toHaveBeenCalledWith(packageRoot);
    expect(logBootstrapTriggerMock.mock.invocationCallOrder[0]).toBeLessThan(checkDriftMock.mock.invocationCallOrder[0]);
    expect(ensureGlobalSkillsBootstrappedMock.mock.invocationCallOrder[0]).toBeLessThan(checkDriftMock.mock.invocationCallOrder[0]);
  });

  it('dry-run skips global bootstrap side effects', async () => {
    const packageRoot = writePackageRoot(path.join(tmpDir, 'package-root'));
    fs.writeJsonSync(path.join(packageRoot, 'package.json'), { version: '1.2.3' });
    const repo = writeRepo(tmpDir, 'repo-a');
    resolvePackageRootMock.mockReturnValue(packageRoot);

    await runUpdateCli(['--repo', repo]);

    expect(logBootstrapTriggerMock).not.toHaveBeenCalled();
    expect(ensureGlobalSkillsBootstrappedMock).not.toHaveBeenCalled();
  });

  it('does not drift-check absent direct global roots when XTRM_GLOBAL_SKILLS=1', async () => {
    const previousFlag = process.env.XTRM_GLOBAL_SKILLS;
    const previousHome = process.env.HOME;
    const packageRoot = writePackageRoot(path.join(tmpDir, 'package-root'));
    fs.writeJsonSync(path.join(packageRoot, 'package.json'), { version: '1.2.3' });
    const repo = writeRepo(tmpDir, 'repo-a');
    resolvePackageRootMock.mockReturnValue(packageRoot);
    process.env.XTRM_GLOBAL_SKILLS = '1';
    process.env.HOME = tmpDir;

    try {
      const result = await runUpdateCli(['--apply', '--repo', repo]);
      expect(checkDriftMock).not.toHaveBeenCalled();
      expect(result.logs.join('\n')).not.toMatch(/Run `xt migrate skills`/);
    } finally {
      if (previousFlag === undefined) delete process.env.XTRM_GLOBAL_SKILLS;
      else process.env.XTRM_GLOBAL_SKILLS = previousFlag;
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
    }
  });

  it('help mentions package freshness and refresh behavior', async () => {
    const command = createUpdateCommand();
    const help = await command.helpInformation();
    expect(help).toContain('global xt Pi packages');
    expect(help).toContain('missing or outdated packages');
    expect(help).toContain('--all-repos');
  });
});
