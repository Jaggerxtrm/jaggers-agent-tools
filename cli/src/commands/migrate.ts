import { Command } from 'commander';
import kleur from 'kleur';
import fs from 'fs-extra';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawnSync } from 'child_process';
import {
  resolveGlobalSkillsRoot,
  resolveDefaultTierRoot,
  resolveOptionalTierRoot,
  RESERVED_PACK_NAMES,
} from '../core/skills-layout.js';
import { resolveGlobalHooksRoot } from '../core/global-hooks-bootstrap.js';
import { isRepoMigrated, markRepoMigrated } from '../utils/known-repos.js';
import { shouldUseGlobalSkills } from '../core/global-skills-flag.js';
import { shouldUseGlobalHooks } from '../core/global-hooks-flag.js';
import { stageMigrationChanges } from '../utils/git-staging.js';
import { planLegacyHookDedupe, type HookWrapperLike } from '../core/legacy-hook-dedupe.js';

interface MigrateOptions {
  dryRun?: boolean;
  apply?: boolean;
  repo?: string;
  yes?: boolean;
  forceSource?: boolean;
  restore?: string;
  force?: boolean;
}

function detectRestoreComponent(backupPath: string): 'skills' | 'hooks' | null {
  const base = path.basename(backupPath);
  if (base.startsWith('skills-')) return 'skills';
  if (base.startsWith('hooks-')) return 'hooks';
  return null;
}

async function restoreBackup(
  repoPath: string,
  backupPath: string,
  opts: { dryRun: boolean; force: boolean },
): Promise<{ component: 'skills' | 'hooks'; targetDir: string }> {
  if (!path.isAbsolute(backupPath) && !backupPath.startsWith('~')) {
    throw new Error(`Backup path must be absolute or ~-expandable: ${backupPath}`);
  }
  const resolvedBackup = backupPath.startsWith('~')
    ? path.join(os.homedir(), backupPath.slice(1).replace(/^\//, ''))
    : backupPath;

  if (!(await fs.pathExists(resolvedBackup))) {
    throw new Error(`Backup not found: ${resolvedBackup}`);
  }

  const component = detectRestoreComponent(resolvedBackup);
  if (!component) {
    throw new Error(
      `Cannot detect component from backup filename (expected skills-* or hooks-*): ${path.basename(resolvedBackup)}`,
    );
  }

  const targetDir = path.join(repoPath, '.xtrm', component);
  const collisionProbe = component === 'skills'
    ? path.join(targetDir, 'default')
    : targetDir;
  if (await fs.pathExists(collisionProbe)) {
    if (!opts.force) {
      throw new Error(
        `Target already exists: ${collisionProbe}. Rerun with --force to overwrite.`,
      );
    }
  }

  if (opts.dryRun) {
    console.log(kleur.dim(`  would extract ${resolvedBackup}`));
    console.log(kleur.dim(`  into ${path.join(repoPath, '.xtrm')}`));
    return { component, targetDir };
  }

  if (await fs.pathExists(targetDir)) {
    await fs.remove(targetDir);
  }

  const extractInto = path.join(repoPath, '.xtrm');
  await fs.ensureDir(extractInto);

  const result = spawnSync('tar', ['-xzf', resolvedBackup, '-C', extractInto], {
    stdio: 'pipe',
  });
  if (result.status !== 0) {
    throw new Error(
      `Failed to extract backup: ${result.stderr.toString() || 'unknown error'}`,
    );
  }

  const realExtractInto = await fs.realpath(extractInto);
  const realTarget = await fs.realpath(targetDir);
  const rel = path.relative(realExtractInto, realTarget);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(
      `Restore path traversal detected: ${realTarget} escaped ${realExtractInto}`,
    );
  }

  return { component, targetDir };
}

async function detectSourceRepoMarker(repoPath: string): Promise<string | null> {
  const pkgPath = path.join(repoPath, 'package.json');
  if (await fs.pathExists(pkgPath)) {
    try {
      const pkg = await fs.readJson(pkgPath);
      if (pkg?.name === 'xtrm-tools') return "package.json name === 'xtrm-tools'";
    } catch { /* unreadable package.json → not a match */ }
  }
  if (await fs.pathExists(path.join(repoPath, 'scripts', 'gen-registry.mjs'))) {
    return 'scripts/gen-registry.mjs present';
  }
  if (await fs.pathExists(path.join(repoPath, 'scripts', 'vendor-specialists-skills.mjs'))) {
    return 'scripts/vendor-specialists-skills.mjs present';
  }
  return null;
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
    const localFiles = await walkDir(repoTierRoot);
    const tierPrefix = assetType === 'default' ? 'default/' : 'optional/';
    return {
      identical: false,
      divergedFiles: localFiles.map(file => `${tierPrefix}${path.relative(repoTierRoot, file)}`),
    };
  }

  const repoFiles = await walkDir(repoTierRoot);
  const globalFiles = await walkDir(globalTierRoot);

  const repoFileSet = new Set(repoFiles.map((f) => path.relative(repoTierRoot, f)));
  const globalFileSet = new Set(globalFiles.map((f) => path.relative(globalTierRoot, f)));

  const tierPrefix = assetType === 'default' ? 'default/' : 'optional/';

  for (const relPath of repoFileSet) {
    const prefixedRelPath = tierPrefix + relPath;
    if (!globalFileSet.has(relPath)) {
      divergedFiles.push(prefixedRelPath);
      continue;
    }

    const repoFilePath = path.join(repoTierRoot, relPath);
    const globalFilePath = path.join(globalTierRoot, relPath);

    const repoHash = hashFile(repoFilePath);
    const globalHash = hashFile(globalFilePath);

    if (repoHash !== globalHash) {
      divergedFiles.push(prefixedRelPath);
    }
  }

  return {
    identical: divergedFiles.length === 0,
    divergedFiles,
  };
}

// Runtime-generated / non-shippable content that only exists locally — excluded
// from divergence hashing so it never inflates local-legacy on migrate (xtrm-y0tdg.4).
const WALK_DIR_EXCLUDED_DIRS = new Set([
  '__pycache__',
  '.pytest_cache',
  '.serena',
  '.mypy_cache',
  '.ruff_cache',
  'node_modules',
  '.venv',
  'workspace',
]);
const WALK_DIR_EXCLUDED_SUFFIXES = ['.pyc', '.pyo'];

async function walkDir(dir: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (WALK_DIR_EXCLUDED_DIRS.has(entry.name)) continue;
      files.push(...(await walkDir(path.join(dir, entry.name))));
    } else {
      if (WALK_DIR_EXCLUDED_SUFFIXES.some(suffix => entry.name.endsWith(suffix))) continue;
      files.push(path.join(dir, entry.name));
    }
  }

  return files;
}

export async function migrateSkillsLayout(
  repoPath: string,
  opts: { dryRun: boolean; apply?: boolean },
): Promise<void> {
  const dryRun = opts.dryRun || opts.apply === false;
  const skillsRoot = path.join(repoPath, '.xtrm', 'skills');
  const legacyRoot = path.join(skillsRoot, 'user', 'packs');
  const moves: Array<{ source: string; target: string }> = [];
  const legacyEntries = await fs.readdir(legacyRoot, { withFileTypes: true }).catch(() => [] as fs.Dirent[]);
  const unexpectedEntries = legacyEntries.filter((entry) => !entry.isDirectory() || entry.isSymbolicLink());
  if (unexpectedEntries.length > 0) {
    throw new Error(
      `Refusing skills-layout migration: legacy root contains non-pack entries: ${unexpectedEntries.map((entry) => entry.name).join(', ')}`,
    );
  }

  for (const entry of legacyEntries) {
    if (RESERVED_PACK_NAMES.has(entry.name) && entry.name !== 'local-legacy') {
      throw new Error(`Refusing skills-layout migration: reserved v1 pack name '${entry.name}' cannot be flattened.`);
    }
    const source = path.join(legacyRoot, entry.name);
    const target = path.join(skillsRoot, entry.name);
    moves.push({ source, target });
  }

  for (const { source, target } of moves) {
    if (await fs.pathExists(target)) {
      throw new Error(`Cannot flatten pack '${path.basename(source)}': target already exists at ${target}.`);
    }
  }

  const activeRoot = path.join(skillsRoot, 'active');
  const danglingRuntimeSymlinks: string[] = [];
  for (const runtimeRel of ['.claude/skills', '.pi/skills']) {
    const runtimeDir = path.join(repoPath, runtimeRel);
    const stat = await fs.lstat(runtimeDir).catch(() => null);
    if (!stat?.isSymbolicLink()) continue;
    const linkTarget = await fs.readlink(runtimeDir);
    const resolvedTarget = path.resolve(path.dirname(runtimeDir), linkTarget);
    if (resolvedTarget === activeRoot) danglingRuntimeSymlinks.push(runtimeDir);
  }
  if (moves.length === 0 && !await fs.pathExists(activeRoot) && danglingRuntimeSymlinks.length === 0) {
    console.log(kleur.dim('  skills-layout: already flat'));
    return;
  }

  for (const { source, target } of moves) {
    if (dryRun) {
      console.log(kleur.cyan(`  skills-layout: would move ${source} → ${target}`));
      continue;
    }
    await fs.rename(source, target);
    await fs.remove(path.join(target, 'PACK.json'));
    console.log(kleur.green(`  skills-layout: moved ${source} → ${target}`));
  }

  if (dryRun) {
    if (await fs.pathExists(activeRoot)) console.log(kleur.cyan(`  skills-layout: would remove ${activeRoot}`));
    for (const runtimeDir of danglingRuntimeSymlinks) {
      console.log(kleur.cyan(`  skills-layout: would remove dangling ${path.relative(repoPath, runtimeDir)} symlink`));
    }
    return;
  }

  if (await fs.pathExists(activeRoot)) {
    await fs.remove(activeRoot);
    console.log(kleur.green(`  skills-layout: removed ${activeRoot}`));
  }
  await fs.remove(legacyRoot);
  await fs.remove(path.join(skillsRoot, 'user'));

  for (const runtimeDir of danglingRuntimeSymlinks) {
    await fs.remove(runtimeDir);
    console.log(kleur.green(`  skills-layout: removed dangling ${path.relative(repoPath, runtimeDir)} symlink`));
  }
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
        'local-legacy',
      );
      await fs.ensureDir(legacyRoot);

      const defaultTierRoot = resolveDefaultTierRoot(repoSkillsRoot);
      const optionalTierRoot = resolveOptionalTierRoot(repoSkillsRoot);

      for (const relPath of divergedFiles) {
        const tierPrefix = relPath.startsWith('optional/') ? 'optional/' : 'default/';
        const pathInTier = relPath.slice(tierPrefix.length);
          // Ignore retired pack metadata while preserving all skill files.
        if (path.basename(pathInTier) === 'PACK.json' && !pathInTier.includes('/')) continue;
        const sourcePath = relPath.startsWith('optional/')
          ? path.join(optionalTierRoot, pathInTier)
          : path.join(defaultTierRoot, pathInTier);

        const destPath = path.join(legacyRoot, pathInTier);
        if (await fs.pathExists(sourcePath)) {
          await fs.ensureDir(path.dirname(destPath));
          await fs.copy(sourcePath, destPath);
        }
      }

      // local-legacy is identified by its filesystem shape; no PACK.json is emitted.
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

  // xtrm-utdq1: stage the retirement (D lines) + runtime-state untrack +
  // gitignore additions so the operator doesn't inherit ~300 unstaged files.
  // Never commits — operator retains ownership of when to persist.
  const stageResult = await stageMigrationChanges(repoPath);
  if (stageResult.filesStaged > 0 || stageResult.gitignoreWritten) {
    const parts: string[] = [];
    if (stageResult.filesStaged > 0) parts.push(`${stageResult.filesStaged} file(s) staged`);
    if (stageResult.untracked.length > 0) parts.push(`${stageResult.untracked.length} runtime path(s) untracked`);
    if (stageResult.gitignoreWritten) parts.push('.gitignore updated');
    console.log(kleur.dim(`  skills: ${parts.join(', ')} — run 'git commit' to persist`));
  }

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

  // xtrm-utdq1: stage removal + runtime gitignore additions.
  const stageResult = await stageMigrationChanges(repoPath);
  if (stageResult.filesStaged > 0 || stageResult.gitignoreWritten) {
    const parts: string[] = [];
    if (stageResult.filesStaged > 0) parts.push(`${stageResult.filesStaged} file(s) staged`);
    if (stageResult.untracked.length > 0) parts.push(`${stageResult.untracked.length} runtime path(s) untracked`);
    if (stageResult.gitignoreWritten) parts.push('.gitignore updated');
    console.log(kleur.dim(`  hooks: ${parts.join(', ')} — run 'git commit' to persist`));
  }

  return { migrated: true, backupPath, divergedFiles: [], skipped: false };
}

function settingsSidecarPath(hooksBackupPath: string): string {
  return `${hooksBackupPath}.settings.json`;
}

async function cleanSettingsJsonEntries(
  repoPath: string,
  opts: { dryRun: boolean; apply: boolean; hooksBackupPath?: string },
): Promise<void> {
  const claudeSettingsPath = path.join(repoPath, '.claude', 'settings.json');
  const preCleanSnapshot: Record<string, unknown> = {};

  const piAgentSettingsPath = path.join(repoPath, '.pi', 'agent', 'settings.json');
  for (const settingsPath of [claudeSettingsPath, piAgentSettingsPath]) {
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

      // xtrm-v1yck: the provenance predicate above only matches entries the GLOBAL
      // installer tagged. Legacy per-project entries predate provenance tagging and
      // carry neither marker, so they need the coverage + byte-identity ownership
      // proof instead. Claude settings only — the proof is indexed off
      // ~/.claude/settings.json. Fail-open: skips rather than throwing.
      if (settingsPath === claudeSettingsPath) {
        const dedupe = await planLegacyHookDedupe(
          repoPath,
          cleanedHooks as Record<string, HookWrapperLike[]>,
        );
        if (dedupe.skipped) {
          console.log(kleur.yellow(`  settings: dedupe skipped — ${dedupe.skipped}`));
        } else if (dedupe.planned.length > 0) {
          for (const [phase, entries] of Object.entries(dedupe.hooks)) {
            cleanedHooks[phase] = entries;
          }
          for (const phase of Object.keys(cleanedHooks)) {
            if (!(phase in dedupe.hooks)) delete cleanedHooks[phase];
          }
          changed = true;
        }
      }

      if (changed) {
        if (opts.dryRun) {
          console.log(kleur.cyan(`  settings: would clean xtrm-owned entries from ${path.relative(repoPath, settingsPath)}`));
        } else if (opts.apply) {
          preCleanSnapshot[path.relative(repoPath, settingsPath)] = JSON.parse(JSON.stringify(settings));
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

  if (opts.apply && opts.hooksBackupPath && Object.keys(preCleanSnapshot).length > 0) {
    await fs.writeJson(settingsSidecarPath(opts.hooksBackupPath), preCleanSnapshot, { spaces: 2 });
    await fs.appendFile(settingsSidecarPath(opts.hooksBackupPath), '\n');
  }
}

async function restoreSettingsSidecar(
  repoPath: string,
  hooksBackupPath: string,
): Promise<string[]> {
  const sidecar = settingsSidecarPath(hooksBackupPath);
  if (!(await fs.pathExists(sidecar))) return [];
  const snapshot = await fs.readJson(sidecar) as Record<string, unknown>;
  const restoredFiles: string[] = [];
  const realRepo = await fs.realpath(repoPath);
  for (const [relPath, contents] of Object.entries(snapshot)) {
    const targetPath = path.join(repoPath, relPath);
    const targetDir = path.dirname(targetPath);
    await fs.ensureDir(targetDir);
    const realTargetDir = await fs.realpath(targetDir);
    const rel = path.relative(realRepo, realTargetDir);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`Settings sidecar path escaped repo root: ${targetPath}`);
    }
    await fs.writeJson(targetPath, contents, { spaces: 2 });
    await fs.appendFile(targetPath, '\n');
    restoredFiles.push(relPath);
  }
  return restoredFiles;
}

export function createMigrateCommand(): Command {
  return new Command('migrate')
    .description('One-time per-repo cleanup: migrate skills/hooks to global scope')
    .argument('[target]', 'Migration target: skills | hooks | all', 'all')
    .option('--dry-run', 'Preview changes without making any modifications', false)
    .option('--apply', 'Execute migration (destructive)', false)
    .option('--repo <path>', 'Target repository path (default: current working directory)')
    .option('-y, --yes', 'Skip confirmation prompt', false)
    .option('--force-source', 'Override source-repo guard (maintainer escape hatch)', false)
    .option('--restore <backup>', 'Restore per-repo skills/hooks from a migration tarball')
    .option('--force', 'Override target-exists refusal on --restore', false)
    .action(async (target: string, opts: MigrateOptions) => {
      try {
        const validTargets = ['skills', 'hooks', 'skills-layout', 'all'];
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

        if (opts.apply && !opts.forceSource) {
          const sourceMarker = await detectSourceRepoMarker(repoPath);
          if (sourceMarker) {
            console.error(
              kleur.red(
                `Refusing to migrate xtrm-tools source repo ${repoPath}: ${sourceMarker}. Migration is intended for consumers.`,
              ),
            );
            process.exitCode = 1;
            return;
          }
        }

        if (opts.restore) {
          if (!opts.forceSource) {
            const sourceMarker = await detectSourceRepoMarker(repoPath);
            if (sourceMarker) {
              console.error(
                kleur.red(
                  `Refusing to restore into xtrm-tools source repo ${repoPath}: ${sourceMarker}.`,
                ),
              );
              process.exitCode = 1;
              return;
            }
          }
          try {
            const { component, targetDir } = await restoreBackup(repoPath, opts.restore, {
              dryRun: opts.dryRun ?? false,
              force: opts.force ?? false,
            });
            if (opts.dryRun) {
              console.log(kleur.green(`\n  ✓ Restore dry-run complete (${component})\n`));
            } else {
              console.log(kleur.green(`  ${component}: restored to ${targetDir}`));
              if (component === 'hooks') {
                const restoredSettings = await restoreSettingsSidecar(repoPath, opts.restore);
                for (const rel of restoredSettings) {
                  console.log(kleur.green(`  settings: restored ${rel}`));
                }
              }
              await markRepoMigrated(repoPath, {
                skillsMigrated: component === 'skills' ? false : undefined,
                hooksMigrated: component === 'hooks' ? false : undefined,
              });
              await appendMigrationLog({
                timestamp: new Date().toISOString(),
                component: component === 'skills' ? 'skills-migration' : 'hooks-migration',
                event: `${component}.restore.ok`,
                repo: repoPath,
                backupPath: opts.restore,
                outcome: 'ok',
              });
              console.log(kleur.green(`\n  ✓ Restore complete\n`));
            }
            process.exitCode = 0;
            return;
          } catch (error) {
            console.error(
              kleur.red(`✗ Restore failed: ${error instanceof Error ? error.message : String(error)}`),
            );
            process.exitCode = 1;
            return;
          }
        }

        if (target === 'skills-layout') {
          if (opts.apply && !opts.yes) {
            console.error(kleur.red('  skills-layout: --apply requires --yes because migration moves packs and removes legacy paths.'));
            process.exitCode = 1;
            return;
          }
          await migrateSkillsLayout(repoPath, {
            dryRun: opts.dryRun ?? false,
            apply: opts.apply ?? false,
          });
          process.exitCode = 0;
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
          if (!shouldUseGlobalSkills(repoPath)) {
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
            hooksBackupPath: hooksResult.backupPath,
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
