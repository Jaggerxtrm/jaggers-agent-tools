import crypto from 'node:crypto';
import fs from 'fs-extra';
import path from 'node:path';
import { resolveGlobalSkillsRoot, resolveStateFilePath, SKILLS_STATE_SCHEMA_VERSION } from './skills-layout.js';
import { rebuildGlobalActiveView } from './skills-materializer.js';
import { readSkillsState } from './skills-state.js';

interface BootstrapOptions {
  readonly force?: boolean;
}

interface BootstrapResult {
  readonly installedVersion: string;
  readonly changed: boolean;
}

interface BootstrapLogEvent {
  readonly timestamp: string;
  readonly component: 'skills-bootstrap';
  readonly event: string;
  readonly pkgVersion: string;
  readonly source?: string;
  readonly target?: string;
  readonly filesCopied?: number;
  readonly durationMs?: number;
  readonly outcome?: 'ok' | 'skipped' | 'error';
  readonly command?: string;
  readonly cwd?: string;
}

const COPY_FILTER = (sourcePath: string): boolean => !sourcePath.endsWith('__pycache__');

function hashPath(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function formatLogPath(filePath: string): string {
  const normalized = path.resolve(filePath);
  const globalRoot = path.resolve(path.join(path.dirname(resolveGlobalSkillsRoot()), '..'));
  return normalized.startsWith(globalRoot) ? normalized : `sha256:${hashPath(normalized)}`;
}

async function appendLog(event: BootstrapLogEvent): Promise<void> {
  const logPath = path.join(path.dirname(resolveGlobalSkillsRoot()), 'logs', 'skills-migration.jsonl');
  await fs.ensureDir(path.dirname(logPath));
  await fs.appendFile(logPath, `${JSON.stringify(event)}\n`);
}

export async function logBootstrapTrigger(params: {
  readonly command: string;
  readonly cwd: string;
  readonly pkgVersion: string;
}): Promise<void> {
  await appendLog({
    timestamp: new Date().toISOString(),
    component: 'skills-bootstrap',
    event: 'bootstrap.trigger',
    command: params.command,
    cwd: params.cwd,
    pkgVersion: params.pkgVersion,
  });
}

async function countCopiedFiles(root: string): Promise<number> {
  const stat = await fs.lstat(root).catch(() => null);
  if (!stat) {
    return 0;
  }

  if (!stat.isDirectory()) {
    return stat.isFile() ? 1 : 0;
  }

  let count = 0;
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '__pycache__') {
      continue;
    }

    count += await countCopiedFiles(path.join(root, entry.name));
  }

  return count;
}

async function copyTier(sourceRoot: string, targetRoot: string): Promise<number> {
  await fs.remove(targetRoot);
  await fs.copy(sourceRoot, targetRoot, { filter: COPY_FILTER });
  return countCopiedFiles(targetRoot);
}

export async function ensureGlobalSkillsBootstrapped(pkgRoot: string, opts: BootstrapOptions = {}): Promise<BootstrapResult> {
  const pkgJsonPath = path.join(pkgRoot, 'package.json');
  const pkgJson = await fs.readJson(pkgJsonPath) as { version?: string };
  const installedVersion = pkgJson.version;

  if (!installedVersion) {
    throw new Error(`Failed to read package version from ${pkgJsonPath}.`);
  }

  const globalSkillsRoot = resolveGlobalSkillsRoot();
  const statePath = resolveStateFilePath(globalSkillsRoot);
  const sourceRoot = path.join(pkgRoot, '.xtrm', 'skills');
  const targetRoot = globalSkillsRoot;
  const startedAt = Date.now();

  await appendLog({
    timestamp: new Date().toISOString(),
    component: 'skills-bootstrap',
    event: 'bootstrap.start',
    pkgVersion: installedVersion,
    source: formatLogPath(sourceRoot),
    target: formatLogPath(targetRoot),
    filesCopied: 0,
    durationMs: 0,
    outcome: 'ok',
  });

  try {
    const currentState = await readSkillsState(globalSkillsRoot);
    if (!opts.force && currentState.installedVersion === installedVersion) {
      await appendLog({
        timestamp: new Date().toISOString(),
        component: 'skills-bootstrap',
        event: 'bootstrap.ok',
        pkgVersion: installedVersion,
        source: formatLogPath(sourceRoot),
        target: formatLogPath(targetRoot),
        filesCopied: 0,
        durationMs: Date.now() - startedAt,
        outcome: 'skipped',
      });
      return { installedVersion, changed: false };
    }

    let filesCopied = 0;
    for (const asset of ['default', 'optional'] as const) {
      const assetSource = path.join(sourceRoot, asset);
      const assetTarget = path.join(targetRoot, asset);
      const assetStartedAt = Date.now();
      const copied = await copyTier(assetSource, assetTarget);
      filesCopied += copied;

      await appendLog({
        timestamp: new Date().toISOString(),
        component: 'skills-bootstrap',
        event: `bootstrap.copy.${asset}`,
        pkgVersion: installedVersion,
        source: formatLogPath(assetSource),
        target: formatLogPath(assetTarget),
        filesCopied: copied,
        durationMs: Date.now() - assetStartedAt,
        outcome: 'ok',
      });
    }

    await rebuildGlobalActiveView(globalSkillsRoot);

    const currentStateForMetadata = await readSkillsState(globalSkillsRoot);
    await fs.writeJson(statePath, {
      schemaVersion: SKILLS_STATE_SCHEMA_VERSION,
      enabledPacks: currentStateForMetadata.enabledPacks,
      installedVersion,
      installedFrom: formatLogPath(pkgRoot),
      installedAt: new Date().toISOString(),
    }, { spaces: 2 });
    await fs.appendFile(statePath, '\n');

    await appendLog({
      timestamp: new Date().toISOString(),
      component: 'skills-bootstrap',
      event: 'bootstrap.ok',
      pkgVersion: installedVersion,
      source: formatLogPath(sourceRoot),
      target: formatLogPath(targetRoot),
      filesCopied,
      durationMs: Date.now() - startedAt,
      outcome: 'ok',
    });

    return { installedVersion, changed: true };
  } catch (error) {
    await appendLog({
      timestamp: new Date().toISOString(),
      component: 'skills-bootstrap',
      event: 'bootstrap.error',
      pkgVersion: installedVersion,
      source: formatLogPath(sourceRoot),
      target: formatLogPath(targetRoot),
      filesCopied: 0,
      durationMs: Date.now() - startedAt,
      outcome: 'error',
    });
    throw error;
  }
}
