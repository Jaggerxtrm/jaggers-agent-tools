import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkDrift } from '../core/drift.js';

interface RegistryFileEntry {
  hash: string;
  version: string;
}

interface RegistryAsset {
  source_dir: string;
  install_mode: 'copy' | 'symlink';
  files: Record<string, RegistryFileEntry>;
}

interface RegistryManifest {
  version: string;
  assets: Record<string, RegistryAsset>;
}

interface DriftReport {
  missing: string[];
  upToDate: string[];
  drifted: string[];
}

interface DriftTestCase {
  name: string;
  setup: (tempDir: string) => Promise<{ registryPath: string; userXtrmDir: string }>;
  expected: DriftReport;
}

const EMPTY_FILE_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const tempDirs: string[] = [];

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

async function createTempDir(): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xtrm-drift-test-'));
  tempDirs.push(tempDir);
  return tempDir;
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function writeRegistry(tempDir: string, manifest: RegistryManifest): Promise<string> {
  const registryPath = path.join(tempDir, 'registry.json');
  await fs.writeFile(registryPath, JSON.stringify(manifest, null, 2), 'utf8');
  return registryPath;
}

const driftCases: DriftTestCase[] = [
  {
    name: 'matching/missing/drifted classification',
    setup: async (tempDir) => {
      const userXtrmDir = path.join(tempDir, '.xtrm-user');
      await fs.mkdir(path.join(userXtrmDir, 'hooks'), { recursive: true });
      await fs.writeFile(path.join(userXtrmDir, 'hooks', 'match.mjs'), 'match-content', 'utf8');
      await fs.writeFile(path.join(userXtrmDir, 'hooks', 'drift.mjs'), 'user-modified', 'utf8');

      const registryPath = await writeRegistry(tempDir, {
        version: '1',
        assets: {
          hooks: {
            source_dir: '.xtrm/hooks',
            install_mode: 'copy',
            files: {
              'match.mjs': { hash: sha256('match-content'), version: '0.7.0' },
              'missing.mjs': { hash: sha256('missing-content'), version: '0.7.0' },
              'drift.mjs': { hash: sha256('expected-content'), version: '0.7.0' },
            },
          },
        },
      });

      return { registryPath, userXtrmDir };
    },
    expected: {
      upToDate: ['hooks/match.mjs'],
      missing: ['hooks/missing.mjs'],
      drifted: ['hooks/drift.mjs'],
    },
  },
  {
    name: 'empty registry',
    setup: async (tempDir) => {
      const registryPath = await writeRegistry(tempDir, { version: '1', assets: {} });
      return { registryPath, userXtrmDir: path.join(tempDir, '.xtrm-user') };
    },
    expected: { missing: [], upToDate: [], drifted: [] },
  },
  {
    name: 'missing user .xtrm directory',
    setup: async (tempDir) => {
      const registryPath = await writeRegistry(tempDir, {
        version: '1',
        assets: {
          hooks: {
            source_dir: '.xtrm/hooks',
            install_mode: 'copy',
            files: {
              'a.mjs': { hash: sha256('a'), version: '0.7.0' },
              'b.mjs': { hash: sha256('b'), version: '0.7.0' },
            },
          },
        },
      });

      return { registryPath, userXtrmDir: path.join(tempDir, 'does-not-exist') };
    },
    expected: {
      missing: ['hooks/a.mjs', 'hooks/b.mjs'],
      upToDate: [],
      drifted: [],
    },
  },
];

describe('checkDrift', () => {
  describe.each(driftCases)('checkDrift: $name', ({ setup, expected }) => {
    it('returns expected buckets', async () => {
      const tempDir = await createTempDir();
      const { registryPath, userXtrmDir } = await setup(tempDir);

      const report = await checkDrift(registryPath, userXtrmDir);
      expect(report).toEqual(expected);
    });
  });

  it('places each registry file in exactly one report bucket', async () => {
    const tempDir = await createTempDir();
    const userXtrmDir = path.join(tempDir, '.xtrm-user');
    await fs.mkdir(path.join(userXtrmDir, 'hooks'), { recursive: true });

    await fs.writeFile(path.join(userXtrmDir, 'hooks', 'same-1.mjs'), 'same', 'utf8');
    await fs.writeFile(path.join(userXtrmDir, 'hooks', 'same-2.mjs'), 'same', 'utf8');
    await fs.writeFile(path.join(userXtrmDir, 'hooks', 'changed.mjs'), 'changed', 'utf8');

    const manifest: RegistryManifest = {
      version: '1',
      assets: {
        hooks: {
          source_dir: '.xtrm/hooks',
          install_mode: 'copy',
          files: {
            'same-1.mjs': { hash: sha256('same'), version: '0.7.0' },
            'same-2.mjs': { hash: sha256('same'), version: '0.7.0' },
            'empty.mjs': { hash: EMPTY_FILE_SHA256, version: '0.7.0' },
            'changed.mjs': { hash: sha256('expected'), version: '0.7.0' },
          },
        },
      },
    };

    await fs.writeFile(path.join(userXtrmDir, 'hooks', 'empty.mjs'), '', 'utf8');

    const registryPath = await writeRegistry(tempDir, manifest);
    const report = await checkDrift(registryPath, userXtrmDir);

    const allClassified = [...report.missing, ...report.upToDate, ...report.drifted];
    const uniqueClassified = new Set(allClassified);
    const expectedFiles = new Set(['hooks/same-1.mjs', 'hooks/same-2.mjs', 'hooks/empty.mjs', 'hooks/changed.mjs']);

    expect(report.upToDate).toContain('hooks/same-1.mjs');
    expect(report.upToDate).toContain('hooks/same-2.mjs');
    expect(report.upToDate).toContain('hooks/empty.mjs');
    expect(report.drifted).toContain('hooks/changed.mjs');
    expect(report.missing).toEqual([]);
    expect(uniqueClassified).toEqual(expectedFiles);
    expect(allClassified.length).toBe(uniqueClassified.size);
  });

  const itIfSymlinkSupported = process.platform === 'win32' ? it.skip : it;

  it('supports override roots for global skills assets', async () => {
    const tempDir = await createTempDir();
    const userXtrmDir = path.join(tempDir, '.xtrm-user');
    const globalSkillsRoot = path.join(tempDir, '.xtrm-global', 'skills');
    await fs.mkdir(path.join(globalSkillsRoot, 'default', 'alpha'), { recursive: true });
    await fs.mkdir(path.join(globalSkillsRoot, 'optional', 'beta'), { recursive: true });
    await fs.writeFile(path.join(globalSkillsRoot, 'default', 'alpha', 'SKILL.md'), 'alpha', 'utf8');
    await fs.writeFile(path.join(globalSkillsRoot, 'optional', 'beta', 'SKILL.md'), 'beta', 'utf8');

    const registryPath = await writeRegistry(tempDir, {
      version: '1',
      assets: {
        skills: {
          source_dir: '.xtrm/skills/default',
          install_mode: 'copy',
          files: {
            'alpha/SKILL.md': { hash: sha256('alpha'), version: '0.9.1' },
          },
        },
        skills_optional: {
          source_dir: '.xtrm/skills/optional',
          install_mode: 'copy',
          files: {
            'beta/SKILL.md': { hash: sha256('beta'), version: '0.9.1' },
          },
        },
      },
    });

    const report = await checkDrift(registryPath, userXtrmDir, {
      skills: path.join(globalSkillsRoot, 'default'),
      skills_optional: path.join(globalSkillsRoot, 'optional'),
    });

    expect(report).toEqual({
      missing: [],
      upToDate: ['skills/default/alpha/SKILL.md', 'skills/optional/beta/SKILL.md'],
      drifted: [],
    });
  });

  itIfSymlinkSupported('hashes symlink targets by file content', async () => {
    const tempDir = await createTempDir();
    const userXtrmDir = path.join(tempDir, '.xtrm-user');
    const hooksDir = path.join(userXtrmDir, 'hooks');
    const sourceDir = path.join(tempDir, 'source');

    await fs.mkdir(hooksDir, { recursive: true });
    await fs.mkdir(sourceDir, { recursive: true });

    const targetPath = path.join(sourceDir, 'target.mjs');
    const linkPath = path.join(hooksDir, 'link.mjs');
    const targetContent = 'symlink-target-content';

    await fs.writeFile(targetPath, targetContent, 'utf8');
    await fs.symlink(targetPath, linkPath);

    const registryPath = await writeRegistry(tempDir, {
      version: '1',
      assets: {
        hooks: {
          source_dir: '.xtrm/hooks',
          install_mode: 'copy',
          files: {
            'link.mjs': { hash: sha256(targetContent), version: '0.7.0' },
          },
        },
      },
    });

    const report = await checkDrift(registryPath, userXtrmDir);
    expect(report).toEqual({ missing: [], upToDate: ['hooks/link.mjs'], drifted: [] });
  });
});
