import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { migrateSkillsLayout } from '../commands/migrate.js';
import { reconcileRuntimeLinks } from '../core/skills-runtime-reconcile.js';
import { readSkillsState } from '../core/skills-state.js';

const CLI_PATH = path.join(__dirname, '../../dist/index.cjs');

function runCli(args: string[], cwd?: string): { stdout: string; stderr: string; exitCode: number | null } {
  try {
    // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
    const result = execSync(`node ${CLI_PATH} ${args.join(' ')}`, {
      cwd,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return { stdout: result, stderr: '', exitCode: 0 };
  } catch (error: any) {
    return {
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? '',
      exitCode: error.status ?? 1,
    };
  }
}

const { resolvePackageRootMock } = vi.hoisted(() => ({ resolvePackageRootMock: vi.fn() }));
vi.mock('../core/registry-scaffold.js', () => ({
  resolvePackageRoot: resolvePackageRootMock,
}));

// xtrm-2d6fw: `xt migrate skills-layout` must adopt legacy v1 runtime-root
// symlinks (`.claude/skills`, `.pi/skills` → `<repo>/.xtrm/skills/default`)
// with a real directory, preserving foreign entries byte-for-byte, omitting
// registry-managed names so the normal update creates managed links, and
// failing closed on every uncertain shape (arbitrary/chained/dangling/
// non-directory/special-file targets, nested symlink chains).

let root: string;
let repoDir: string;
let packageRoot: string;
let previousHome: string;

async function writeRegistry(): Promise<void> {
  await fs.outputJson(path.join(packageRoot, '.xtrm', 'registry.json'), {
    version: '1',
    assets: {
      skills: {
        source_dir: '.xtrm/skills/default',
        install_mode: 'copy',
        install_scope: 'global',
        files: {
          'managed-a/SKILL.md': { hash: 'a', version: '1' },
          'managed-a/references/r.md': { hash: 'b', version: '1' },
          'managed-b/SKILL.md': { hash: 'c', version: '1' },
        },
      },
      skills_optional: {
        source_dir: '.xtrm/skills/optional',
        install_mode: 'copy',
        install_scope: 'global',
        files: { 'opt-pack/SKILL.md': { hash: 'd', version: '1' } },
      },
    },
  });
}

/** Legacy v1 repo: both runtime roots are symlinks to the project default tier. */
async function makeLegacyRepo(): Promise<string> {
  await fs.ensureDir(path.join(repoDir, '.xtrm', 'skills', 'default'));
  await fs.ensureDir(path.join(repoDir, '.claude'));
  await fs.ensureDir(path.join(repoDir, '.pi'));
  await fs.symlink('../.xtrm/skills/default', path.join(repoDir, '.claude', 'skills'));
  await fs.symlink('../.xtrm/skills/default', path.join(repoDir, '.pi', 'skills'));
  await fs.outputFile(path.join(repoDir, '.xtrm', 'skills', 'default', 'managed-a', 'SKILL.md'), 'managed-a body');
  await fs.outputFile(path.join(repoDir, '.xtrm', 'skills', 'default', 'managed-b', 'SKILL.md'), 'managed-b body');
  await fs.outputFile(path.join(repoDir, '.xtrm', 'skills', 'default', 'user-foreign.txt'), 'foreign bytes');
  return repoDir;
}

function backupDir(): string {
  return path.join(process.env.HOME!, '.xtrm', 'migration-backups');
}

async function runtimeBackups(): Promise<string[]> {
  if (!(await fs.pathExists(backupDir()))) return [];
  // xtrm-2d6fw: adoption snapshots use the adopt-runtime-* prefix (never
  // skills-*/hooks-*) so generic --restore cannot classify or extract them.
  return (await fs.readdir(backupDir())).filter((name) => name.startsWith('adopt-runtime-'));
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'xtrm-adopt-'));
  previousHome = process.env.HOME ?? '';
  process.env.HOME = path.join(root, 'home');
  await fs.ensureDir(process.env.HOME);
  repoDir = path.join(root, 'repo');
  await fs.ensureDir(repoDir);
  packageRoot = path.join(root, 'package-root');
  await fs.ensureDir(packageRoot);
  await writeRegistry();
  resolvePackageRootMock.mockReturnValue(packageRoot);
});

afterEach(async () => {
  resolvePackageRootMock.mockReset();
  process.env.HOME = previousHome;
  await fs.remove(root);
});

describe('skills-layout legacy runtime-root adoption (xtrm-2d6fw)', () => {
  it('dry-run previews conversion without mutating runtime roots or target', async () => {
    await makeLegacyRepo();

    await migrateSkillsLayout(repoDir, { dryRun: true });

    expect((await fs.lstat(path.join(repoDir, '.claude', 'skills'))).isSymbolicLink()).toBe(true);
    expect((await fs.lstat(path.join(repoDir, '.pi', 'skills'))).isSymbolicLink()).toBe(true);
    expect(await fs.readFile(path.join(repoDir, '.xtrm', 'skills', 'default', 'user-foreign.txt'), 'utf8')).toBe('foreign bytes');
    expect(await runtimeBackups()).toEqual([]);
  });

  it('converts both legacy symlinks to real dirs: omits registry-managed names, preserves foreign entries byte-for-byte, target untouched, 0600 backup', async () => {
    await makeLegacyRepo();

    await migrateSkillsLayout(repoDir, { dryRun: false, apply: true });

    for (const runtimeRel of ['.claude/skills', '.pi/skills']) {
      const runtimeDir = path.join(repoDir, runtimeRel);
      expect((await fs.lstat(runtimeDir)).isDirectory()).toBe(true);
      expect(await fs.pathExists(path.join(runtimeDir, 'managed-a'))).toBe(false);
      expect(await fs.pathExists(path.join(runtimeDir, 'managed-b'))).toBe(false);
      expect(await fs.pathExists(path.join(runtimeDir, 'opt-pack'))).toBe(false);
      expect(await fs.readFile(path.join(runtimeDir, 'user-foreign.txt'), 'utf8')).toBe('foreign bytes');
    }
    // Legacy target stays untouched.
    expect(await fs.readFile(path.join(repoDir, '.xtrm', 'skills', 'default', 'managed-a', 'SKILL.md'), 'utf8')).toBe('managed-a body');
    expect(await fs.readFile(path.join(repoDir, '.xtrm', 'skills', 'default', 'user-foreign.txt'), 'utf8')).toBe('foreign bytes');

    // One 0600 tarball backup of the target.
    const backups = await runtimeBackups();
    expect(backups).toHaveLength(1);
    const mode = (await fs.stat(path.join(backupDir(), backups[0]))).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('leaves a real-directory runtime root untouched while converting the symlink root', async () => {
    await makeLegacyRepo();
    await fs.remove(path.join(repoDir, '.claude', 'skills'));
    await fs.ensureDir(path.join(repoDir, '.claude', 'skills'));
    await fs.writeFile(path.join(repoDir, '.claude', 'skills', 'user-note.txt'), 'keep me');

    await migrateSkillsLayout(repoDir, { dryRun: false, apply: true });

    expect((await fs.lstat(path.join(repoDir, '.claude', 'skills'))).isDirectory()).toBe(true);
    expect(await fs.readFile(path.join(repoDir, '.claude', 'skills', 'user-note.txt'), 'utf8')).toBe('keep me');
    const piDir = path.join(repoDir, '.pi', 'skills');
    expect((await fs.lstat(piDir)).isDirectory()).toBe(true);
    expect(await fs.pathExists(path.join(piDir, 'managed-a'))).toBe(false);
    expect(await fs.readFile(path.join(piDir, 'user-foreign.txt'), 'utf8')).toBe('foreign bytes');
  });

  it('refuses an arbitrary user symlink target before any mutation of the other root', async () => {
    await makeLegacyRepo();
    await fs.remove(path.join(repoDir, '.pi', 'skills'));
    const userTarget = path.join(root, 'user-skills');
    await fs.ensureDir(userTarget);
    await fs.symlink(userTarget, path.join(repoDir, '.pi', 'skills'));

    await expect(migrateSkillsLayout(repoDir, { dryRun: false, apply: true })).rejects.toThrow(/user symlink/);

    expect((await fs.lstat(path.join(repoDir, '.claude', 'skills'))).isSymbolicLink()).toBe(true);
    expect(await fs.readlink(path.join(repoDir, '.pi', 'skills'))).toBe(userTarget);
    expect(await runtimeBackups()).toEqual([]);
  });

  it('refuses a non-directory runtime root (file) before any mutation', async () => {
    await makeLegacyRepo();
    await fs.remove(path.join(repoDir, '.pi', 'skills'));
    await fs.writeFile(path.join(repoDir, '.pi', 'skills'), 'not a dir');

    await expect(migrateSkillsLayout(repoDir, { dryRun: false, apply: true })).rejects.toThrow(/not a directory or symlink/);
    expect((await fs.lstat(path.join(repoDir, '.claude', 'skills'))).isSymbolicLink()).toBe(true);
  });

  it('refuses a chained target (nested symlink in the legacy root path)', async () => {
    const external = path.join(root, 'external-xtrm');
    await fs.ensureDir(path.join(external, 'skills', 'default'));
    await fs.remove(path.join(repoDir, '.xtrm'));
    await fs.symlink(external, path.join(repoDir, '.xtrm'));
    await fs.ensureDir(path.join(repoDir, '.claude'));
    await fs.symlink('../.xtrm/skills/default', path.join(repoDir, '.claude', 'skills'));

    await expect(migrateSkillsLayout(repoDir, { dryRun: false, apply: true })).rejects.toThrow(/not a real directory/);
    expect((await fs.lstat(path.join(repoDir, '.claude', 'skills'))).isSymbolicLink()).toBe(true);
    expect(await runtimeBackups()).toEqual([]);
  });

  it('refuses a dangling target (legacy default tier missing)', async () => {
    await makeLegacyRepo();
    await fs.remove(path.join(repoDir, '.xtrm', 'skills', 'default'));

    await expect(migrateSkillsLayout(repoDir, { dryRun: false, apply: true })).rejects.toThrow(/not a real directory/);
    expect((await fs.lstat(path.join(repoDir, '.claude', 'skills'))).isSymbolicLink()).toBe(true);
  });

  it('refuses a non-directory target (default tier is a regular file)', async () => {
    await makeLegacyRepo();
    await fs.remove(path.join(repoDir, '.xtrm', 'skills', 'default'));
    await fs.writeFile(path.join(repoDir, '.xtrm', 'skills', 'default'), 'file');

    await expect(migrateSkillsLayout(repoDir, { dryRun: false, apply: true })).rejects.toThrow(/not a real directory/);
    expect((await fs.lstat(path.join(repoDir, '.claude', 'skills'))).isSymbolicLink()).toBe(true);
  });

  it('refuses a special-file target (fifo)', async () => {
    await makeLegacyRepo();
    await fs.remove(path.join(repoDir, '.xtrm', 'skills', 'default'));
    execSync(`mkfifo '${path.join(repoDir, '.xtrm', 'skills', 'default')}'`);

    await expect(migrateSkillsLayout(repoDir, { dryRun: false, apply: true })).rejects.toThrow(/not a real directory/);
    expect((await fs.lstat(path.join(repoDir, '.claude', 'skills'))).isSymbolicLink()).toBe(true);
  });

  it('refuses a special-file direct entry inside the legacy target', async () => {
    await makeLegacyRepo();
    execSync(`mkfifo '${path.join(repoDir, '.xtrm', 'skills', 'default', 'weird-fifo')}'`);

    await expect(migrateSkillsLayout(repoDir, { dryRun: false, apply: true })).rejects.toThrow(/special file/);
    expect((await fs.lstat(path.join(repoDir, '.claude', 'skills'))).isSymbolicLink()).toBe(true);
    expect(await runtimeBackups()).toEqual([]);
  });

  it('rolls the original symlink back when the swap fails', async () => {
    await makeLegacyRepo();
    const originalRename = fs.rename.bind(fs);
    const renameSpy = vi.spyOn(fs, 'rename')
      .mockImplementationOnce(originalRename as typeof fs.rename)
      .mockRejectedValueOnce(new Error('swap failed'))
      .mockImplementationOnce(originalRename as typeof fs.rename);
    try {
      await expect(migrateSkillsLayout(repoDir, { dryRun: false, apply: true })).rejects.toThrow('swap failed');

      const stat = await fs.lstat(path.join(repoDir, '.claude', 'skills'));
      expect(stat.isSymbolicLink()).toBe(true);
      expect(await fs.readlink(path.join(repoDir, '.claude', 'skills'))).toBe('../.xtrm/skills/default');
      expect((await fs.readdir(repoDir)).filter((name) => name.includes('.migrate-'))).toEqual([]);
    } finally {
      renameSpy.mockRestore();
    }
  });

  it('rerun is idempotent and creates no duplicate backup', async () => {
    await makeLegacyRepo();
    await migrateSkillsLayout(repoDir, { dryRun: false, apply: true });
    const afterFirst = await runtimeBackups();
    expect(afterFirst).toHaveLength(1);

    await migrateSkillsLayout(repoDir, { dryRun: false, apply: true });

    expect(await runtimeBackups()).toEqual(afterFirst);
    expect((await fs.lstat(path.join(repoDir, '.claude', 'skills'))).isDirectory()).toBe(true);
  });

  it('subsequent reconciliation creates managed links for enabled pack skills and writes v2 ownership', async () => {
    await makeLegacyRepo();
    await migrateSkillsLayout(repoDir, { dryRun: false, apply: true });

    // v2 reconcile links ENABLED PACK skills into the runtime dir, not the
    // default-tier names (those live at user scope). The operator has the
    // registry-managed optional pack 'opt-pack' enabled in state.
    const packPath = path.join(repoDir, '.xtrm', 'skills', 'opt-pack');
    await fs.outputFile(path.join(packPath, 'PACK.json'), JSON.stringify({ name: 'opt-pack', skills: [] }));
    await fs.outputFile(path.join(packPath, 'opt-skill', 'SKILL.md'), '---\nname: opt-skill\n---\n');

    const state = await readSkillsState(path.join(repoDir, '.xtrm', 'skills'));
    state.enabledPacks.claude = ['opt-pack'];
    const result = await reconcileRuntimeLinks({
      projectRoot: repoDir,
      state,
      runtime: 'claude',
      discoveredPacks: [{
        name: 'opt-pack',
        path: packPath,
        tier: 'user',
        skills: [{ name: 'opt-skill', runtimeName: 'opt-skill', path: path.join(packPath, 'opt-skill') }],
      }],
      globalDefaultRoot: path.join(process.env.HOME!, '.xtrm', 'skills', 'default'),
      globalOptionalRoot: path.join(process.env.HOME!, '.xtrm', 'skills', 'optional'),
    });

    const link = path.join(repoDir, '.claude', 'skills', 'opt-skill');
    expect((await fs.lstat(link)).isSymbolicLink()).toBe(true);
    expect(await fs.readlink(link)).toBe(path.join(packPath, 'opt-skill'));
    expect(result.state.managedLinks.claude).toEqual({
      'opt-skill': path.relative(repoDir, path.join(packPath, 'opt-skill')),
    });
    // Registry-managed default-tier names were omitted by migration and stay
    // absent; the foreign entry is untouched by reconcile.
    expect(await fs.pathExists(path.join(repoDir, '.claude', 'skills', 'managed-a'))).toBe(false);
    expect(await fs.readFile(path.join(repoDir, '.claude', 'skills', 'user-foreign.txt'), 'utf8')).toBe('foreign bytes');
  });

  it('--restore refuses a runtime-adoption backup before extraction (xtrm-2d6fw)', async () => {
    await makeLegacyRepo();
    await migrateSkillsLayout(repoDir, { dryRun: false, apply: true });

    const backups = await runtimeBackups();
    expect(backups).toHaveLength(1);
    const backupPath = path.join(backupDir(), backups[0]);

    // --force is the strongest probe: with the old 'skills-runtime-*' name the
    // restore classified this as a normal skills backup, deleted .xtrm/skills,
    // and extracted its 'default/...' archive layout into .xtrm/default. The
    // adopt-runtime-* prefix must refuse before any extraction or deletion.
    const result = runCli(['migrate', 'all', '--apply', '--force', '--restore', backupPath, '--repo', repoDir], repoDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Cannot restore runtime-adoption backup');
    // No wrong-location writes and no destination mutation.
    expect(await fs.pathExists(path.join(repoDir, '.xtrm', 'default'))).toBe(false);
    expect(await fs.pathExists(path.join(repoDir, '.xtrm', 'skills'))).toBe(true);
    expect(await fs.readFile(path.join(repoDir, '.xtrm', 'skills', 'default', 'user-foreign.txt'), 'utf8')).toBe('foreign bytes');
    expect((await fs.lstat(path.join(repoDir, '.claude', 'skills'))).isDirectory()).toBe(true);
    expect(await fs.readFile(path.join(repoDir, '.claude', 'skills', 'user-foreign.txt'), 'utf8')).toBe('foreign bytes');
  });

  it('second-root swap failure leaves first root adopted, second rolled back; rerun completes (xtrm-2d6fw)', async () => {
    await makeLegacyRepo();
    const originalRename = fs.rename.bind(fs);
    // .claude swap: rename(old1) ok, rename(temp1) ok, old1 removed via rimraf.
    // .pi swap: rename(old2) ok, rename(temp2) FAILS, rollback rename(old2) ok.
    const renameSpy = vi.spyOn(fs, 'rename')
      .mockImplementationOnce(originalRename as typeof fs.rename)
      .mockImplementationOnce(originalRename as typeof fs.rename)
      .mockImplementationOnce(originalRename as typeof fs.rename)
      .mockRejectedValueOnce(new Error('swap failed'))
      .mockImplementationOnce(originalRename as typeof fs.rename);
    try {
      await expect(migrateSkillsLayout(repoDir, { dryRun: false, apply: true })).rejects.toThrow('swap failed');

      // First root stays consistently adopted; second rolled back to its symlink.
      expect((await fs.lstat(path.join(repoDir, '.claude', 'skills'))).isDirectory()).toBe(true);
      expect(await fs.readFile(path.join(repoDir, '.claude', 'skills', 'user-foreign.txt'), 'utf8')).toBe('foreign bytes');
      const piLink = path.join(repoDir, '.pi', 'skills');
      expect((await fs.lstat(piLink)).isSymbolicLink()).toBe(true);
      expect(await fs.readlink(piLink)).toBe('../.xtrm/skills/default');
      expect((await fs.readdir(repoDir)).filter((name) => name.includes('.migrate-'))).toEqual([]);
    } finally {
      renameSpy.mockRestore();
    }

    // Rerun adopts the remaining legacy root and completes.
    await migrateSkillsLayout(repoDir, { dryRun: false, apply: true });
    expect((await fs.lstat(path.join(repoDir, '.pi', 'skills'))).isDirectory()).toBe(true);
  });

  it('refuses to adopt when the registry is unreadable', async () => {
    await makeLegacyRepo();
    await fs.remove(path.join(packageRoot, '.xtrm', 'registry.json'));

    await expect(migrateSkillsLayout(repoDir, { dryRun: false, apply: true })).rejects.toThrow(/ENOENT|Failed to locate package root/);
    expect((await fs.lstat(path.join(repoDir, '.claude', 'skills'))).isSymbolicLink()).toBe(true);
  });

});
