import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { rmSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  hashFile,
  installFromRegistry,
  isSkillsDefaultPath,
  isUserOwnedPath,
  scaffoldSkillsDefaultFromPackage,
  stripXtrmPrefix,
  toPosix,
  toUserRelativePath,
} from '../core/registry-scaffold.js';
import { ensureAgentsSkillsSymlink, ensureUserAgentsSkillsSymlink } from '../core/skills-scaffold.js';

const tempDirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

async function createTempDir(): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xtrm-scaffold-test-'));
  tempDirs.push(tempDir);
  return tempDir;
}

async function writeSkill(root: string, name: string): Promise<void> {
  const skillRoot = path.join(root, name);
  await fs.ensureDir(skillRoot);
  await fs.writeFile(path.join(skillRoot, 'SKILL.md'), `# ${name}\n`, 'utf8');
}

describe('registry-scaffold path helpers', () => {
  it('toPosix converts windows-style separators to posix', () => {
    expect(toPosix('skills\\default\\README.md')).toBe('skills/default/README.md');
  });

  it('toPosix leaves already-posix paths unchanged', () => {
    expect(toPosix('skills/default/README.md')).toBe('skills/default/README.md');
  });

  it('stripXtrmPrefix strips .xtrm/foo/bar correctly', () => {
    expect(stripXtrmPrefix('.xtrm/foo/bar')).toBe('foo/bar');
  });

  it('stripXtrmPrefix strips .xtrm/ prefix exactly', () => {
    expect(stripXtrmPrefix('.xtrm/')).toBe('');
  });

  it('stripXtrmPrefix returns unchanged path when no .xtrm prefix is present', () => {
    expect(stripXtrmPrefix('hooks/post-tool-use.mjs')).toBe('hooks/post-tool-use.mjs');
  });

  it('toUserRelativePath joins sourceDir + filePath with posix separators', () => {
    expect(toUserRelativePath('.xtrm/skills/default', 'foo.md')).toBe('skills/default/foo.md');
  });

  it('toUserRelativePath strips .xtrm prefix before joining', () => {
    expect(toUserRelativePath('.xtrm/hooks', 'post-tool-use.mjs')).toBe('hooks/post-tool-use.mjs');
  });

  it('isSkillsDefaultPath returns true for skills/default paths', () => {
    expect(isSkillsDefaultPath('skills/default/README.md')).toBe(true);
  });

  it('isSkillsDefaultPath returns false for hooks paths', () => {
    expect(isSkillsDefaultPath('hooks/post-tool-use.mjs')).toBe(false);
  });

  it('isSkillsDefaultPath returns false for config paths', () => {
    expect(isSkillsDefaultPath('config/settings.json')).toBe(false);
  });

  it('isUserOwnedPath matches .xtrm/memory.md', () => {
    expect(isUserOwnedPath('memory.md')).toBe(true);
  });

  it('isUserOwnedPath matches files under .xtrm/skills/user/', () => {
    expect(isUserOwnedPath('skills/user/packs/local/PACK.json')).toBe(true);
  });

  it('isUserOwnedPath ignores non user-owned paths', () => {
    expect(isUserOwnedPath('skills/default/using-xtrm/SKILL.md')).toBe(false);
  });
});

describe('scaffoldSkillsDefaultFromPackage', () => {
  it('returns copy when targetDir does not exist', async () => {
    const tempDir = await createTempDir();
    const packageRoot = path.join(tempDir, 'pkg');
    const userXtrmDir = path.join(tempDir, 'user-xtrm');
    const sourceDir = path.join(packageRoot, '.xtrm', 'skills', 'default');
    const targetDir = path.join(userXtrmDir, 'skills', 'default');

    await fs.ensureDir(sourceDir);
    await fs.writeFile(path.join(sourceDir, 'README.md'), '# skill\n', 'utf8');

    const result = await scaffoldSkillsDefaultFromPackage({
      packageRoot,
      userXtrmDir,
      dryRun: false,
    });

    expect(result).toBe('copy');
    expect((await fs.lstat(targetDir)).isSymbolicLink()).toBe(false);
    expect(await fs.readFile(path.join(targetDir, 'README.md'), 'utf8')).toBe('# skill\n');
  });

  it('returns noop when targetDir already exists', async () => {
    const tempDir = await createTempDir();
    const packageRoot = path.join(tempDir, 'pkg');
    const userXtrmDir = path.join(tempDir, 'user-xtrm');
    const sourceDir = path.join(packageRoot, '.xtrm', 'skills', 'default');
    const targetDir = path.join(userXtrmDir, 'skills', 'default');

    await fs.ensureDir(sourceDir);
    await fs.ensureDir(targetDir);

    const result = await scaffoldSkillsDefaultFromPackage({
      packageRoot,
      userXtrmDir,
      dryRun: false,
    });

    expect(result).toBe('noop');
  });

  it('removes broken symlink and copies when targetDir is a broken symlink', async () => {
    const tempDir = await createTempDir();
    const packageRoot = path.join(tempDir, 'pkg');
    const userXtrmDir = path.join(tempDir, 'user-xtrm');
    const sourceDir = path.join(packageRoot, '.xtrm', 'skills', 'default');
    const targetDir = path.join(userXtrmDir, 'skills', 'default');

    await fs.ensureDir(sourceDir);
    await fs.writeFile(path.join(sourceDir, 'README.md'), '# skill\n', 'utf8');

    // create a broken symlink at targetDir
    await fs.ensureDir(path.dirname(targetDir));
    await fs.symlink('/nonexistent/path/that/does/not/exist', targetDir);
    expect((await fs.lstat(targetDir)).isSymbolicLink()).toBe(true);
    expect(await fs.pathExists(targetDir)).toBe(false);

    const result = await scaffoldSkillsDefaultFromPackage({
      packageRoot,
      userXtrmDir,
      dryRun: false,
    });

    expect(result).toBe('copy');
    expect(await fs.readFile(path.join(targetDir, 'README.md'), 'utf8')).toBe('# skill\n');
  });

  it('returns noop when targetDir points at the current package skills payload', async () => {
    const tempDir = await createTempDir();
    const packageRoot = path.join(tempDir, 'pkg');
    const userXtrmDir = path.join(tempDir, 'user-xtrm');
    const sourceDir = path.join(packageRoot, '.xtrm', 'skills', 'default');
    const targetDir = path.join(userXtrmDir, 'skills', 'default');

    await fs.ensureDir(sourceDir);
    await fs.ensureDir(path.dirname(targetDir));
    await fs.symlink(sourceDir, targetDir);

    const result = await scaffoldSkillsDefaultFromPackage({
      packageRoot,
      userXtrmDir,
      dryRun: false,
    });

    expect(result).toBe('noop');
    expect((await fs.lstat(targetDir)).isSymbolicLink()).toBe(true);
    expect(await fs.readlink(targetDir)).toBe(sourceDir);
  });

  it('replaces a stale but valid symlink with the current package payload', async () => {
    const tempDir = await createTempDir();
    const packageRoot = path.join(tempDir, 'pkg');
    const userXtrmDir = path.join(tempDir, 'user-xtrm');
    const sourceDir = path.join(packageRoot, '.xtrm', 'skills', 'default');
    const targetDir = path.join(userXtrmDir, 'skills', 'default');
    const staleDir = path.join(tempDir, 'old-dev-skills');

    await fs.ensureDir(sourceDir);
    await fs.writeFile(path.join(sourceDir, 'README.md'), '# current skill\n', 'utf8');
    await fs.ensureDir(staleDir);
    await fs.writeFile(path.join(staleDir, 'README.md'), '# stale skill\n', 'utf8');
    await fs.ensureDir(path.dirname(targetDir));
    await fs.symlink(staleDir, targetDir);

    const result = await scaffoldSkillsDefaultFromPackage({
      packageRoot,
      userXtrmDir,
      dryRun: false,
    });

    expect(result).toBe('copy');
    expect((await fs.lstat(targetDir)).isSymbolicLink()).toBe(false);
    expect(await fs.readFile(path.join(targetDir, 'README.md'), 'utf8')).toBe('# current skill\n');
    expect(await fs.readFile(path.join(staleDir, 'README.md'), 'utf8')).toBe('# stale skill\n');
  });

  it('returns noop in dry-run mode', async () => {
    const tempDir = await createTempDir();
    const packageRoot = path.join(tempDir, 'pkg');
    const userXtrmDir = path.join(tempDir, 'user-xtrm');
    const sourceDir = path.join(packageRoot, '.xtrm', 'skills', 'default');

    await fs.ensureDir(sourceDir);

    const result = await scaffoldSkillsDefaultFromPackage({
      packageRoot,
      userXtrmDir,
      dryRun: true,
    });

    expect(result).toBe('noop');
    expect(await fs.pathExists(path.join(userXtrmDir, 'skills', 'default'))).toBe(false);
  });

  it('under XTRM_GLOBAL_SKILLS is a noop when global tree already exists and does not eagerly scaffold user packs', async () => {
    const tempDir = await createTempDir();
    const packageRoot = path.join(tempDir, 'pkg');
    const userXtrmDir = path.join(tempDir, 'user-xtrm');
    const previousHome = process.env.HOME;
    const previousFlag = process.env.XTRM_GLOBAL_SKILLS;

    process.env.HOME = tempDir;
    process.env.XTRM_GLOBAL_SKILLS = '1';

    try {
      await fs.ensureDir(path.join(packageRoot, '.xtrm', 'skills', 'default'));
      await fs.ensureDir(path.join(tempDir, '.xtrm', 'skills', 'default'));
      await fs.ensureDir(path.join(tempDir, '.xtrm', 'skills', 'optional'));

      const result = await scaffoldSkillsDefaultFromPackage({
        packageRoot,
        userXtrmDir,
        dryRun: false,
      });

      expect(result).toBe('noop');
      expect(await fs.pathExists(path.join(userXtrmDir, 'skills', 'default'))).toBe(false);
      expect(await fs.pathExists(path.join(userXtrmDir, 'skills', 'user', 'packs'))).toBe(false);
    } finally {
      process.env.HOME = previousHome;
      process.env.XTRM_GLOBAL_SKILLS = previousFlag;
    }
  });
});

describe('installFromRegistry', () => {
  it('never installs user-owned paths from registry assets', async () => {
    const tempDir = await createTempDir();
    const packageRoot = path.join(tempDir, 'pkg');
    const userXtrmDir = path.join(tempDir, 'user-xtrm');

    const memorySource = path.join(packageRoot, '.xtrm', 'memory.md');
    const hookSource = path.join(packageRoot, '.xtrm', 'hooks', 'post-tool-use.mjs');

    await fs.ensureDir(path.dirname(memorySource));
    await fs.ensureDir(path.dirname(hookSource));
    await fs.writeFile(memorySource, 'generated memory\n', 'utf8');
    await fs.writeFile(hookSource, 'export default {}\n', 'utf8');

    const registry = {
      version: '1.0.0',
      assets: {
        core: {
          source_dir: '.xtrm',
          install_mode: 'copy' as const,
          files: {
            'memory.md': { hash: 'memory-hash', version: '1.0.0' },
            'hooks/post-tool-use.mjs': { hash: 'hook-hash', version: '1.0.0' },
          },
        },
      },
    };

    await fs.ensureDir(path.join(packageRoot, '.xtrm'));
    await fs.writeJson(path.join(packageRoot, '.xtrm', 'registry.json'), registry);

    const result = await installFromRegistry({
      packageRoot,
      registry,
      userXtrmDir,
      dryRun: false,
      force: true,
      yes: true,
    });

    expect(result.installed).toBe(1);
    expect(result.expectedInstalls).toBe(1);
    expect(result.missingSourceSkipped).toBe(0);
    expect(await fs.pathExists(path.join(userXtrmDir, 'hooks', 'post-tool-use.mjs'))).toBe(true);
    expect(await fs.pathExists(path.join(userXtrmDir, 'memory.md'))).toBe(false);
  });

  it('seeds registry.json into the target .xtrm/ (xtrm-ya2i)', async () => {
    const tempDir = await createTempDir();
    const packageRoot = path.join(tempDir, 'pkg');
    const userXtrmDir = path.join(tempDir, 'user-xtrm');

    const hookSource = path.join(packageRoot, '.xtrm', 'hooks', 'post-tool-use.mjs');
    await fs.ensureDir(path.dirname(hookSource));
    await fs.writeFile(hookSource, 'export default {}\n', 'utf8');

    const registry = {
      version: '1.0.0',
      assets: {
        core: {
          source_dir: '.xtrm',
          install_mode: 'copy' as const,
          files: {
            'hooks/post-tool-use.mjs': { hash: 'hook-hash', version: '1.0.0' },
          },
        },
        skills: {
          source_dir: '.xtrm/skills/default',
          install_mode: 'copy' as const,
          install_scope: 'global' as const,
          files: {
            'alpha/SKILL.md': { hash: 'skill-hash', version: '1.0.0' },
          },
        },
      },
    };

    await fs.ensureDir(path.join(packageRoot, '.xtrm'));
    await fs.writeJson(path.join(packageRoot, '.xtrm', 'registry.json'), registry);

    await installFromRegistry({
      packageRoot,
      registry,
      userXtrmDir,
      dryRun: false,
      force: true,
      yes: true,
    });

    const targetRegistryPath = path.join(userXtrmDir, 'registry.json');
    expect(await fs.pathExists(targetRegistryPath)).toBe(true);
    const written = await fs.readJson(targetRegistryPath);
    expect(written).toEqual(registry);

    const previousFlag = process.env.XTRM_GLOBAL_SKILLS;
    process.env.XTRM_GLOBAL_SKILLS = '1';
    try {
      await installFromRegistry({
        packageRoot,
        registry,
        userXtrmDir,
        dryRun: false,
        force: true,
        yes: true,
      });
      const filtered = await fs.readJson(targetRegistryPath);
      expect(filtered.assets.skills).toBeUndefined();
      expect(filtered.assets.core).toBeTruthy();
    } finally {
      process.env.XTRM_GLOBAL_SKILLS = previousFlag;
    }
  });

  it('skips registry.json snapshot in dry-run mode (xtrm-ya2i)', async () => {
    const tempDir = await createTempDir();
    const packageRoot = path.join(tempDir, 'pkg');
    const userXtrmDir = path.join(tempDir, 'user-xtrm');

    const hookSource = path.join(packageRoot, '.xtrm', 'hooks', 'post-tool-use.mjs');
    await fs.ensureDir(path.dirname(hookSource));
    await fs.writeFile(hookSource, 'export default {}\n', 'utf8');

    const registry = {
      version: '1.0.0',
      assets: {
        core: {
          source_dir: '.xtrm',
          install_mode: 'copy' as const,
          files: { 'hooks/post-tool-use.mjs': { hash: 'h', version: '1.0.0' } },
        },
      },
    };

    await fs.ensureDir(path.join(packageRoot, '.xtrm'));
    await fs.writeJson(path.join(packageRoot, '.xtrm', 'registry.json'), registry);

    await installFromRegistry({
      packageRoot,
      registry,
      userXtrmDir,
      dryRun: true,
      force: true,
      yes: true,
    });

    expect(await fs.pathExists(path.join(userXtrmDir, 'registry.json'))).toBe(false);
  });

  it('installs optional skills packs from registry assets', async () => {
    const tempDir = await createTempDir();
    const packageRoot = path.join(tempDir, 'pkg');
    const userXtrmDir = path.join(tempDir, 'user-xtrm');

    const packJsonSource = path.join(packageRoot, '.xtrm', 'skills', 'optional', 'pack-one', 'PACK.json');
    const skillSource = path.join(packageRoot, '.xtrm', 'skills', 'optional', 'pack-one', 'beta', 'SKILL.md');

    await fs.ensureDir(path.dirname(packJsonSource));
    await fs.ensureDir(path.dirname(skillSource));
    await fs.writeJson(packJsonSource, {
      schemaVersion: '1',
      name: 'pack-one',
      version: '1.0.0',
      description: 'pack',
      skills: ['beta'],
    });
    await fs.writeFile(skillSource, '# beta\n', 'utf8');

    const registry = {
      version: '1.0.0',
      assets: {
        skills_optional: {
          source_dir: '.xtrm/skills/optional',
          install_mode: 'copy' as const,
          files: {
            'pack-one/PACK.json': { hash: 'pack-hash', version: '1.0.0' },
            'pack-one/beta/SKILL.md': { hash: 'skill-hash', version: '1.0.0' },
          },
        },
      },
    };

    await fs.ensureDir(path.join(packageRoot, '.xtrm'));
    await fs.writeJson(path.join(packageRoot, '.xtrm', 'registry.json'), registry);

    const result = await installFromRegistry({
      packageRoot,
      registry,
      userXtrmDir,
      dryRun: false,
      force: true,
      yes: true,
    });

    expect(result.installed).toBe(2);
    expect(result.expectedInstalls).toBe(2);
    expect(result.missingSourceSkipped).toBe(0);
    expect(await fs.pathExists(path.join(userXtrmDir, 'skills', 'optional', 'pack-one', 'PACK.json'))).toBe(true);
    expect(await fs.pathExists(path.join(userXtrmDir, 'skills', 'optional', 'pack-one', 'beta', 'SKILL.md'))).toBe(true);
  });

  it('skips missing source files referenced by registry and continues installing others', async () => {
    const tempDir = await createTempDir();
    const packageRoot = path.join(tempDir, 'pkg');
    const userXtrmDir = path.join(tempDir, 'user-xtrm');

    const existingSource = path.join(packageRoot, '.xtrm', 'skills', 'default', 'alpha', 'SKILL.md');
    await fs.ensureDir(path.dirname(existingSource));
    await fs.writeFile(existingSource, '# alpha\n', 'utf8');

    const registry = {
      version: '1.0.0',
      assets: {
        skills_default: {
          source_dir: '.xtrm/skills/default',
          install_mode: 'copy' as const,
          files: {
            'alpha/SKILL.md': { hash: 'alpha-hash', version: '1.0.0' },
            'documenting/tests/integration_test.sh': { hash: 'missing-hash', version: '1.0.0' },
          },
        },
      },
    };

    await fs.ensureDir(path.join(packageRoot, '.xtrm'));
    await fs.writeJson(path.join(packageRoot, '.xtrm', 'registry.json'), registry);

    const result = await installFromRegistry({
      packageRoot,
      registry,
      userXtrmDir,
      dryRun: false,
      force: true,
      yes: true,
    });

    expect(result.installed).toBe(1);
    expect(result.expectedInstalls).toBe(2);
    expect(result.missingSourceSkipped).toBe(1);
    expect(await fs.pathExists(path.join(userXtrmDir, 'skills', 'default', 'alpha', 'SKILL.md'))).toBe(true);
    expect(await fs.pathExists(path.join(userXtrmDir, 'skills', 'default', 'documenting', 'tests', 'integration_test.sh'))).toBe(false);
  });

  it('fails in strict registry mode when a registry source file is missing', async () => {
    const tempDir = await createTempDir();
    const packageRoot = path.join(tempDir, 'pkg');
    const userXtrmDir = path.join(tempDir, 'user-xtrm');

    const existingSource = path.join(packageRoot, '.xtrm', 'skills', 'default', 'alpha', 'SKILL.md');
    await fs.ensureDir(path.dirname(existingSource));
    await fs.writeFile(existingSource, '# alpha\n', 'utf8');

    const registry = {
      version: '1.0.0',
      assets: {
        skills_default: {
          source_dir: '.xtrm/skills/default',
          install_mode: 'copy' as const,
          files: {
            'alpha/SKILL.md': { hash: 'alpha-hash', version: '1.0.0' },
            'documenting/tests/integration_test.sh': { hash: 'missing-hash', version: '1.0.0' },
          },
        },
      },
    };

    await fs.ensureDir(path.join(packageRoot, '.xtrm'));
    await fs.writeJson(path.join(packageRoot, '.xtrm', 'registry.json'), registry);

    await expect(installFromRegistry({
      packageRoot,
      registry,
      userXtrmDir,
      dryRun: false,
      force: true,
      yes: true,
      strictRegistry: true,
    })).rejects.toThrowError(/Registry\/source mismatch: missing package source files\./);
    await expect(fs.pathExists(path.join(userXtrmDir, 'skills', 'default', 'alpha', 'SKILL.md'))).resolves.toBe(true);
  });

  it('reads drifted override-root skills from global target paths', async () => {
    const tempDir = await createTempDir();
    const packageRoot = path.join(tempDir, 'pkg');
    const userXtrmDir = path.join(tempDir, 'user-xtrm');
    const globalSkillsRoot = path.join(tempDir, 'global-skills');
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const sourcePath = path.join(packageRoot, '.xtrm', 'skills', 'default', 'alpha', 'SKILL.md');
    const globalTargetPath = path.join(globalSkillsRoot, 'default', 'alpha', 'SKILL.md');
    await fs.ensureDir(path.dirname(sourcePath));
    await fs.ensureDir(path.dirname(globalTargetPath));
    await fs.writeFile(sourcePath, 'expected', 'utf8');
    await fs.writeFile(globalTargetPath, 'drifted', 'utf8');

    const registry = {
      version: '1.0.0',
      assets: {
        skills: {
          source_dir: '.xtrm/skills/default',
          install_mode: 'copy' as const,
          files: {
            'alpha/SKILL.md': { hash: await hashFile(sourcePath), version: '1.0.0' },
          },
        },
      },
    };

    await fs.ensureDir(path.join(packageRoot, '.xtrm'));
    await fs.writeJson(path.join(packageRoot, '.xtrm', 'registry.json'), registry);

    await installFromRegistry({
      packageRoot,
      registry,
      userXtrmDir,
      dryRun: false,
      force: false,
      yes: true,
      overrideRoots: {
        skills: path.join(globalSkillsRoot, 'default'),
      },
    });

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('skills/default/alpha/SKILL.md'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('actual '));
    expect(await fs.readFile(globalTargetPath, 'utf8')).toBe('drifted');
    consoleSpy.mockRestore();
  });

  it('routes global-scope skills assets to override roots and logs skip event when XTRM_GLOBAL_SKILLS=1', async () => {
    const tempDir = await createTempDir();
    const packageRoot = path.join(tempDir, 'pkg');
    const userXtrmDir = path.join(tempDir, 'user-xtrm');
    const globalSkillsRoot = path.join(tempDir, 'global-skills');
    const previousHome = process.env.HOME;
    const previousFlag = process.env.XTRM_GLOBAL_SKILLS;

    process.env.HOME = tempDir;
    process.env.XTRM_GLOBAL_SKILLS = '1';

    try {
      const sourcePath = path.join(packageRoot, '.xtrm', 'skills', 'default', 'alpha', 'SKILL.md');
      await fs.ensureDir(path.dirname(sourcePath));
      await fs.writeFile(sourcePath, '# alpha\n', 'utf8');

      const registry = {
        version: '1.0.0',
        assets: {
          skills: {
            source_dir: '.xtrm/skills/default',
            install_mode: 'copy' as const,
            install_scope: 'global' as const,
            files: {
              'alpha/SKILL.md': { hash: await hashFile(sourcePath), version: '1.0.0' },
            },
          },
        },
      };

      await fs.ensureDir(path.join(packageRoot, '.xtrm'));
      await fs.writeJson(path.join(packageRoot, '.xtrm', 'registry.json'), registry);

      await installFromRegistry({
        packageRoot,
        registry,
        userXtrmDir,
        dryRun: false,
        force: true,
        yes: true,
        overrideRoots: {
          skills: path.join(globalSkillsRoot, 'default'),
        },
      });

      expect(await fs.pathExists(path.join(globalSkillsRoot, 'default', 'alpha', 'SKILL.md'))).toBe(true);
      expect(await fs.pathExists(path.join(userXtrmDir, 'skills', 'default', 'alpha', 'SKILL.md'))).toBe(false);
      const logPath = path.join(tempDir, '.xtrm', 'logs', 'skills-migration.jsonl');
      const logLines = (await fs.readFile(logPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
      expect(logLines.some(line => line.event === 'install.skip.global-managed' && line.asset === 'skills' && line.count === 1)).toBe(true);
    } finally {
      process.env.HOME = previousHome;
      process.env.XTRM_GLOBAL_SKILLS = previousFlag;
    }
  });
});

describe('ensureUserAgentsSkillsSymlink', () => {
  const itIfSymlinkSupported = process.platform === 'win32' ? it.skip : it;

  itIfSymlinkSupported('wires home runtime pointers to global default skills', async () => {
    const tempHome = await createTempDir();
    const previousHome = process.env.HOME;
    process.env.HOME = tempHome;

    try {
      const globalDefaultRoot = path.join(tempHome, '.xtrm', 'skills', 'default');
      await writeSkill(globalDefaultRoot, 'alpha');

      await ensureUserAgentsSkillsSymlink();

      expect(await fs.readlink(path.join(tempHome, '.claude', 'skills'))).toBe(globalDefaultRoot);
      expect(await fs.readlink(path.join(tempHome, '.pi', 'agent', 'skills'))).toBe(globalDefaultRoot);
    } finally {
      process.env.HOME = previousHome;
    }
  });

  itIfSymlinkSupported('refuses to replace existing real home Claude skills directory without force', async () => {
    const tempHome = await createTempDir();
    const previousHome = process.env.HOME;
    process.env.HOME = tempHome;

    try {
      const globalDefaultRoot = path.join(tempHome, '.xtrm', 'skills', 'default');
      const claudeSkillsDir = path.join(tempHome, '.claude', 'skills');
      await writeSkill(globalDefaultRoot, 'alpha');
      await fs.ensureDir(claudeSkillsDir);
      await fs.writeFile(path.join(claudeSkillsDir, 'foreign.txt'), 'foreign', 'utf8');

      await expect(ensureUserAgentsSkillsSymlink()).rejects.toThrowError(/Refusing to replace existing ~\/\.claude\/skills/);
      expect((await fs.lstat(claudeSkillsDir)).isSymbolicLink()).toBe(false);
    } finally {
      process.env.HOME = previousHome;
    }
  });
});

describe('ensureAgentsSkillsSymlink', () => {
  const itIfSymlinkSupported = process.platform === 'win32' ? it.skip : it;

  async function setupProjectPack(tempDir: string): Promise<string> {
    const skillsRoot = path.join(tempDir, '.xtrm', 'skills');
    const packRoot = path.join(skillsRoot, 'optional', 'pack-one');
    await fs.ensureDir(packRoot);
    await fs.writeJson(path.join(packRoot, 'PACK.json'), {
      schemaVersion: '1', name: 'pack-one', version: '1.0.0', description: 'pack', skills: ['beta'],
    });
    await writeSkill(packRoot, 'beta');
    await fs.writeJson(path.join(skillsRoot, 'state.json'), {
      schemaVersion: '1', enabledPacks: { claude: ['pack-one'], pi: ['pack-one'] },
    });
    return path.join(packRoot, 'beta');
  }

  itIfSymlinkSupported('reconciles direct Claude and Pi skill links with managed manifest ownership', async () => {
    const tempDir = await createTempDir();
    const previousHome = process.env.HOME;
    process.env.HOME = path.join(tempDir, 'home');

    try {
      await writeSkill(path.join(process.env.HOME, '.xtrm', 'skills', 'default'), 'alpha');
      const betaRoot = await setupProjectPack(tempDir);

      const activation = await ensureAgentsSkillsSymlink(tempDir);

      expect(activation).toEqual({ activatedClaudeSkills: 1, activatedPiSkills: 1 });
      for (const runtime of ['.claude', '.pi']) {
        const runtimeSkills = path.join(tempDir, runtime, 'skills');
        expect((await fs.lstat(runtimeSkills)).isDirectory()).toBe(true);
        expect((await fs.lstat(path.join(runtimeSkills, 'beta'))).isSymbolicLink()).toBe(true);
        expect(await fs.readlink(path.join(runtimeSkills, 'beta'))).toBe(betaRoot);
      }
      const state = await fs.readJson(path.join(tempDir, '.xtrm', 'skills', 'state.json'));
      expect(state.managedLinks).toEqual({
        claude: { beta: '.xtrm/skills/optional/pack-one/beta' },
        pi: { beta: '.xtrm/skills/optional/pack-one/beta' },
      });
      expect(await fs.pathExists(path.join(tempDir, '.xtrm', 'skills', 'active'))).toBe(false);
      expect(await fs.pathExists(path.join(tempDir, '.pi', 'settings.json'))).toBe(false);
    } finally {
      process.env.HOME = previousHome;
    }
  });

  itIfSymlinkSupported('is idempotent without rebuilding retired active view', async () => {
    const tempDir = await createTempDir();
    const previousHome = process.env.HOME;
    process.env.HOME = path.join(tempDir, 'home');

    try {
      await writeSkill(path.join(process.env.HOME, '.xtrm', 'skills', 'default'), 'alpha');
      await setupProjectPack(tempDir);
      await ensureAgentsSkillsSymlink(tempDir);
      const claudeLink = path.join(tempDir, '.claude', 'skills', 'beta');
      const firstTarget = await fs.readlink(claudeLink);

      await ensureAgentsSkillsSymlink(tempDir);

      expect(await fs.readlink(claudeLink)).toBe(firstTarget);
      expect(await fs.pathExists(path.join(tempDir, '.xtrm', 'skills', 'active'))).toBe(false);
    } finally {
      process.env.HOME = previousHome;
    }
  });

  itIfSymlinkSupported('rejects same-name user-owned direct runtime entry', async () => {
    const tempDir = await createTempDir();
    const previousHome = process.env.HOME;
    process.env.HOME = path.join(tempDir, 'home');

    try {
      await writeSkill(path.join(process.env.HOME, '.xtrm', 'skills', 'default'), 'alpha');
      await setupProjectPack(tempDir);
      const userOwned = path.join(tempDir, '.claude', 'skills', 'beta');
      await fs.ensureDir(path.dirname(userOwned));
      await fs.writeFile(userOwned, 'user', 'utf8');

      await expect(ensureAgentsSkillsSymlink(tempDir)).rejects.toThrowError(/is user-owned/);
      expect(await fs.readFile(userOwned, 'utf8')).toBe('user');
    } finally {
      process.env.HOME = previousHome;
    }
  });
});
