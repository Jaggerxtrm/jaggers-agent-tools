// nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- runs the vendored python migrator; args are project-derived (basename + constant path + readdir pack name), never user-controllable.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'fs-extra';
import { RESERVED_PACK_NAMES } from './skills-layout.js';

/**
 * Registry-gated, idempotent service-skills migration runner.
 *
 * Makes `xt update --apply` (and `xt init`) the FOOLPROOF, single-button path to
 * the service-skills v2 layout: when a repo has a service-registry (any layout),
 * run the one-time layout migrator (flat → per-repo umbrella, relocate + rewrite
 * the registry, generate the umbrella). It is a no-op in repos with no
 * service-registry, and idempotent on already-migrated repos.
 *
 * Claude/Pi activation hooks ship via the global service-skills policies and are
 * reconciled into settings.json by claude-runtime-sync (xtrm-0p7bp). This module
 * owns the data migration AND wires the local git post-merge drift sweep (the
 * post-merge reconciliation trigger, xtrm-jcmub) on the same foolproof path.
 */

const PACKS_REL = path.join('.xtrm', 'skills', 'user', 'packs');
const FLAT_PACKS_REL = path.join('.xtrm', 'skills');
const MIGRATOR_REL = path.join('.xtrm', 'skills', 'default', 'service-skills', 'scripts', 'layout_migrator.py');
const INSTALLER_REL = path.join('.xtrm', 'skills', 'default', 'service-skills', 'install', 'install-service-skills.py');

export interface ServiceSkillsEnsureResult {
  /** Whether the repo has a service-registry (i.e. service-skills apply here). */
  readonly applicable: boolean;
  /** Packs migrated to the umbrella layout on this run. */
  readonly migratedPacks: string[];
  /** True when nothing needed migrating (no-op / already current). */
  readonly alreadyCurrent: boolean;
  /** Human-readable notes (migrator output, warnings, refusals). */
  readonly notes: string[];
}

async function syncPackMetadata(packPath: string, metadata: Record<string, unknown>): Promise<void> {
  const entries = await fs.readdir(packPath, { withFileTypes: true });
  const skills: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (await fs.pathExists(path.join(packPath, entry.name, 'SKILL.md'))) skills.push(entry.name);
  }
  metadata.skills = skills.sort((left, right) => left.localeCompare(right));
  await fs.writeJson(path.join(packPath, 'PACK.json'), metadata, { spaces: 2 });
}

async function packsWithRegistry(projectRoot: string): Promise<string[]> {
  const packRoots = [path.join(projectRoot, PACKS_REL), path.join(projectRoot, FLAT_PACKS_REL)];
  const packs = new Set<string>();
  for (const packsRoot of packRoots) {
    if (!await fs.pathExists(packsRoot)) continue;
    const entries = await fs.readdir(packsRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || RESERVED_PACK_NAMES.has(entry.name)) continue;
      const packPath = path.join(packsRoot, entry.name);
      const hasUmbrellaRegistry = await fs.pathExists(path.join(packPath, 'service-skills', 'service-registry.json'));
      const hasFlatRegistry = await fs.pathExists(path.join(packPath, 'service-registry.json'));
      if (hasUmbrellaRegistry || hasFlatRegistry) packs.add(entry.name);
    }
  }
  return [...packs].sort((left, right) => left.localeCompare(right));
}

/** True when the repo has any service-registry (pack, root, or legacy .claude). */
export async function hasServiceRegistry(projectRoot: string): Promise<boolean> {
  if ((await packsWithRegistry(projectRoot)).length > 0) {
    return true;
  }
  return (await fs.pathExists(path.join(projectRoot, 'service-registry.json')))
    || (await fs.pathExists(path.join(projectRoot, '.claude', 'skills', 'service-registry.json')));
}

export async function ensureServiceSkills(
  projectRoot: string,
  opts: { apply: boolean },
): Promise<ServiceSkillsEnsureResult> {
  const notes: string[] = [];
  const migratedPacks: string[] = [];

  const packs = await packsWithRegistry(projectRoot);
  const applicable = packs.length > 0 || await hasServiceRegistry(projectRoot);
  if (!applicable) {
    // No service-registry → service-skills do not apply here. Silent no-op.
    return { applicable: false, migratedPacks, alreadyCurrent: true, notes };
  }

  const migrator = path.join(projectRoot, MIGRATOR_REL);
  if (!await fs.pathExists(migrator)) {
    notes.push('service-skills machinery not installed yet — skills must be installed (xt update) before migration.');
    return { applicable: true, migratedPacks, alreadyCurrent: true, notes };
  }

  if (!opts.apply) {
    notes.push(`service-skills migration available (dry-run) for pack(s): ${packs.join(', ') || '(root/legacy registry)'}.`);
    return { applicable: true, migratedPacks, alreadyCurrent: true, notes };
  }

  const repoName = path.basename(projectRoot);
  const targetPacks = packs.length > 0 ? packs : [''];
  for (const pack of targetPacks) {
    const packPath = pack ? path.join(projectRoot, PACKS_REL, pack) : '';
    const packJsonPath = packPath ? path.join(packPath, 'PACK.json') : '';
    const originalPackMetadata = packJsonPath && await fs.pathExists(packJsonPath)
      ? await fs.readJson(packJsonPath).catch(() => null) as Record<string, unknown> | null
      : null;
    // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
    const run = spawnSync('python3', [migrator, repoName], {
      cwd: projectRoot,
      encoding: 'utf8',
      // Pass the project root explicitly (the CLI knows it) so the migrator never
      // depends on a git checkout; scope to the pack being migrated.
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: projectRoot,
        ...(pack ? { XTRM_PACK: pack } : {}),
      },
    });
    const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
    if (run.status === 2) {
      notes.push(`service-skills: pack '${pack}' migration refused — ${(run.stderr ?? '').trim()}`);
      continue;
    }
    if (run.status === 0 && packPath && originalPackMetadata && !Array.isArray(originalPackMetadata)) {
      await syncPackMetadata(packPath, originalPackMetadata);
      notes.push(`service-skills: synced PACK.json for '${pack}'.`);
    }
    const lines = output.split('\n');
    if (lines.some(line => line.startsWith('migrated:'))) {
      migratedPacks.push(pack || repoName);
    }
    for (const line of lines) {
      if (line.startsWith('migrated:') || line.startsWith('umbrella:') || line.startsWith('registry:') || line.includes('WARNING')) {
        notes.push(`service-skills: ${line.trim()}`);
      }
    }
  }

  if (migratedPacks.length > 0) notes.push('service-skills: runtime links reconciled on next update pass.');

  // Wire the local git post-merge drift sweep (xtrm-jcmub) on the foolproof path.
  // Registry-gated (we only reach here when applicable). Idempotent — marker-guarded
  // installer; a no-op on repos that already have it. Never fails the update.
  await ensurePostMergeDriftHook(projectRoot, notes);

  return { applicable: true, migratedPacks, alreadyCurrent: migratedPacks.length === 0, notes };
}

/**
 * Install the service-skills git hooks (including the post-merge drift sweep) via the
 * vendored installer's `--hooks-only` mode. Best-effort and idempotent: any failure is
 * recorded as a note and never aborts `xt update`.
 */
async function ensurePostMergeDriftHook(projectRoot: string, notes: string[]): Promise<void> {
  const installer = path.join(projectRoot, INSTALLER_REL);
  if (!await fs.pathExists(installer)) {
    return;
  }
  // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
  const run = spawnSync('python3', [installer, '--hooks-only'], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectRoot },
  });
  if (run.status !== 0) {
    notes.push(`service-skills: post-merge drift hook wiring skipped — ${(run.stderr ?? '').trim() || 'installer error'}`);
  }
}
