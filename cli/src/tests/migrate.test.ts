import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execSync } from 'child_process';

const CLI_PATH = path.join(__dirname, '../../dist/index.cjs');

function runCli(args: string[], cwd?: string): { stdout: string; stderr: string; exitCode: number | null } {
  try {
    // semgrep-ignore-next-line: command-injection - test fixture, args are controlled by test code
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

    const legacyRoot = path.join(repoDir, '.xtrm', 'skills', 'user', 'packs', 'local-legacy');
    const legacyFileExists = await fs.pathExists(path.join(legacyRoot, 'diverged-skill.md'));
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
