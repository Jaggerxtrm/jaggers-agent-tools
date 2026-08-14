import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempRoot = '';
let previousPiAgentDir: string | undefined;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'xtrm-pi-runtime-'));
  previousPiAgentDir = process.env.PI_AGENT_DIR;
  process.env.PI_AGENT_DIR = path.join(tempRoot, 'pi-agent');
  vi.resetModules();
});

afterEach(async () => {
  if (previousPiAgentDir === undefined) {
    delete process.env.PI_AGENT_DIR;
  } else {
    process.env.PI_AGENT_DIR = previousPiAgentDir;
  }
  await fs.remove(tempRoot);
  vi.restoreAllMocks();
});

describe('pi runtime safeguards', () => {
  it('resolves bundled pi runtime sources from the workspace package layout', async () => {
    const { resolveManagedPiCoreSourceDir, resolveManagedPiExtensionsSourceDir } = await import('../core/pi-runtime.js');
    const repoRoot = path.resolve(process.cwd(), '..');

    expect(resolveManagedPiExtensionsSourceDir()).toBe(path.join(repoRoot, 'packages/pi-extensions/extensions'));
    expect(resolveManagedPiCoreSourceDir()).toBe(path.join(repoRoot, 'packages/pi-extensions/src/core'));
  });

  it('does not treat legacy extensions/core as the managed core library', async () => {
    const { resolveManagedPiCoreSourceDir } = await import('../core/pi-runtime.js');
    const legacyRoot = path.join(tempRoot, 'legacy-layout');
    await fs.ensureDir(path.join(legacyRoot, '.xtrm', 'extensions', 'core'));

    expect(resolveManagedPiCoreSourceDir(legacyRoot)).toBeNull();
  });

  it('detects npmmirror 404s and emits the scoped npmjs hint for pi extensions', async () => {
    const { getPiPackageInstallFailureHint, shouldRetryPiInstallViaNpmjs } = await import('../core/pi-runtime.js');
    const output = 'npm error 404 Not Found - GET https://cdn.npmmirror.com/packages/%40jaggerxtrm/pi-extensions/0.7.8/pi-extensions-0.7.8.tgz';

    expect(shouldRetryPiInstallViaNpmjs('npm:@jaggerxtrm/pi-extensions', output)).toBe(true);
    expect(getPiPackageInstallFailureHint('npm:@jaggerxtrm/pi-extensions', output)).toEqual([
      'detected registry mirror 404 for npm:@jaggerxtrm/pi-extensions',
      'best fix: npm config set @jaggerxtrm:registry https://registry.npmjs.org',
    ]);
    expect(getPiPackageInstallFailureHint('npm:pi-gitnexus', output)).toEqual([]);
  });

  it('resolves npm-backed pi packages from global npm root when agent tree is absent', async () => {
    const { getInstalledPiPackageVersion, isPackagePresentInPiAgent } = await import('../core/pi-runtime.js');
    const npmRootDir = path.join(tempRoot, 'global-npm-root', 'node_modules');
    const packageDir = path.join(npmRootDir, '@zenobius', 'pi-worktrees');
    await fs.outputJson(path.join(packageDir, 'package.json'), { version: '2.3.4' });

    await expect(getInstalledPiPackageVersion(process.env.PI_AGENT_DIR as string, '@zenobius/pi-worktrees', npmRootDir)).resolves.toBe('2.3.4');
    await expect(isPackagePresentInPiAgent(process.env.PI_AGENT_DIR as string, 'npm:@zenobius/pi-worktrees', npmRootDir)).resolves.toBe(true);
  });

  it('prefers local agent package version over global fallback for unscoped pi-coding-agent', async () => {
    const { getInstalledPiPackageVersion } = await import('../core/pi-runtime.js');
    const agentDir = process.env.PI_AGENT_DIR as string;
    const npmRootDir = path.join(tempRoot, 'global-npm-root', 'node_modules');
    await fs.outputJson(path.join(agentDir, 'npm', 'node_modules', 'pi-coding-agent', 'package.json'), { version: '1.2.3' });
    await fs.outputJson(path.join(npmRootDir, 'pi-coding-agent', 'package.json'), { version: '9.9.9' });

    await expect(getInstalledPiPackageVersion(agentDir, 'pi-coding-agent', npmRootDir)).resolves.toBe('1.2.3');
  });

  it('classifies managed npm-backed pi package freshness with an injectable provider', async () => {
    const { getManagedPiPackageFreshness } = await import('../core/pi-runtime.js');

    const statuses = await getManagedPiPackageFreshness((piPackageId) => {
      const versions: Record<string, { installedVersion: string | null; expectedVersion: string | null }> = {
        'npm:current-package': { installedVersion: '1.2.3', expectedVersion: '1.2.3' },
        'npm:outdated-package': { installedVersion: '1.2.2', expectedVersion: '1.2.3' },
        'npm:missing-package': { installedVersion: null, expectedVersion: '1.2.3' },
        'npm:unknown-package': { installedVersion: '1.2.3', expectedVersion: null },
      };
      return versions[piPackageId] ?? { installedVersion: null, expectedVersion: null };
    }, [
      { id: 'npm:current-package', displayName: 'current', required: true },
      { id: 'npm:outdated-package', displayName: 'outdated', required: true },
      { id: 'npm:missing-package', displayName: 'missing', required: true },
      { id: 'npm:unknown-package', displayName: 'unknown', required: true },
    ]);

    expect(statuses.map(status => [
      status.pkg.id,
      status.npmPackageName,
      status.installedVersion,
      status.expectedVersion,
      status.state,
    ])).toEqual([
      ['npm:current-package', 'current-package', '1.2.3', '1.2.3', 'current'],
      ['npm:outdated-package', 'outdated-package', '1.2.2', '1.2.3', 'outdated'],
      ['npm:missing-package', 'missing-package', null, '1.2.3', 'missing'],
      ['npm:unknown-package', 'unknown-package', '1.2.3', null, 'version-unknown'],
    ]);
  });

  it('exposes the canonical xt-managed pi package inventory for freshness checks', async () => {
    const { getXtManagedPiPackages } = await import('../core/pi-runtime.js');

    expect(getXtManagedPiPackages().map(pkg => pkg.id)).toEqual([
      'npm:@jaggerxtrm/pi-extensions',
      'npm:pi-gitnexus',
      'npm:@zenobius/pi-worktrees',
      'npm:@robhowley/pi-structured-return',
      'npm:@aliou/pi-guardrails',
      'npm:@aliou/pi-processes',
      'npm:pi-mcp-adapter',
    ]);
  });

  it('builds a doctor report for all-present xt pi packages', async () => {
    const { getXtManagedPiPackageDoctorReport } = await import('../core/pi-runtime.js');

    const versionProvider = vi.fn(async () => ({
      installedVersion: '1.0.0',
      expectedVersion: '1.0.0',
    }));
    const report = await getXtManagedPiPackageDoctorReport(versionProvider);

    expect(report.hasIssues).toBe(false);
    expect(report.issues).toEqual([]);
    expect(versionProvider).toHaveBeenCalledTimes(7);
  });

  it('marks globally installed scoped packages as current or outdated, never missing', async () => {
    const { getManagedPiPackageFreshness } = await import('../core/pi-runtime.js');
    const npmRootDir = path.join(tempRoot, 'global-npm-root', 'node_modules');
    const packageDir = path.join(npmRootDir, '@scope', 'pi-foo');
    await fs.outputJson(path.join(packageDir, 'package.json'), { version: '3.4.5' });

    const statuses = await getManagedPiPackageFreshness(async (_piPackageId, npmPackageName) => {
      const installedVersion = await fs.readJson(path.join(npmRootDir, npmPackageName, 'package.json'))
        .then((pkg: { version?: unknown }) => typeof pkg.version === 'string' ? pkg.version : null)
        .catch(() => null);
      return { installedVersion, expectedVersion: '3.4.5' };
    }, [
      { id: 'npm:@scope/pi-foo', displayName: 'pi-foo', required: true },
    ]);

    expect(statuses).toEqual([
      expect.objectContaining({
        pkg: expect.objectContaining({ id: 'npm:@scope/pi-foo' }),
        installedVersion: '3.4.5',
        expectedVersion: '3.4.5',
        state: 'current',
      }),
    ]);
    expect(statuses.some(status => status.state === 'missing')).toBe(false);
  });

  it('builds a doctor report for missing, outdated, and unknown xt pi packages with remediation commands', async () => {
    const { getXtManagedPiPackageDoctorReport } = await import('../core/pi-runtime.js');

    const report = await getXtManagedPiPackageDoctorReport(async (piPackageId) => {
      if (piPackageId === 'npm:@zenobius/pi-worktrees') {
        return { installedVersion: null, expectedVersion: '1.1.0' };
      }
      if (piPackageId === 'npm:pi-gitnexus') {
        return { installedVersion: '1.0.0', expectedVersion: '1.1.0' };
      }
      if (piPackageId === 'npm:@aliou/pi-processes') {
        return { installedVersion: '1.0.0', expectedVersion: null };
      }
      return { installedVersion: '1.0.0', expectedVersion: '1.0.0' };
    });

    expect(report.hasIssues).toBe(true);
    expect(report.missing.map(issue => [issue.pkg.id, issue.remediation])).toEqual([
      ['npm:@zenobius/pi-worktrees', 'pi install npm:@zenobius/pi-worktrees'],
    ]);
    expect(report.outdated.map(issue => [issue.pkg.id, issue.installedVersion, issue.expectedVersion, issue.remediation])).toEqual([
      ['npm:pi-gitnexus', '1.0.0', '1.1.0', 'pi install npm:pi-gitnexus'],
    ]);
    expect(report.issues.some(issue => issue.state === 'version-unknown' && issue.pkg.id === 'npm:@aliou/pi-processes')).toBe(true);
    expect(report.issues.find(issue => issue.state === 'version-unknown')?.remediation).toContain('check network/npm registry');
  });

  it('prunes stale pi-dex entries because xtrm-ui already replaces it', async () => {
    const { pruneConflictingPiPackageEntries } = await import('../core/pi-runtime.js');

    expect(pruneConflictingPiPackageEntries([
      'npm:pi-dex',
      'npm:pi-gitnexus',
      'npm:@jaggerxtrm/pi-extensions',
    ])).toEqual({
      kept: ['npm:pi-gitnexus', 'npm:@jaggerxtrm/pi-extensions'],
      removed: ['npm:pi-dex'],
    });
  });

  it('ensures every canonical xt pi package in the global pi agent npm tree', async () => {
    const { ensureAlwaysGlobalPiPackages, getXtManagedPiPackages } = await import('../core/pi-runtime.js');
    const agentDir = path.join(tempRoot, 'global-agent');
    const installCalls: string[] = [];

    const result = await ensureAlwaysGlobalPiPackages(
      false,
      undefined,
      agentDir,
      (piPackageId) => {
        installCalls.push(piPackageId);
        return { status: 0, stdout: '', stderr: '' };
      },
      null,
    );

    const expectedPackageIds = getXtManagedPiPackages().map(pkg => pkg.id);
    expect(installCalls).toEqual(expectedPackageIds);
    expect(result.installed).toEqual(expectedPackageIds);
    expect(result.failed).toEqual([]);
  });

  it('reports missing and outdated xt pi packages and refreshes only stale ones', async () => {
    const { assureXtManagedPiPackages } = await import('../core/pi-runtime.js');
    const agentDir = path.join(tempRoot, 'global-agent');
    const packageVersions: Record<string, { installedVersion: string | null; expectedVersion: string | null }> = {
      'npm:pi-gitnexus': { installedVersion: null, expectedVersion: '1.0.0' },
      'npm:@zenobius/pi-worktrees': { installedVersion: '1.0.0', expectedVersion: '1.1.0' },
      'npm:@robhowley/pi-structured-return': { installedVersion: '1.0.0', expectedVersion: '1.0.0' },
      'npm:@aliou/pi-guardrails': { installedVersion: '1.0.0', expectedVersion: '1.0.0' },
      'npm:@aliou/pi-processes': { installedVersion: '1.0.0', expectedVersion: '1.0.0' },
      'npm:@jaggerxtrm/pi-extensions': { installedVersion: '1.0.0', expectedVersion: '1.0.0' },
      'npm:pi-mcp-adapter': { installedVersion: '1.0.0', expectedVersion: '1.0.0' },
    };
    const installCalls: string[] = [];

    const result = await assureXtManagedPiPackages(
      false,
      undefined,
      agentDir,
      (piPackageId) => {
        installCalls.push(piPackageId);
        return { status: 0, stdout: '', stderr: '' };
      },
      async (piPackageId) => packageVersions[piPackageId] ?? { installedVersion: null, expectedVersion: null },
    );

    expect(result.missing.map(status => status.pkg.id)).toEqual(['npm:pi-gitnexus']);
    expect(result.outdated.map(status => status.pkg.id)).toEqual(['npm:@zenobius/pi-worktrees']);
    expect(installCalls).toEqual(['npm:pi-gitnexus', 'npm:@zenobius/pi-worktrees']);
    expect(result.installed).toEqual(['npm:pi-gitnexus']);
    expect(result.refreshed).toEqual(['npm:@zenobius/pi-worktrees']);
    expect(result.failed).toEqual([]);
  });

  it('does not treat project pi settings as proof of global package installation', async () => {
    const { ensureAlwaysGlobalPiPackages, getXtManagedPiPackages } = await import('../core/pi-runtime.js');
    const agentDir = path.join(tempRoot, 'global-agent');
    const projectRoot = path.join(tempRoot, 'project');
    const projectPackageIds = getXtManagedPiPackages().map(pkg => pkg.id);
    await fs.outputJson(path.join(projectRoot, '.pi', 'settings.json'), { packages: projectPackageIds });

    const installCalls: string[] = [];
    await ensureAlwaysGlobalPiPackages(
      false,
      undefined,
      agentDir,
      (piPackageId) => {
        installCalls.push(piPackageId);
        return { status: 0, stdout: '', stderr: '' };
      },
      null,
    );

    expect(installCalls).toEqual(projectPackageIds);
  });

  it('repairs incorrect @xtrm/pi-core symlink target', async () => {
    const { ensureCorePackageSymlink } = await import('../core/pi-runtime.js');

    const projectRoot = path.join(tempRoot, 'project');
    const coreDir = path.join(projectRoot, '.xtrm', 'extensions', 'core');
    const symlinkDir = path.join(projectRoot, '.xtrm', 'extensions', 'node_modules', '@xtrm');
    const symlinkPath = path.join(symlinkDir, 'pi-core');
    const wrongTarget = path.join(projectRoot, 'wrong-core');

    await fs.ensureDir(coreDir);
    await fs.ensureDir(wrongTarget);
    await fs.ensureDir(symlinkDir);
    await fs.symlink(path.relative(symlinkDir, wrongTarget), symlinkPath);

    const status = await ensureCorePackageSymlink(coreDir, projectRoot, false);

    expect(status).toBe('repaired');
    expect((await fs.lstat(symlinkPath)).isSymbolicLink()).toBe(true);

    const resolvedTarget = path.resolve(symlinkDir, await fs.readlink(symlinkPath));
    expect(resolvedTarget).toBe(path.resolve(coreDir));
  });

  it('removes stale pi-mcp-adapter override missing commands.js', async () => {
    const { remediateStalePiMcpAdapterOverride } = await import('../core/pi-runtime.js');

    const overrideDir = path.join(process.env.PI_AGENT_DIR as string, 'extensions', 'pi-mcp-adapter');
    await fs.ensureDir(overrideDir);
    await fs.writeJson(path.join(overrideDir, 'package.json'), { name: 'pi-mcp-adapter' });

    const result = await remediateStalePiMcpAdapterOverride(false);

    expect(result.stale).toBe(true);
    expect(result.remediated).toBe(true);
    expect(await fs.pathExists(overrideDir)).toBe(false);
  });

  describe('updatePiSettings — pi skills resolution paths (xtrm-4h6u)', () => {
    it('does not write retired managed skills entry when repo has no project-scoped packs', async () => {
      const { updatePiSettings } = await import('../core/pi-runtime.js');
      const projectRoot = path.join(tempRoot, 'fresh-project');
      await fs.ensureDir(projectRoot);

      await updatePiSettings(projectRoot, false);

      const settings = await fs.readJson(path.join(projectRoot, '.pi', 'settings.json'));
      expect(settings).not.toHaveProperty('skills');
    });

    it('preserves user-added skill paths after removing retired managed entries', async () => {
      const { updatePiSettings } = await import('../core/pi-runtime.js');
      const projectRoot = path.join(tempRoot, 'with-user-paths');
      await fs.ensureDir(path.join(projectRoot, '.pi'));
      await fs.ensureDir(path.join(projectRoot, '.xtrm', 'skills', 'user', 'packs', 'local-pack'));

      await fs.writeJson(path.join(projectRoot, '.pi', 'settings.json'), {
        skills: ['../.xtrm/skills/active', './my-custom-skills', '/abs/team-skills', '~/.xtrm/skills/default'],
      });

      await updatePiSettings(projectRoot, false);

      const settings = await fs.readJson(path.join(projectRoot, '.pi', 'settings.json'));
      expect(settings.skills).toEqual([
        './my-custom-skills',
        '/abs/team-skills',
      ]);
    });

    it('is idempotent — a second run does not duplicate the managed entries', async () => {
      const { updatePiSettings } = await import('../core/pi-runtime.js');
      const projectRoot = path.join(tempRoot, 'idempotent');
      await fs.ensureDir(projectRoot);

      await updatePiSettings(projectRoot, false);
      await updatePiSettings(projectRoot, false);

      const settings = await fs.readJson(path.join(projectRoot, '.pi', 'settings.json'));
      expect(settings).not.toHaveProperty('skills');
    });

    it('strips per-runtime suffix variants of legacy active/ path (xtrm-ec9um)', async () => {
      const { updatePiSettings } = await import('../core/pi-runtime.js');
      const projectRoot = path.join(tempRoot, 'suffix-variants');
      await fs.ensureDir(path.join(projectRoot, '.pi'));

      await fs.writeJson(path.join(projectRoot, '.pi', 'settings.json'), {
        skills: [
          '../.xtrm/skills/active/pi',
          '../.xtrm/skills/active/claude',
          '~/.xtrm/skills/active/pi',
          '~/.xtrm/skills/active/claude',
          './user-managed',
        ],
      });

      await updatePiSettings(projectRoot, false);

      const settings = await fs.readJson(path.join(projectRoot, '.pi', 'settings.json'));
      expect(settings.skills).toEqual(['./user-managed']);
    });

    it('does not write in dry-run mode', async () => {
      const { updatePiSettings } = await import('../core/pi-runtime.js');
      const projectRoot = path.join(tempRoot, 'dry-run');
      await fs.ensureDir(projectRoot);

      await updatePiSettings(projectRoot, true);

      expect(await fs.pathExists(path.join(projectRoot, '.pi', 'settings.json'))).toBe(false);
    });

    it('preserves user-owned Serena settings without creating new Serena configuration', async () => {
      const { updatePiSettings } = await import('../core/pi-runtime.js');
      const projectRoot = path.join(tempRoot, 'serena-user-settings');
      await fs.outputJson(path.join(projectRoot, '.pi', 'settings.json'), {
        serena: { blockedTools: ['custom_tool'], endpoint: 'http://127.0.0.1:9999' },
      });

      await updatePiSettings(projectRoot, false);
      const existing = await fs.readJson(path.join(projectRoot, '.pi', 'settings.json'));
      expect(existing.serena).toEqual({ blockedTools: ['custom_tool'], endpoint: 'http://127.0.0.1:9999' });

      const freshRoot = path.join(tempRoot, 'serena-fresh-settings');
      await updatePiSettings(freshRoot, false);
      const fresh = await fs.readJson(path.join(freshRoot, '.pi', 'settings.json'));
      expect(fresh).not.toHaveProperty('serena');
    });

    it('classifies managed pi-extensions entries by pure path/id shape (no fs I/O)', async () => {
    const { isManagedPiExtensionsPackageEntry } = await import('../core/pi-runtime.js');
    // Exact managed npm id.
    expect(isManagedPiExtensionsPackageEntry('npm:@jaggerxtrm/pi-extensions')).toBe(true);
    // Local source checkouts: relative, bare, and absolute — immediate parent
    // must be 'packages' (the repo layout), on any platform.
    expect(isManagedPiExtensionsPackageEntry('../../dev/core/packages/pi-extensions')).toBe(true);
    expect(isManagedPiExtensionsPackageEntry('packages/pi-extensions')).toBe(true);
    expect(isManagedPiExtensionsPackageEntry('./packages/pi-extensions')).toBe(true);
    expect(isManagedPiExtensionsPackageEntry('/abs/home/dev/core/packages/pi-extensions/')).toBe(true);
    expect(isManagedPiExtensionsPackageEntry('C:\\dev\\core\\packages\\pi-extensions')).toBe(true);
    // Bare scope-free identity: indistinguishable from a foreign package by
    // string alone, so it still counts (documented follow-up in pi-runtime).
    expect(isManagedPiExtensionsPackageEntry('pi-extensions')).toBe(true);
    // Remote refs and other packages never match.
    expect(isManagedPiExtensionsPackageEntry('npm:pi-gitnexus')).toBe(false);
    expect(isManagedPiExtensionsPackageEntry('git:github.com/x/pi-extensions')).toBe(false);
    expect(isManagedPiExtensionsPackageEntry('file:../packages/pi-extensions')).toBe(false);
    // 'packages' somewhere up the path is not the managed source layout.
    expect(isManagedPiExtensionsPackageEntry('a/packages/b/pi-extensions')).toBe(false);
    expect(isManagedPiExtensionsPackageEntry('other/vendor/pi-extensions')).toBe(false);
    expect(isManagedPiExtensionsPackageEntry('pi-extension')).toBe(false);
    expect(isManagedPiExtensionsPackageEntry('npm:@jaggerxtrm/pi-extensions-extra')).toBe(false);
  });

  it('does not register the npm package beside a local pi-extensions source path (xtrm-3ljgz.1)', async () => {
      const { updatePiSettings } = await import('../core/pi-runtime.js');
      const projectRoot = path.join(tempRoot, 'local-source');
      await fs.ensureDir(projectRoot);

      // The operator's global settings declare the local checkout of the same
      // managed package; the exactly-one-package invariant must treat it as
      // already satisfied instead of appending npm:@jaggerxtrm/pi-extensions.
      const globalSettingsPath = path.join(process.env.PI_AGENT_DIR as string, 'settings.json');
      await fs.outputJson(globalSettingsPath, {
        packages: ['npm:pi-gitnexus', '../../dev/core/packages/pi-extensions'],
      });

      await updatePiSettings(projectRoot, false);

      const globalSettings = await fs.readJson(globalSettingsPath);
      expect(globalSettings.packages).not.toContain('npm:@jaggerxtrm/pi-extensions');
      expect(globalSettings.packages).toEqual(['npm:pi-gitnexus', '../../dev/core/packages/pi-extensions']);
    });
  });
});
