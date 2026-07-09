import crypto from 'node:crypto';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { writeJsonAtomic } from '../utils/atomic-write.js';

interface GlobalHooksBootstrapOptions {
  readonly force?: boolean;
}

interface GlobalHooksBootstrapResult {
  readonly installedVersion: string;
  readonly changed: boolean;
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

function resolveLogPath(): string {
  return path.join(os.homedir(), '.xtrm', 'logs', 'skills-migration.jsonl');
}

async function appendHookLog(event: HookLogEvent): Promise<void> {
  const logPath = resolveLogPath();
  await fs.ensureDir(path.dirname(logPath));
  await fs.appendFile(logPath, `${JSON.stringify(event)}\n`);
}

async function readInstalledVersion(): Promise<string | null> {
  const statePath = resolveStatePath();
  if (!await fs.pathExists(statePath)) {
    return null;
  }

  const state = await fs.readJson(statePath) as { installedVersion?: string };
  return typeof state.installedVersion === 'string' ? state.installedVersion : null;
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

  const currentVersion = await readInstalledVersion();
  if (!opts.force && currentVersion === installedVersion && await fs.pathExists(targetHooksRoot) && await fs.pathExists(targetHooksConfigPath)) {
    await appendHookLog({
      timestamp: new Date().toISOString(),
      component: 'hooks-migration',
      event: 'hook.bootstrap.ok',
      source: hashValue(targetHooksRoot),
      action: 'noop',
      outcome: 'skipped',
      durationMs: Date.now() - startedAt,
    });
    return { installedVersion, changed: false };
  }

  try {
    await fs.remove(targetHooksRoot);
    await fs.copy(sourceHooksRoot, targetHooksRoot, { filter: COPY_FILTER });
    await fs.ensureDir(path.dirname(targetHooksConfigPath));
    await fs.copy(sourceHooksConfigPath, targetHooksConfigPath);
    await writeJsonAtomic(statePath, {
      installedVersion,
      installedFrom: pkgRoot,
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

    return { installedVersion, changed: true };
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

export { appendHookLog, hashValue, resolveGlobalHooksConfigPath, resolveGlobalHooksRoot };
