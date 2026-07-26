import { readFileSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

// The three xtrm packages an operator/agent may need to keep current.
// This is the single source of truth — both `xt version --check-updates`
// and the `xt doctor` "updates" row iterate this list.
export const XTRM_PACKAGES = [
  'xtrm-tools',
  '@jaggerxtrm/xtmux',
  '@jaggerxtrm/specialists',
] as const;
export type XtrmPackage = typeof XTRM_PACKAGES[number];

export type UpdateState = 'ok' | 'stale' | 'unknown' | 'not-installed';

export interface PackageStatus {
  pkg: XtrmPackage;
  installed: string | null;
  latest: string | null;
  state: UpdateState;
  fromCache: boolean;
  cacheAgeMs: number | null;
}

export interface CheckOptions {
  noCache?: boolean;
  cacheFile?: string;
  npmView?: (pkg: string) => string | null;
  installedResolver?: (pkg: XtrmPackage) => string | null;
  ttlMs?: number;
  now?: () => number;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const NPM_VIEW_TIMEOUT_MS = 5000;
const NPMJS_REGISTRY = 'https://registry.npmjs.org';

interface CacheEntry { latest: string; fetchedAt: number }
type CacheShape = Record<string, CacheEntry>;

export function defaultCacheFile(): string {
  return path.join(os.homedir(), '.xtrm', 'cache', 'npm-latest.json');
}

function readCache(file: string): CacheShape {
  try {
    const raw = readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as CacheShape;
    return {};
  } catch {
    // Missing, unreadable, or corrupt → treat as empty. A subsequent write overwrites it.
    return {};
  }
}

function writeCache(file: string, data: CacheShape): void {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(data, null, 2));
  } catch {
    // Cache is a best-effort optimisation — failure to persist must not fail the caller.
  }
}

function defaultNpmView(pkg: string): string | null {
  const result = spawnSync('npm', ['view', pkg, 'version', '--registry', NPMJS_REGISTRY], {
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: NPM_VIEW_TIMEOUT_MS,
  });
  if (result.status !== 0) return null;
  const v = (result.stdout ?? '').trim();
  return v.length > 0 ? v : null;
}

// Resolve the installed version of a global npm package by reading its
// package.json under `npm root -g`. Dangling symlinks and unreadable
// package.json files (e.g. an `npm link` to a removed worktree) resolve
// to null instead of throwing.
function defaultInstalledResolver(pkg: XtrmPackage): string | null {
  const rootResult = spawnSync('npm', ['root', '-g'], {
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: NPM_VIEW_TIMEOUT_MS,
  });
  if (rootResult.status !== 0) return null;
  const globalRoot = (rootResult.stdout ?? '').trim();
  if (!globalRoot) return null;
  const packageJsonPath = path.join(globalRoot, pkg, 'package.json');
  try {
    statSync(packageJsonPath);
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : null;
  } catch {
    return null;
  }
}

function classify(installed: string | null, latest: string | null): UpdateState {
  if (installed === null) return 'not-installed';
  if (latest === null) return 'unknown';
  return installed === latest ? 'ok' : 'stale';
}

export function checkXtrmUpdates(opts: CheckOptions = {}): PackageStatus[] {
  const cacheFile = opts.cacheFile ?? defaultCacheFile();
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const now = opts.now ? opts.now() : Date.now();
  const npmView = opts.npmView ?? defaultNpmView;
  const installedResolver = opts.installedResolver ?? defaultInstalledResolver;

  const cache = opts.noCache ? {} : readCache(cacheFile);
  const nextCache: CacheShape = { ...cache };
  const statuses: PackageStatus[] = [];
  let cacheDirty = false;

  for (const pkg of XTRM_PACKAGES) {
    const installed = installedResolver(pkg);
    const cached = cache[pkg];
    const cacheFresh = !opts.noCache && cached && (now - cached.fetchedAt) < ttlMs;
    let latest: string | null;
    let fromCache: boolean;
    let cacheAgeMs: number | null;

    let expiredCacheFallback = false;
    if (cacheFresh) {
      latest = cached.latest;
      fromCache = true;
      cacheAgeMs = now - cached.fetchedAt;
    } else {
      latest = npmView(pkg);
      fromCache = false;
      if (latest !== null) {
        nextCache[pkg] = { latest, fetchedAt: now };
        cacheDirty = true;
        cacheAgeMs = 0;
      } else if (cached) {
        // Expired cache + failed lookup: show the cached value for information,
        // but do NOT let it flow into classify() as truth — we can't assert
        // freshness we didn't verify. State stays 'unknown'; the row still
        // renders the last-known latest so an operator sees "was 3.0.0, cache 48h old".
        latest = cached.latest;
        fromCache = true;
        cacheAgeMs = now - cached.fetchedAt;
        expiredCacheFallback = true;
      } else {
        cacheAgeMs = null;
      }
    }

    const state: UpdateState = expiredCacheFallback ? (installed === null ? 'not-installed' : 'unknown') : classify(installed, latest);
    statuses.push({ pkg, installed, latest, state, fromCache, cacheAgeMs });
  }

  if (cacheDirty && !opts.noCache) writeCache(cacheFile, nextCache);
  return statuses;
}

export function formatUpdateRows(statuses: PackageStatus[]): string[] {
  const width = Math.max(...XTRM_PACKAGES.map((p) => p.length));
  return statuses.map((s) => {
    const installed = s.installed ?? 'not-installed';
    const latest = s.latest ?? 'unknown';
    return `${s.pkg.padEnd(width)}  installed=${installed}  latest=${latest}  [${s.state}]`;
  });
}

export function updatesSummary(statuses: PackageStatus[]): { stale: number; unknown: number; notInstalled: number } {
  return statuses.reduce((acc, s) => {
    if (s.state === 'stale') acc.stale += 1;
    else if (s.state === 'unknown') acc.unknown += 1;
    else if (s.state === 'not-installed') acc.notInstalled += 1;
    return acc;
  }, { stale: 0, unknown: 0, notInstalled: 0 });
}
