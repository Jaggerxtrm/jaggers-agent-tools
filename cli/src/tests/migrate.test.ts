import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execSync } from 'child_process';
import { migrateSkillsLayout } from '../commands/migrate.js';

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

async function createTempDir(): Promise<string> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xtrm-migrate-test-'));
  return tmpDir;
}

async function createFakeRepo(baseDir: string): Promise<string> {
  const repoDir = path.join(baseDir, 'test-repo');
  await fs.ensureDir(repoDir);
  await fs.writeJson(path.join(repoDir, 'package.json'), { name: 'test-repo', version: '1.0.0' });
  await fs.ensureDir(path.join(repoDir, '.xtrm', 'skills', 'default'));
  await fs.ensureDir(path.join(repoDir, '.xtrm', 'skills', 'optional'));
  await fs.ensureDir(path.join(repoDir, '.xtrm', 'hooks'));
  await fs.writeJson(path.join(repoDir, '.xtrm', 'skills', 'state.json'), { schemaVersion: '1', enabledPacks: { claude: [], pi: [] } });
  await fs.writeFile(path.join(repoDir, '.xtrm', 'skills', 'default', 'test-skill.md'), 'test skill content');
  await fs.writeFile(path.join(repoDir, '.xtrm', 'skills', 'optional', 'optional-skill.md'), 'optional skill content');
  await fs.writeFile(path.join(repoDir, '.xtrm', 'hooks', 'test-hook.mjs'), 'console.log("test hook");');
  return repoDir;
}

async function createGlobalSkillsRoot(baseDir: string): Promise<string> {
  const globalSkillsRoot = path.join(baseDir, '.xtrm', 'skills');
  await fs.ensureDir(path.join(globalSkillsRoot, 'default'));
  await fs.ensureDir(path.join(globalSkillsRoot, 'optional'));
  await fs.writeFile(path.join(globalSkillsRoot, 'default', 'test-skill.md'), 'test skill content');
  await fs.writeFile(path.join(globalSkillsRoot, 'optional', 'optional-skill.md'), 'optional skill content');
  await fs.writeJson(path.join(globalSkillsRoot, 'state.json'), { schemaVersion: '1', enabledPacks: { claude: [], pi: [] } });
  return globalSkillsRoot;
}

async function createGlobalHooksRoot(baseDir: string): Promise<string> {
  const globalHooksRoot = path.join(baseDir, '.xtrm', 'hooks');
  await fs.ensureDir(globalHooksRoot);
  await fs.writeFile(path.join(globalHooksRoot, 'test-hook.mjs'), 'console.log("test hook");');
  return globalHooksRoot;
}

function mockEnv(): { cleanup: () => void } {
  const originalHome = process.env.HOME;
  const originalCwd = process.cwd();
  return {
    cleanup: () => {
      process.env.HOME = originalHome;
      process.chdir(originalCwd);
    },
  };
}

describe('xt migrate command', () => {
  let tmpHome: string;
  let envMock: { cleanup: () => void };

  beforeEach(async () => {
    tmpHome = await createTempDir();
    envMock = mockEnv();
    process.env.HOME = tmpHome;
  });

  afterEach(async () => {
    envMock.cleanup();
    await fs.remove(tmpHome);
  });

  it('shows help when run without arguments', () => {
    const result = runCli(['migrate', '--help']);
    expect(result.stdout).toContain('One-time per-repo cleanup');
    expect(result.stdout).toContain('skills | hooks | all');
  });

  it('rejects invalid target', () => {
    const result = runCli(['migrate', 'invalid']);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Invalid target');
  });

  it('preserves pack metadata when legacy pack rename fails', async () => {
    const repoDir = await createFakeRepo(tmpHome);
    const source = path.join(repoDir, '.xtrm', 'skills', 'user', 'packs', 'legacy-pack');
    const packMetadata = { schemaVersion: '1', name: 'legacy-pack', version: '1.0.0' };
    await fs.ensureDir(source);
    await fs.writeJson(path.join(source, 'PACK.json'), packMetadata);

    const renameSpy = vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('rename failed'));
    try {
      await expect(migrateSkillsLayout(repoDir, { dryRun: false })).rejects.toThrow('rename failed');
      expect(await fs.readJson(path.join(source, 'PACK.json'))).toEqual(packMetadata);
      expect(await fs.pathExists(path.join(repoDir, '.xtrm', 'skills', 'legacy-pack'))).toBe(false);
    } finally {
      renameSpy.mockRestore();
    }

    await migrateSkillsLayout(repoDir, { dryRun: false });
    const target = path.join(repoDir, '.xtrm', 'skills', 'legacy-pack');
    expect(await fs.pathExists(path.join(target, 'PACK.json'))).toBe(false);
    expect(await fs.pathExists(path.join(source, 'PACK.json'))).toBe(false);
  });

  it('dry-run mode prints planned actions without touching filesystem', async () => {
    const repoDir = await createFakeRepo(tmpHome);
    await createGlobalSkillsRoot(tmpHome);
    await createGlobalHooksRoot(tmpHome);

    const result = runCli(['migrate', 'all', '--dry-run', '--repo', repoDir], repoDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('would remove');
    expect(result.stdout).toContain('.xtrm/skills/default');
    expect(result.stdout).toContain('.xtrm/skills/optional');
    expect(result.stdout).toContain('.xtrm/hooks');

    const defaultTierExists = await fs.pathExists(path.join(repoDir, '.xtrm', 'skills', 'default'));
    const hooksExists = await fs.pathExists(path.join(repoDir, '.xtrm', 'hooks'));
    expect(defaultTierExists).toBe(true);
    expect(hooksExists).toBe(true);
  });

  it('apply mode creates backup and removes per-repo skills', async () => {
    const repoDir = await createFakeRepo(tmpHome);
    await createGlobalSkillsRoot(tmpHome);
    await createGlobalHooksRoot(tmpHome);

    const result = runCli(['migrate', 'skills', '--apply', '--yes', '--repo', repoDir], repoDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('backup created');
    expect(result.stdout).toContain('removed');

    const defaultTierExists = await fs.pathExists(path.join(repoDir, '.xtrm', 'skills', 'default'));
    const optionalTierExists = await fs.pathExists(path.join(repoDir, '.xtrm', 'skills', 'optional'));
    expect(defaultTierExists).toBe(false);
    expect(optionalTierExists).toBe(false);

    const backupDir = path.join(tmpHome, '.xtrm', 'migration-backups');
    const backupExists = await fs.pathExists(backupDir);
    expect(backupExists).toBe(true);

    const backups = await fs.readdir(backupDir);
    const skillsBackup = backups.find((f) => f.startsWith('skills-test-repo'));
    expect(skillsBackup).toBeDefined();
  });

  it('apply mode creates backup and removes per-repo hooks', async () => {
    const repoDir = await createFakeRepo(tmpHome);
    await createGlobalSkillsRoot(tmpHome);
    await createGlobalHooksRoot(tmpHome);

    const result = runCli(['migrate', 'hooks', '--apply', '--yes', '--repo', repoDir], repoDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('backup created');
    expect(result.stdout).toContain('removed');

    const hooksExists = await fs.pathExists(path.join(repoDir, '.xtrm', 'hooks'));
    expect(hooksExists).toBe(false);

    const backupDir = path.join(tmpHome, '.xtrm', 'migration-backups');
    const backups = await fs.readdir(backupDir);
    const hooksBackup = backups.find((f) => f.startsWith('hooks-test-repo'));
    expect(hooksBackup).toBeDefined();
  });

  it('second run reports already migrated', async () => {
    const repoDir = await createFakeRepo(tmpHome);
    await createGlobalSkillsRoot(tmpHome);
    await createGlobalHooksRoot(tmpHome);

    runCli(['migrate', 'all', '--apply', '--yes', '--repo', repoDir], repoDir);
    const secondRun = runCli(['migrate', 'all', '--apply', '--yes', '--repo', repoDir], repoDir);

    expect(secondRun.exitCode).toBe(0);
    expect(secondRun.stdout).toContain('already migrated');
  });

  it('preserves diverged files as override', async () => {
    const repoDir = await createFakeRepo(tmpHome);
    const globalSkillsRoot = await createGlobalSkillsRoot(tmpHome);

    const divergedPath = path.join(repoDir, '.xtrm', 'skills', 'default', 'diverged-skill.md');
    await fs.writeFile(divergedPath, 'diverged content');

    const globalDivergedPath = path.join(globalSkillsRoot, 'default', 'diverged-skill.md');
    await fs.writeFile(globalDivergedPath, 'global content');

    const result = runCli(['migrate', 'skills', '--apply', '--yes', '--repo', repoDir], repoDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('diverged');
    expect(result.stdout).toContain('preserving as override');

    const legacyRoot = path.join(repoDir, '.xtrm', 'skills', 'local-legacy');
    const legacyFileExists = await fs.pathExists(path.join(legacyRoot, 'diverged-skill.md'));
    expect(legacyFileExists).toBe(true);
  });

  it('diverged pack preserves nested directory structure under local-legacy', async () => {
    const repoDir = await createFakeRepo(tmpHome);
    const globalSkillsRoot = await createGlobalSkillsRoot(tmpHome);

    await fs.ensureDir(path.join(repoDir, '.xtrm', 'skills', 'default', 'nested-skill'));
    await fs.writeFile(path.join(repoDir, '.xtrm', 'skills', 'default', 'nested-skill', 'SKILL.md'), 'repo skill');
    await fs.writeFile(path.join(repoDir, '.xtrm', 'skills', 'default', 'nested-skill', 'script.py'), 'repo script');

    await fs.ensureDir(path.join(globalSkillsRoot, 'default', 'nested-skill'));
    await fs.writeFile(path.join(globalSkillsRoot, 'default', 'nested-skill', 'SKILL.md'), 'global skill');
    await fs.writeFile(path.join(globalSkillsRoot, 'default', 'nested-skill', 'script.py'), 'global script');

    const result = runCli(['migrate', 'skills', '--apply', '--yes', '--repo', repoDir], repoDir);

    expect(result.exitCode).toBe(0);
    const legacyRoot = path.join(repoDir, '.xtrm', 'skills', 'local-legacy');
    expect(await fs.pathExists(path.join(legacyRoot, 'nested-skill', 'SKILL.md'))).toBe(true);
    expect(await fs.pathExists(path.join(legacyRoot, 'nested-skill', 'script.py'))).toBe(true);
    expect(await fs.readFile(path.join(legacyRoot, 'nested-skill', 'SKILL.md'), 'utf8')).toBe('repo skill');
  });

  it('local-legacy has no PACK.json and preserves partial trees', async () => {
    const repoDir = await createFakeRepo(tmpHome);
    const globalSkillsRoot = await createGlobalSkillsRoot(tmpHome);

    // Real skill dir (has SKILL.md) — diverged
    await fs.ensureDir(path.join(repoDir, '.xtrm', 'skills', 'default', 'real-skill'));
    await fs.writeFile(path.join(repoDir, '.xtrm', 'skills', 'default', 'real-skill', 'SKILL.md'), 'repo real');
    await fs.ensureDir(path.join(globalSkillsRoot, 'default', 'real-skill'));
    await fs.writeFile(path.join(globalSkillsRoot, 'default', 'real-skill', 'SKILL.md'), 'global real');

    // Partial dir (no SKILL.md, just other files) — diverged
    await fs.ensureDir(path.join(repoDir, '.xtrm', 'skills', 'default', 'partial-tree', 'refs'));
    await fs.writeFile(path.join(repoDir, '.xtrm', 'skills', 'default', 'partial-tree', 'refs', 'note.md'), 'repo partial');
    await fs.ensureDir(path.join(globalSkillsRoot, 'default', 'partial-tree', 'refs'));
    await fs.writeFile(path.join(globalSkillsRoot, 'default', 'partial-tree', 'refs', 'note.md'), 'global partial');

    const result = runCli(['migrate', 'skills', '--apply', '--yes', '--repo', repoDir], repoDir);
    expect(result.exitCode).toBe(0);

    const legacyRoot = path.join(repoDir, '.xtrm', 'skills', 'local-legacy');
    expect(await fs.pathExists(path.join(legacyRoot, 'PACK.json'))).toBe(false);
    expect(await fs.pathExists(path.join(legacyRoot, 'partial-tree', 'refs', 'note.md'))).toBe(true);
    expect(await fs.pathExists(path.join(legacyRoot, 'partial-tree'))).toBe(true);
  });

  it('preserves diverged files from optional tier as override', async () => {
    const repoDir = await createFakeRepo(tmpHome);
    const globalSkillsRoot = await createGlobalSkillsRoot(tmpHome);

    const divergedPath = path.join(repoDir, '.xtrm', 'skills', 'optional', 'optional-diverged.md');
    await fs.writeFile(divergedPath, 'optional diverged content');

    const globalDivergedPath = path.join(globalSkillsRoot, 'optional', 'optional-diverged.md');
    await fs.writeFile(globalDivergedPath, 'global optional content');

    const result = runCli(['migrate', 'skills', '--apply', '--yes', '--repo', repoDir], repoDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('diverged');
    expect(result.stdout).toContain('preserving as override');

    const legacyRoot = path.join(repoDir, '.xtrm', 'skills', 'local-legacy');
    const legacyFileExists = await fs.pathExists(path.join(legacyRoot, 'optional-diverged.md'));
    expect(legacyFileExists).toBe(true);
  });

  it('fails on non-xtrm repo', async () => {
    const nonXtrmDir = await createTempDir();
    try {
      await fs.writeJson(path.join(nonXtrmDir, 'package.json'), { name: 'test' });

      const result = runCli(['migrate', 'all', '--dry-run', '--repo', nonXtrmDir], nonXtrmDir);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Not an xtrm-managed repository');
    } finally {
      await fs.remove(nonXtrmDir);
    }
  });

  it('refuses --apply on source repo (package.json name)', async () => {
    const repoDir = await createFakeRepo(tmpHome);
    await createGlobalSkillsRoot(tmpHome);
    await createGlobalHooksRoot(tmpHome);
    await fs.writeJson(path.join(repoDir, 'package.json'), { name: 'xtrm-tools', version: '1.0.0' });

    const result = runCli(['migrate', 'skills', '--apply', '--yes', '--repo', repoDir], repoDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Refusing to migrate xtrm-tools source repo');
    expect(result.stderr).toContain("package.json name === 'xtrm-tools'");

    const defaultTierExists = await fs.pathExists(path.join(repoDir, '.xtrm', 'skills', 'default'));
    expect(defaultTierExists).toBe(true);
  });

  it('refuses --apply on source repo (gen-registry marker)', async () => {
    const repoDir = await createFakeRepo(tmpHome);
    await createGlobalSkillsRoot(tmpHome);
    await createGlobalHooksRoot(tmpHome);
    await fs.ensureDir(path.join(repoDir, 'scripts'));
    await fs.writeFile(path.join(repoDir, 'scripts', 'gen-registry.mjs'), '// marker');

    const result = runCli(['migrate', 'skills', '--apply', '--yes', '--repo', repoDir], repoDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Refusing to migrate xtrm-tools source repo');
    expect(result.stderr).toContain('scripts/gen-registry.mjs present');

    const defaultTierExists = await fs.pathExists(path.join(repoDir, '.xtrm', 'skills', 'default'));
    expect(defaultTierExists).toBe(true);
  });

  it('--dry-run allowed on source repo', async () => {
    const repoDir = await createFakeRepo(tmpHome);
    await createGlobalSkillsRoot(tmpHome);
    await createGlobalHooksRoot(tmpHome);
    await fs.writeJson(path.join(repoDir, 'package.json'), { name: 'xtrm-tools', version: '1.0.0' });

    const result = runCli(['migrate', 'skills', '--dry-run', '--repo', repoDir], repoDir);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain('Refusing to migrate');
    expect(result.stdout).toContain('would remove');
  });

  it('--force-source overrides guard', async () => {
    const repoDir = await createFakeRepo(tmpHome);
    await createGlobalSkillsRoot(tmpHome);
    await createGlobalHooksRoot(tmpHome);
    await fs.writeJson(path.join(repoDir, 'package.json'), { name: 'xtrm-tools', version: '1.0.0' });

    const result = runCli(['migrate', 'skills', '--apply', '--yes', '--force-source', '--repo', repoDir], repoDir);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain('Refusing to migrate');
    const defaultTierExists = await fs.pathExists(path.join(repoDir, '.xtrm', 'skills', 'default'));
    expect(defaultTierExists).toBe(false);
  });

  it('restore extracts skills backup back into repo', async () => {
    const repoDir = await createFakeRepo(tmpHome);
    await createGlobalSkillsRoot(tmpHome);
    await createGlobalHooksRoot(tmpHome);

    runCli(['migrate', 'skills', '--apply', '--yes', '--repo', repoDir], repoDir);
    expect(await fs.pathExists(path.join(repoDir, '.xtrm', 'skills', 'default'))).toBe(false);

    const backupDir = path.join(tmpHome, '.xtrm', 'migration-backups');
    const backups = await fs.readdir(backupDir);
    const skillsBackup = backups.find((f) => f.startsWith('skills-test-repo'));
    expect(skillsBackup).toBeDefined();
    const backupPath = path.join(backupDir, skillsBackup!);

    const result = runCli(['migrate', 'all', '--apply', '--restore', backupPath, '--repo', repoDir], repoDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('restored');
    expect(await fs.pathExists(path.join(repoDir, '.xtrm', 'skills', 'default', 'test-skill.md'))).toBe(true);
  });

  it('restore refuses when target exists', async () => {
    const repoDir = await createFakeRepo(tmpHome);
    await createGlobalSkillsRoot(tmpHome);
    await createGlobalHooksRoot(tmpHome);

    runCli(['migrate', 'skills', '--apply', '--yes', '--repo', repoDir], repoDir);
    const backupDir = path.join(tmpHome, '.xtrm', 'migration-backups');
    const backups = await fs.readdir(backupDir);
    const backupPath = path.join(backupDir, backups.find((f) => f.startsWith('skills-test-repo'))!);

    // restore once
    runCli(['migrate', 'all', '--apply', '--restore', backupPath, '--repo', repoDir], repoDir);
    // second restore should refuse
    const result = runCli(['migrate', 'all', '--apply', '--restore', backupPath, '--repo', repoDir], repoDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('already exists');
    expect(result.stderr).toContain('--force');
  });

  it('restore --force overrides target-exists refusal', async () => {
    const repoDir = await createFakeRepo(tmpHome);
    await createGlobalSkillsRoot(tmpHome);
    await createGlobalHooksRoot(tmpHome);

    runCli(['migrate', 'skills', '--apply', '--yes', '--repo', repoDir], repoDir);
    const backupDir = path.join(tmpHome, '.xtrm', 'migration-backups');
    const backups = await fs.readdir(backupDir);
    const backupPath = path.join(backupDir, backups.find((f) => f.startsWith('skills-test-repo'))!);

    runCli(['migrate', 'all', '--apply', '--restore', backupPath, '--repo', repoDir], repoDir);
    // dirty the restored dir
    await fs.writeFile(path.join(repoDir, '.xtrm', 'skills', 'sentinel.txt'), 'dirty');

    const result = runCli(['migrate', 'all', '--apply', '--force', '--restore', backupPath, '--repo', repoDir], repoDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('restored');
    expect(await fs.pathExists(path.join(repoDir, '.xtrm', 'skills', 'sentinel.txt'))).toBe(false);
  });

  it('restore --dry-run prints planned extraction only', async () => {
    const repoDir = await createFakeRepo(tmpHome);
    await createGlobalSkillsRoot(tmpHome);
    await createGlobalHooksRoot(tmpHome);

    runCli(['migrate', 'skills', '--apply', '--yes', '--repo', repoDir], repoDir);
    const backupDir = path.join(tmpHome, '.xtrm', 'migration-backups');
    const backups = await fs.readdir(backupDir);
    const backupPath = path.join(backupDir, backups.find((f) => f.startsWith('skills-test-repo'))!);

    const result = runCli(['migrate', 'all', '--dry-run', '--restore', backupPath, '--repo', repoDir], repoDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('would extract');
    expect(await fs.pathExists(path.join(repoDir, '.xtrm', 'skills', 'default'))).toBe(false);
  });

  it('restore hooks backup rewrites settings.json entries from sidecar', async () => {
    const repoDir = await createFakeRepo(tmpHome);
    await createGlobalSkillsRoot(tmpHome);
    await createGlobalHooksRoot(tmpHome);

    const claudeSettingsDir = path.join(repoDir, '.claude');
    await fs.ensureDir(claudeSettingsDir);
    const originalSettings = {
      hooks: {
        PreToolUse: [
          { _source: 'xtrm-global', matcher: 'Bash', hooks: [{ type: 'command', command: 'node /home/x/.xtrm/hooks/foo.mjs' }] },
          { matcher: 'Read', hooks: [{ type: 'command', command: '/usr/bin/user-hook' }] },
        ],
      },
      model: 'opus',
    };
    await fs.writeJson(path.join(claudeSettingsDir, 'settings.json'), originalSettings, { spaces: 2 });

    runCli(['migrate', 'hooks', '--apply', '--yes', '--repo', repoDir], repoDir);

    const cleaned = await fs.readJson(path.join(claudeSettingsDir, 'settings.json'));
    expect(cleaned.hooks.PreToolUse).toHaveLength(1);
    expect(cleaned.hooks.PreToolUse[0].matcher).toBe('Read');

    const backupDir = path.join(tmpHome, '.xtrm', 'migration-backups');
    const backups = await fs.readdir(backupDir);
    const hooksBackup = backups.find((f) => f.startsWith('hooks-test-repo') && f.endsWith('.tgz'));
    expect(hooksBackup).toBeDefined();
    const sidecar = backups.find((f) => f.startsWith('hooks-test-repo') && f.endsWith('.settings.json'));
    expect(sidecar).toBeDefined();

    const result = runCli(['migrate', 'all', '--apply', '--restore', path.join(backupDir, hooksBackup!), '--repo', repoDir], repoDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('settings: restored .claude/settings.json');

    const restored = await fs.readJson(path.join(claudeSettingsDir, 'settings.json'));
    expect(restored).toEqual(originalSettings);
  });

  it('cleans xtrm hooks from retired Pi agent settings while leaving direct settings untouched', async () => {
    const repoDir = await createFakeRepo(tmpHome);
    await createGlobalSkillsRoot(tmpHome);
    await createGlobalHooksRoot(tmpHome);

    const directSettingsPath = path.join(repoDir, '.pi', 'settings.json');
    const retiredSettingsPath = path.join(repoDir, '.pi', 'agent', 'settings.json');
    const xtrmHook = { _source: 'xtrm-global', matcher: 'Bash', hooks: [{ type: 'command', command: 'node /home/x/.xtrm/hooks/foo.mjs' }] };
    const userHook = { matcher: 'Read', hooks: [{ type: 'command', command: '/usr/bin/user-hook' }] };
    await fs.ensureDir(path.dirname(directSettingsPath));
    await fs.ensureDir(path.dirname(retiredSettingsPath));
    await fs.writeJson(directSettingsPath, { hooks: { PreToolUse: [xtrmHook, userHook] } });
    await fs.writeJson(retiredSettingsPath, { hooks: { PreToolUse: [xtrmHook] } });

    const result = runCli(['migrate', 'hooks', '--apply', '--yes', '--repo', repoDir], repoDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('settings: cleaned xtrm-owned entries from .pi/agent/settings.json');
    expect((await fs.readJson(directSettingsPath)).hooks.PreToolUse).toEqual([xtrmHook, userHook]);
    expect((await fs.readJson(retiredSettingsPath)).hooks.PreToolUse).toEqual([]);
  });

  it('logs migration events to skills-migration.jsonl', async () => {
    const repoDir = await createFakeRepo(tmpHome);
    await createGlobalSkillsRoot(tmpHome);
    await createGlobalHooksRoot(tmpHome);

    runCli(['migrate', 'skills', '--apply', '--yes', '--repo', repoDir], repoDir);

    const logPath = path.join(tmpHome, '.xtrm', 'logs', 'skills-migration.jsonl');
    const logExists = await fs.pathExists(logPath);
    expect(logExists).toBe(true);

    const logContent = await fs.readFile(logPath, 'utf8');
    const lines = logContent.trim().split('\n').map((line) => JSON.parse(line));
    const migrateEvent = lines.find((line: any) => line.event === 'skills.migrate.ok');
    expect(migrateEvent).toBeDefined();
    expect(migrateEvent.component).toBe('skills-migration');
    expect(migrateEvent.outcome).toBe('ok');
    expect(migrateEvent.backupPath).toBeDefined();
  });
});
