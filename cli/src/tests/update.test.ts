import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  checkDriftMock,
  runInstallMock,
  assureXtManagedPiPackagesMock,
  runExternalPiToolPatchMock,
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
  ensureUserAgentsSkillsSymlinkMock,
  ensureAgentsSkillsSymlinkMock,
} = vi.hoisted(() => ({
  checkDriftMock: vi.fn(),
  runInstallMock: vi.fn(),
  assureXtManagedPiPackagesMock: vi.fn(),
  runExternalPiToolPatchMock: vi.fn(),
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
  ensureUserAgentsSkillsSymlinkMock: vi.fn(),
  ensureAgentsSkillsSymlinkMock: vi.fn(),
}));

vi.mock('../core/drift.js', () => ({
  checkDrift: checkDriftMock,
}));

vi.mock('../core/registry-scaffold.js', () => ({
  resolvePackageRoot: resolvePackageRootMock,
}));

vi.mock('../core/pi-runtime.js', () => ({
  assureXtManagedPiPackages: assureXtManagedPiPackagesMock,
  runExternalPiToolPatch: runExternalPiToolPatchMock,
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

vi.mock('../core/skills-scaffold.js', () => ({
  ensureUserAgentsSkillsSymlink: ensureUserAgentsSkillsSymlinkMock,
  ensureAgentsSkillsSymlink: ensureAgentsSkillsSymlinkMock,
}));

import { createUpdateCommand } from '../commands/update.js';

let tmpDir = '';
let previousCwd = '';
let previousHome = '';

beforeEach(() => {
  previousCwd = process.cwd();
  previousHome = process.env.HOME ?? '';
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xtrm-update-test-'));
  process.chdir(tmpDir);
  const happyHome = path.join(tmpDir, 'happy-home');
  fs.ensureDirSync(path.join(happyHome, '.xtrm', 'skills', 'default'));
  process.env.HOME = happyHome;
  checkDriftMock.mockReset();
  runInstallMock.mockReset();
  assureXtManagedPiPackagesMock.mockReset();
  runExternalPiToolPatchMock.mockReset();
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
  ensureUserAgentsSkillsSymlinkMock.mockReset();
  ensureUserAgentsSkillsSymlinkMock.mockImplementation(async () => {
    const target = path.join(process.env.HOME || os.homedir(), '.xtrm', 'skills', 'default');
    if (!await fs.pathExists(target)) throw new Error(`Global runtime skills root missing: ${target}`);
  });
  ensureAgentsSkillsSymlinkMock.mockReset();
  ensureAgentsSkillsSymlinkMock.mockResolvedValue({ claude: 0, pi: 0 });
});

afterEach(() => {
  process.chdir(previousCwd);
  if (previousHome) process.env.HOME = previousHome;
  else delete process.env.HOME;
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
    expect(runInstallMock).toHaveBeenCalledTimes(1);
    expect(runInstallMock).toHaveBeenCalledWith(expect.objectContaining({
      dryRun: true,
      projectRoot: repo,
      skipGlobalPiPackageAssurance: true,
      skipExternalPiToolPatch: true,
    }));
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

    expect(runInstallMock).toHaveBeenCalledTimes(1);
    expect(runInstallMock).toHaveBeenCalledWith(expect.objectContaining({
      dryRun: true,
      projectRoot: repo,
      skipGlobalPiPackageAssurance: true,
      skipExternalPiToolPatch: true,
    }));
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

    expect(runInstallMock).toHaveBeenCalledTimes(1);
    expect(runInstallMock).toHaveBeenCalledWith(expect.objectContaining({
      dryRun: false,
      projectRoot: repo,
      skipGlobalPiPackageAssurance: true,
      skipExternalPiToolPatch: true,
    }));
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
    expect(runExternalPiToolPatchMock).toHaveBeenCalledWith(packageRoot, false);
    expect(assureXtManagedPiPackagesMock.mock.invocationCallOrder[0]).toBeLessThan(runExternalPiToolPatchMock.mock.invocationCallOrder[0]);
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
    expect(assureXtManagedPiPackagesMock).toHaveBeenCalledTimes(1);
    expect(runExternalPiToolPatchMock).toHaveBeenCalledTimes(1);
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
    expect(runInstallMock).toHaveBeenCalledTimes(1);
  });

  it('dry-run reports pending Pi runtime repair without applying it', async () => {
    const packageRoot = writePackageRoot(path.join(tmpDir, 'package-root'));
    fs.writeJsonSync(path.join(packageRoot, 'package.json'), { version: '1.2.3' });
    const repo = writeRepo(tmpDir, 'repo-a');
    resolvePackageRootMock.mockReturnValue(packageRoot);
    checkDriftMock.mockResolvedValue({ missing: [], upToDate: ['asset.txt'], drifted: [] });
    runInstallMock.mockResolvedValue({
      piRuntime: { extensionsAdded: [], extensionsUpdated: [], extensionsRemoved: [], packagesInstalled: [], failed: [], changed: true },
    });

    const result = await runUpdateCli(['--repo', repo]);

    expect(result.logs.join('\n')).toContain('Pi runtime repair pending');
    expect(runInstallMock).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
    expect(reconcileProjectClaudeHooksMock).not.toHaveBeenCalled();
  });

  it('apply reports a Pi runtime repair when registry is already current', async () => {
    const packageRoot = writePackageRoot(path.join(tmpDir, 'package-root'));
    fs.writeJsonSync(path.join(packageRoot, 'package.json'), { version: '1.2.3' });
    const repo = writeRepo(tmpDir, 'repo-a');
    resolvePackageRootMock.mockReturnValue(packageRoot);
    checkDriftMock.mockResolvedValue({ missing: [], upToDate: ['asset.txt'], drifted: [] });
    runInstallMock.mockResolvedValue({
      piRuntime: { extensionsAdded: [], extensionsUpdated: [], extensionsRemoved: ['pi-dex'], packagesInstalled: [], failed: [], changed: true },
    });

    const result = await runUpdateCli(['--apply', '--repo', repo]);

    expect(runInstallMock).toHaveBeenCalledTimes(1);
    expect(result.logs.join('\n')).toContain('Pi runtime repaired');
    expect(result.logs.join('\n')).not.toContain('already-current');
  });

  it('apply reports Pi reconciliation failure and sets a non-zero exit code', async () => {
    const packageRoot = writePackageRoot(path.join(tmpDir, 'package-root'));
    fs.writeJsonSync(path.join(packageRoot, 'package.json'), { version: '1.2.3' });
    const repo = writeRepo(tmpDir, 'repo-a');
    resolvePackageRootMock.mockReturnValue(packageRoot);
    checkDriftMock.mockResolvedValue({ missing: [], upToDate: ['asset.txt'], drifted: [] });
    runInstallMock.mockResolvedValue({
      piRuntime: { extensionsAdded: [], extensionsUpdated: [], extensionsRemoved: [], packagesInstalled: [], failed: ['npm:pi-gitnexus'], changed: false },
    });

    const result = await runUpdateCli(['--apply', '--repo', repo]);

    expect(result.exitCode).toBe(1);
    expect(result.logs.join('\n')).toContain('Pi reconciliation failed: npm:pi-gitnexus');
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
    expect(ensureGlobalSkillsBootstrappedMock).toHaveBeenCalledWith(packageRoot, {});
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
    expect(runExternalPiToolPatchMock).not.toHaveBeenCalled();
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
    expect(help).toContain('Routine refresh and repair for xtrm-managed files, runtimes, hooks, skills, and packages');
    expect(help).toContain('--all-repos');
  });
});
