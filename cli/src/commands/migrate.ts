import { Command } from 'commander';
import kleur from 'kleur';
import fs from 'fs-extra';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawnSync } from 'child_process';
import { resolveGlobalSkillsRoot, resolveDefaultTierRoot, resolveOptionalTierRoot } from '../core/skills-layout.js';
import { resolveGlobalHooksRoot } from '../core/global-hooks-bootstrap.js';
import { isRepoMigrated, markRepoMigrated } from '../utils/known-repos.js';
import { shouldUseGlobalSkills } from '../core/global-skills-flag.js';
import { shouldUseGlobalHooks } from '../core/global-hooks-flag.js';

interface MigrateOptions {
  dryRun?: boolean;
  apply?: boolean;
  repo?: string;
  yes?: boolean;
}

interface MigrationLogEvent {
  timestamp: string;
  component: 'skills-migration' | 'hooks-migration';
  event: string;
  repo?: string;
  action?: string;
  backupPath?: string;
  filesRemoved?: string[];
  outcome?: 'ok' | 'skipped' | 'error' | 'diverged';
  reason?: string;
  divergedFiles?: string[];
}

function resolveLogPath(): string {
  return path.join(os.homedir(), '.xtrm', 'logs', 'skills-migration.jsonl');
}

async function appendMigrationLog(event: MigrationLogEvent): Promise<void> {
  const logPath = resolveLogPath();
  await fs.ensureDir(path.dirname(logPath));
  await fs.appendFile(logPath, `${JSON.stringify(event)}\n`);
}

function hashFile(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

function hashValue(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function createTarballBackup(
  sourceDir: string,
  backupName: string,
): Promise<string> {
  const backupRoot = path.join(os.homedir(), '.xtrm', 'migration-backups');
  await fs.ensureDir(backupRoot);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupRoot, `${backupName}-${timestamp}.tgz`);

  const sourceBasename = path.basename(sourceDir);
  const parentDir = path.dirname(sourceDir);

  const result = spawnSync('tar', [
    '-czf',
    backupPath,
    '-C',
    parentDir,
    sourceBasename,
  ], {
    stdio: 'pipe',
  });

  if (result.status !== 0) {
    throw new Error(
      `Failed to create backup tarball: ${result.stderr.toString() || 'unknown error'}`,
    );
  }

  return backupPath;
}

async function verifySkillsIdentity(
  repoSkillsRoot: string,
  assetType: 'default' | 'optional',
): Promise<{ identical: boolean; divergedFiles: string[] }> {
  const globalSkillsRoot = resolveGlobalSkillsRoot();
  const globalTierRoot =
    assetType === 'default'
      ? resolveDefaultTierRoot(globalSkillsRoot)
      : resolveOptionalTierRoot(globalSkillsRoot);

  const repoTierRoot =
    assetType === 'default'
      ? resolveDefaultTierRoot(repoSkillsRoot)
      : resolveOptionalTierRoot(repoSkillsRoot);

  const divergedFiles: string[] = [];

  if (!(await fs.pathExists(repoTierRoot))) {
    return { identical: true, divergedFiles: [] };
  }

  if (!(await fs.pathExists(globalTierRoot))) {
    return { identical: false, divergedFiles: [] };
  }

  const repoFiles = await walkDir(repoTierRoot);
  const globalFiles = await walkDir(globalTierRoot);

  const repoFileSet = new Set(repoFiles.map((f) => path.relative(repoTierRoot, f)));
  const globalFileSet = new Set(globalFiles.map((f) => path.relative(globalTierRoot, f)));

  for (const relPath of repoFileSet) {
    if (!globalFileSet.has(relPath)) {
      divergedFiles.push(relPath);
      continue;
    }

    const repoFilePath = path.join(repoTierRoot, relPath);
    const globalFilePath = path.join(globalTierRoot, relPath);

    const repoHash = hashFile(repoFilePath);
    const globalHash = hashFile(globalFilePath);

    if (repoHash !== globalHash) {
      divergedFiles.push(relPath);
    }
  }

  return {
    identical: divergedFiles.length === 0,
    divergedFiles,
  };
}

async function walkDir(dir: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkDir(entryPath)));
    } else {
      files.push(entryPath);
    }
  }

  return files;
}

async function migrateSkills(
  repoPath: string,
  opts: { dryRun: boolean; apply: boolean },
): Promise<{ migrated: boolean; backupPath?: string; divergedFiles: string[] }> {
  const repoSkillsRoot = path.join(repoPath, '.xtrm', 'skills');
  const divergedFiles: string[] = [];

  const alreadyMigrated = await isRepoMigrated(repoPath, { skills: true });
  if (alreadyMigrated) {
    console.log(kleur.dim('  skills: already migrated'));
    return { migrated: false, backupPath: undefined, divergedFiles: [] };
  }

  const defaultVerification = await verifySkillsIdentity(repoSkillsRoot, 'default');
  const optionalVerification = await verifySkillsIdentity(repoSkillsRoot, 'optional');

  divergedFiles.push(...defaultVerification.divergedFiles);
  divergedFiles.push(...optionalVerification.divergedFiles);

  if (divergedFiles.length > 0) {
    console.log(
      kleur.yellow(
        `  skills: ${divergedFiles.length} file(s) diverged from global — preserving as override`,
      ),
    );
    await appendMigrationLog({
      timestamp: new Date().toISOString(),
      component: 'skills-migration',
      event: 'skills.migrate.diverged',
      repo: repoPath,
      action: 'preserve-override',
      divergedFiles,
      outcome: 'diverged',
      reason: 'Local files differ from global canonical',
    });

    if (!opts.dryRun && opts.apply) {
      const legacyRoot = path.join(
        repoSkillsRoot,
        'user',
        'packs',
        'local-legacy',
      );
      await fs.ensureDir(legacyRoot);

      const defaultTierRoot = resolveDefaultTierRoot(repoSkillsRoot);
      const optionalTierRoot = resolveOptionalTierRoot(repoSkillsRoot);

      for (const relPath of divergedFiles) {
        const sourcePath = relPath.startsWith('optional/')
          ? path.join(optionalTierRoot, relPath)
          : path.join(defaultTierRoot, relPath);

        const destPath = path.join(legacyRoot, path.basename(relPath));
        if (await fs.pathExists(sourcePath)) {
          await fs.copy(sourcePath, destPath);
        }
      }
    }
  }

  const skillsToRemove: string[] = [];
  const defaultTierRoot = resolveDefaultTierRoot(repoSkillsRoot);
  const optionalTierRoot = resolveOptionalTierRoot(repoSkillsRoot);

  if (await fs.pathExists(defaultTierRoot)) {
    skillsToRemove.push(defaultTierRoot);
  }

  if (await fs.pathExists(optionalTierRoot)) {
    skillsToRemove.push(optionalTierRoot);
  }

  if (skillsToRemove.length === 0) {
    console.log(kleur.dim('  skills: no per-repo default/optional to migrate'));
    return { migrated: false, backupPath: undefined, divergedFiles };
  }

  if (opts.dryRun) {
    console.log(kleur.cyan('  skills: would remove:'));
    for (const p of skillsToRemove) {
      console.log(kleur.gray(`    - ${p}`));
    }
    return { migrated: false, backupPath: undefined, divergedFiles };
  }

  if (!opts.apply) {
    console.log(kleur.yellow('  skills: dry-run (use --apply to execute)'));
    return { migrated: false, backupPath: undefined, divergedFiles };
  }

  const backupPath = await createTarballBackup(
    repoSkillsRoot,
    `skills-${path.basename(repoPath)}`,
  );
  console.log(kleur.green(`  skills: backup created at ${backupPath}`));

  for (const p of skillsToRemove) {
    await fs.remove(p);
    console.log(kleur.green(`  skills: removed ${p}`));
  }

  await appendMigrationLog({
    timestamp: new Date().toISOString(),
    component: 'skills-migration',
    event: 'skills.migrate.ok',
    repo: repoPath,
    action: 'delete',
    backupPath,
    filesRemoved: skillsToRemove,
    outcome: 'ok',
  });

  await markRepoMigrated(repoPath, { skillsMigrated: true, backupPath });

  return { migrated: true, backupPath, divergedFiles };
}

async function verifyHooksIdentity(repoPath: string): Promise<{ identical: boolean; divergedFiles: string[] }> {
  const globalHooksRoot = resolveGlobalHooksRoot();
  const repoHooksRoot = path.join(repoPath, '.xtrm', 'hooks');

  const divergedFiles: string[] = [];

  if (!(await fs.pathExists(repoHooksRoot))) {
    return { identical: true, divergedFiles: [] };
  }

  if (!(await fs.pathExists(globalHooksRoot))) {
    return { identical: false, divergedFiles: [] };
  }

  const repoFiles = await walkDir(repoHooksRoot);
  const globalFiles = await walkDir(globalHooksRoot);

  const repoFileSet = new Set(repoFiles.map((f) => path.relative(repoHooksRoot, f)));
  const globalFileSet = new Set(globalFiles.map((f) => path.relative(globalHooksRoot, f)));

  for (const relPath of repoFileSet) {
    if (!globalFileSet.has(relPath)) {
      divergedFiles.push(relPath);
      continue;
    }

    const repoFilePath = path.join(repoHooksRoot, relPath);
    const globalFilePath = path.join(globalHooksRoot, relPath);

    const repoHash = hashFile(repoFilePath);
    const globalHash = hashFile(globalFilePath);

    if (repoHash !== globalHash) {
      divergedFiles.push(relPath);
    }
  }

  return {
    identical: divergedFiles.length === 0,
    divergedFiles,
  };
}

async function migrateHooks(
  repoPath: string,
  opts: { dryRun: boolean; apply: boolean },
): Promise<{ migrated: boolean; backupPath?: string; divergedFiles: string[]; skipped: boolean }> {
  const repoHooksRoot = path.join(repoPath, '.xtrm', 'hooks');

  const alreadyMigrated = await isRepoMigrated(repoPath, { hooks: true });
  if (alreadyMigrated) {
    console.log(kleur.dim('  hooks: already migrated'));
    return { migrated: false, backupPath: undefined, divergedFiles: [], skipped: false };
  }

  const verification = await verifyHooksIdentity(repoPath);

  if (verification.divergedFiles.length > 0) {
    console.log(
      kleur.yellow(
        `  hooks: ${verification.divergedFiles.length} file(s) diverged — skipping removal, keeping as override`,
      ),
    );
    await appendMigrationLog({
      timestamp: new Date().toISOString(),
      component: 'hooks-migration',
      event: 'hooks.migrate.diverged',
      repo: repoPath,
      action: 'skip',
      divergedFiles: verification.divergedFiles,
      outcome: 'diverged',
      reason: 'Local hooks differ from global canonical',
    });
    return { migrated: false, backupPath: undefined, divergedFiles: verification.divergedFiles, skipped: true };
  }

  if (!(await fs.pathExists(repoHooksRoot))) {
    console.log(kleur.dim('  hooks: no per-repo hooks to migrate'));
    return { migrated: false, backupPath: undefined, divergedFiles: [], skipped: false };
  }

  if (opts.dryRun) {
    console.log(kleur.cyan('  hooks: would remove:'));
    console.log(kleur.gray(`    - ${repoHooksRoot}`));
    return { migrated: false, backupPath: undefined, divergedFiles: [], skipped: false };
  }

  if (!opts.apply) {
    console.log(kleur.yellow('  hooks: dry-run (use --apply to execute)'));
    return { migrated: false, backupPath: undefined, divergedFiles: [], skipped: false };
  }

  const backupPath = await createTarballBackup(
    repoHooksRoot,
    `hooks-${path.basename(repoPath)}`,
  );
  console.log(kleur.green(`  hooks: backup created at ${backupPath}`));

  await fs.remove(repoHooksRoot);
  console.log(kleur.green(`  hooks: removed ${repoHooksRoot}`));

  await appendMigrationLog({
    timestamp: new Date().toISOString(),
    component: 'hooks-migration',
    event: 'hooks.migrate.ok',
    repo: repoPath,
    action: 'delete',
    backupPath,
    filesRemoved: [repoHooksRoot],
    outcome: 'ok',
  });

  await markRepoMigrated(repoPath, { hooksMigrated: true, backupPath });

  return { migrated: true, backupPath, divergedFiles: [], skipped: false };
}

async function cleanSettingsJsonEntries(repoPath: string, opts: { dryRun: boolean; apply: boolean }): Promise<void> {
  const claudeSettingsPath = path.join(repoPath, '.claude', 'settings.json');
  const piSettingsPath = path.join(repoPath, '.pi', 'agent', 'settings.json');

  for (const settingsPath of [claudeSettingsPath, piSettingsPath]) {
    if (!(await fs.pathExists(settingsPath))) {
      continue;
    }

    try {
      const settings = await fs.readJson(settingsPath) as Record<string, unknown>;
      const hooks = settings.hooks as Record<string, unknown[]> | undefined;

      if (!hooks) {
        continue;
      }

      let changed = false;
      const cleanedHooks: Record<string, unknown[]> = {};

      for (const [phase, entries] of Object.entries(hooks)) {
        if (!Array.isArray(entries)) {
          cleanedHooks[phase] = entries;
          continue;
        }

        const cleanedEntries = entries.filter((entry) => {
          if (typeof entry !== 'object' || entry === null) {
            return true;
          }

          const hookEntry = entry as Record<string, unknown>;
          const source = hookEntry._source as string | undefined;
          const xtrm = hookEntry._xtrm as Record<string, unknown> | undefined;

          if (source === 'xtrm-global') {
            changed = true;
            return false;
          }

          if (xtrm && typeof xtrm === 'object' && 'hash' in xtrm) {
            changed = true;
            return false;
          }

          return true;
        });

        cleanedHooks[phase] = cleanedEntries;
      }

      if (changed) {
        if (opts.dryRun) {
          console.log(kleur.cyan(`  settings: would clean xtrm-owned entries from ${path.relative(repoPath, settingsPath)}`));
        } else if (opts.apply) {
          settings.hooks = cleanedHooks;
          await fs.writeJson(settingsPath, settings, { spaces: 2 });
          await fs.appendFile(settingsPath, '\n');
          console.log(kleur.green(`  settings: cleaned xtrm-owned entries from ${path.relative(repoPath, settingsPath)}`));
        }
      }
    } catch {
      // Ignore malformed settings files
    }
  }
}

export function createMigrateCommand(): Command {
  return new Command('migrate')
    .description('One-time per-repo cleanup: migrate skills/hooks to global scope')
    .argument('[target]', 'Migration target: skills | hooks | all', 'all')
    .option('--dry-run', 'Preview changes without making any modifications', false)
    .option('--apply', 'Execute migration (destructive)', false)
    .option('--repo <path>', 'Target repository path (default: current working directory)')
    .option('-y, --yes', 'Skip confirmation prompt', false)
    .action(async (target: string, opts: MigrateOptions) => {
      try {
        const validTargets = ['skills', 'hooks', 'all'];
        if (!validTargets.includes(target)) {
          console.error(
            kleur.red(
              `Invalid target '${target}'. Must be one of: ${validTargets.join(', ')}`,
            ),
          );
          process.exitCode = 1;
          return;
        }

        if (!opts.dryRun && !opts.apply) {
          console.log(kleur.yellow('\n  ⚠  This is a DRY RUN. No changes will be made.'));
          console.log(kleur.yellow('  Use --apply to execute the migration.\n'));
          opts.dryRun = true;
        }

        const repoPath = opts.repo ? path.resolve(opts.repo) : process.cwd();

        const xtrmDir = path.join(repoPath, '.xtrm');
        if (!(await fs.pathExists(xtrmDir))) {
          console.error(
            kleur.red(`Not an xtrm-managed repository: ${repoPath}`),
          );
          process.exitCode = 1;
          return;
        }

        console.log(kleur.bold(`\n  Migrating ${path.basename(repoPath)}`));
        console.log(kleur.dim(`  Target: ${target}`));
        console.log(kleur.dim(`  Mode: ${opts.dryRun ? 'dry-run' : 'apply'}`));
        console.log(kleur.dim(`  Repo: ${repoPath}\n`));

        if (!opts.dryRun && opts.apply && !opts.yes) {
          const readline = await import('node:readline');
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
          });

          const answer = await new Promise<string>((resolve) => {
            rl.question(
              kleur.yellow('  ⚠  This will DELETE per-repo skills/hooks. Continue? [y/N] '),
              resolve,
            );
          });
          rl.close();

          if (answer.toLowerCase() !== 'y') {
            console.log(kleur.dim('  Migration cancelled.'));
            process.exitCode = 0;
            return;
          }
        }

        let skillsResult: { migrated: boolean; backupPath?: string; divergedFiles: string[] } = { migrated: false, backupPath: undefined, divergedFiles: [] };
        let hooksResult: { migrated: boolean; backupPath?: string; divergedFiles: string[]; skipped: boolean } = { migrated: false, backupPath: undefined, divergedFiles: [], skipped: false };

        if (target === 'skills' || target === 'all') {
          if (!shouldUseGlobalSkills()) {
            console.log(
              kleur.yellow(
                '  ⚠  XTRM_GLOBAL_SKILLS not set. Migration may be premature.',
              ),
            );
          }
          skillsResult = await migrateSkills(repoPath, {
            dryRun: opts.dryRun ?? false,
            apply: opts.apply ?? false,
          });
        }

        if (target === 'hooks' || target === 'all') {
          if (!shouldUseGlobalHooks()) {
            console.log(
              kleur.yellow(
                '  ⚠  XTRM_GLOBAL_HOOKS not set. Migration may be premature.',
              ),
            );
          }
          hooksResult = await migrateHooks(repoPath, {
            dryRun: opts.dryRun ?? false,
            apply: opts.apply ?? false,
          });
        }

        if ((target === 'hooks' || target === 'all') && hooksResult.migrated) {
          await cleanSettingsJsonEntries(repoPath, {
            dryRun: opts.dryRun ?? false,
            apply: opts.apply ?? false,
          });
        }

        console.log(kleur.green('\n  ✓ Migration complete\n'));

        if (opts.dryRun) {
          console.log(
            kleur.dim(
              '  Run with --apply to execute. Backups will be created at ~/.xtrm/migration-backups/',
            ),
          );
        }

        process.exitCode = 0;
      } catch (error) {
        console.error(
          kleur.red(`✗ Migration failed: ${error instanceof Error ? error.message : String(error)}`),
        );
        await appendMigrationLog({
          timestamp: new Date().toISOString(),
          component: 'skills-migration',
          event: 'migrate.error',
          repo: opts?.repo ?? process.cwd(),
          outcome: 'error',
          reason: error instanceof Error ? error.message : String(error),
        });
        process.exitCode = 1;
      }
    });
}
