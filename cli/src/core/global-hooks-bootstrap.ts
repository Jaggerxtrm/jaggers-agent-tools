import crypto from 'node:crypto';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { writeJsonAtomic } from '../utils/atomic-write.js';
import {
  INSTALLER_MANIFEST_FILENAME,
  listFilesUnder,
  pruneEmptyDirsUnder,
  readManifestJson,
  removeTrackedEntries,
  writeManifestJson,
} from './installer-manifest.js';

interface GlobalHooksBootstrapOptions {
  readonly force?: boolean;
}

interface GlobalHooksBootstrapResult {
  readonly installedVersion: string;
  readonly changed: boolean;
  readonly sourceFingerprint: string;
}

interface HookLogEvent {
  readonly timestamp: string;
  readonly component: 'hooks-migration';
  readonly event: string;
  readonly source?: string;
  readonly entryKey?: string;
  readonly action?: string;
  readonly outcome?: 'ok' | 'skipped' | 'error';
  readonly durationMs?: number;
}

interface GlobalHooksState {
  readonly installedVersion?: string;
  readonly installedFrom?: string;
  readonly sourceFingerprint?: string;
}

const COPY_FILTER = (sourcePath: string): boolean => !sourcePath.endsWith('__pycache__');

function hashValue(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function resolveGlobalHooksRoot(): string {
  return path.join(os.homedir(), '.xtrm', 'hooks');
}

function resolveGlobalHooksConfigPath(): string {
  return path.join(os.homedir(), '.xtrm', 'config', 'hooks.json');
}

function resolveStatePath(): string {
  return path.join(resolveGlobalHooksRoot(), 'state.json');
}

function resolveHooksManifestPath(): string {
  return path.join(resolveGlobalHooksRoot(), INSTALLER_MANIFEST_FILENAME);
}

// xtrm-wiy5n.4.37 — track every file the previous install wrote under
// ~/.xtrm/hooks. On the next install only those paths are removed; anything
// else (a user-authored hook, a manual override) survives.
interface HooksInstallerManifest {
  files?: string[];
}

function resolveLogPath(): string {
  return path.join(os.homedir(), '.xtrm', 'logs', 'skills-migration.jsonl');
}

async function appendHookLog(event: HookLogEvent): Promise<void> {
  const logPath = resolveLogPath();
  await fs.ensureDir(path.dirname(logPath));
  await fs.appendFile(logPath, `${JSON.stringify(event)}\n`);
}

async function readState(): Promise<GlobalHooksState | null> {
  const statePath = resolveStatePath();
  if (!await fs.pathExists(statePath)) {
    return null;
  }

  try {
    return await fs.readJson(statePath) as GlobalHooksState;
  } catch {
    return null;
  }
}

// Content fingerprint of the source hooks payload — hashes the canonical
// hooks.json plus every hook file under .xtrm/hooks/ (sorted for determinism).
// The version string alone is insufficient because bootstrap can be re-sourced
// from a stale worktree/dev-clone at the same version and silently downgrade
// the global config (xtrm-bbxzu incident: 11:59 rewrote ~/.xtrm/config/hooks.json
// with pre-v0.10.4 $CLAUDE_PROJECT_DIR paths from a stale worktree).
async function computeSourceFingerprint(sourceHooksRoot: string, sourceHooksConfigPath: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  if (await fs.pathExists(sourceHooksConfigPath)) {
    hash.update('config:');
    hash.update(await fs.readFile(sourceHooksConfigPath));
  }

  const files: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '__pycache__') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        files.push(full);
      }
    }
  }
  if (await fs.pathExists(sourceHooksRoot)) {
    await walk(sourceHooksRoot);
  }

  files.sort();
  for (const file of files) {
    const rel = path.relative(sourceHooksRoot, file);
    hash.update('file:');
    hash.update(rel);
    hash.update('\0');
    hash.update(await fs.readFile(file));
  }

  return hash.digest('hex');
}

export async function ensureGlobalHooksBootstrapped(pkgRoot: string, opts: GlobalHooksBootstrapOptions = {}): Promise<GlobalHooksBootstrapResult> {
  const startedAt = Date.now();
  const packageJsonPath = path.join(pkgRoot, 'package.json');
  const packageJson = await fs.readJson(packageJsonPath) as { version?: string };
  const installedVersion = packageJson.version;

  if (!installedVersion) {
    throw new Error(`Failed to read package version from ${packageJsonPath}.`);
  }

  const sourceHooksRoot = path.join(pkgRoot, '.xtrm', 'hooks');
  const sourceHooksConfigPath = path.join(pkgRoot, '.xtrm', 'config', 'hooks.json');
  const targetHooksRoot = resolveGlobalHooksRoot();
  const targetHooksConfigPath = resolveGlobalHooksConfigPath();
  const statePath = resolveStatePath();

  await appendHookLog({
    timestamp: new Date().toISOString(),
    component: 'hooks-migration',
    event: 'hook.bootstrap.start',
    source: hashValue(sourceHooksRoot),
    outcome: 'ok',
    durationMs: 0,
  });

  const sourceFingerprint = await computeSourceFingerprint(sourceHooksRoot, sourceHooksConfigPath);
  const currentState = await readState();
  const targetsExist = await fs.pathExists(targetHooksRoot) && await fs.pathExists(targetHooksConfigPath);
  const fingerprintMatches = currentState?.sourceFingerprint === sourceFingerprint;

  if (!opts.force && targetsExist && fingerprintMatches) {
    await appendHookLog({
      timestamp: new Date().toISOString(),
      component: 'hooks-migration',
      event: 'hook.bootstrap.ok',
      source: hashValue(targetHooksRoot),
      action: 'noop',
      outcome: 'skipped',
      durationMs: Date.now() - startedAt,
    });
    return { installedVersion, changed: false, sourceFingerprint };
  }

  try {
    const manifestPath = resolveHooksManifestPath();
    const previousManifest = await readManifestJson<HooksInstallerManifest>(manifestPath, {});
    await fs.ensureDir(targetHooksRoot);
    await removeTrackedEntries(targetHooksRoot, previousManifest.files ?? []);
    await pruneEmptyDirsUnder(targetHooksRoot);
    await fs.copy(sourceHooksRoot, targetHooksRoot, { filter: COPY_FILTER, overwrite: true });
    await fs.ensureDir(path.dirname(targetHooksConfigPath));
    await fs.copy(sourceHooksConfigPath, targetHooksConfigPath, { overwrite: true });
    const nextFiles = await listFilesUnder(targetHooksRoot);
    await writeManifestJson(manifestPath, { files: nextFiles });
    await writeJsonAtomic(statePath, {
      installedVersion,
      installedFrom: pkgRoot,
      sourceFingerprint,
    }, { expectedRoot: targetHooksRoot });

    await appendHookLog({
      timestamp: new Date().toISOString(),
      component: 'hooks-migration',
      event: 'hook.bootstrap.ok',
      source: hashValue(targetHooksRoot),
      action: 'copy',
      outcome: 'ok',
      durationMs: Date.now() - startedAt,
    });

    return { installedVersion, changed: true, sourceFingerprint };
  } catch (error) {
    await appendHookLog({
      timestamp: new Date().toISOString(),
      component: 'hooks-migration',
      event: 'hook.bootstrap.ok',
      source: hashValue(targetHooksRoot),
      action: 'copy',
      outcome: 'error',
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
}

export { appendHookLog, hashValue, resolveGlobalHooksConfigPath, resolveGlobalHooksRoot, computeSourceFingerprint };
