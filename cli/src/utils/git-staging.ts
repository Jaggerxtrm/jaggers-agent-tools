import { spawnSync } from 'node:child_process';
import fs from 'fs-extra';
import fsSync from 'node:fs';
import path from 'node:path';

// xtrm-utdq1: prevent fleet-wide dirty-state accumulation. xt migrate/update
// modify tracked files (retire .xtrm/skills/default/, adopt v0.10.4 hook paths).
// Without staging, every operator opens the repo to ~300 unstaged D lines and
// has to run the cleanup manually. These helpers stage the changes with a
// canonical scope; they never commit and never push — the operator retains
// ownership of when to persist.

const RUNTIME_GITIGNORE_BLOCK = [
  '',
  '# xtrm runtime state (per-machine, do not track)',
  '.xtrm/skills/state.json',
  '.xtrm/worktrees/',
  '.xtrm/cache/',
  '.xtrm/statusline-claim',
  '.pi/skills/',
].join('\n');

const RUNTIME_GITIGNORE_MARKER = '# xtrm runtime state (per-machine, do not track)';

function isGitRepo(repoPath: string): boolean {
  const result = spawnSync('git', ['-C', repoPath, 'rev-parse', '--is-inside-work-tree'], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
  return result.status === 0 && result.stdout.trim() === 'true';
}

function runGit(repoPath: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync('git', ['-C', repoPath, ...args], { encoding: 'utf8', stdio: 'pipe' });
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

export interface StageResult {
  readonly staged: boolean;
  readonly filesStaged: number;
  readonly skipped: 'not-a-git-repo' | 'dry-run' | 'nothing-to-stage' | undefined;
}

// Pathspecs xtrm owns. Staging is restricted to these so users' unrelated
// in-flight tracked mods (e.g. src/foo.ts mid-refactor) NEVER get swept
// into an xtrm-generated commit (xtrm-irzid).
export const XTRM_MANAGED_PATHSPECS: readonly string[] = [
  '.xtrm/',
  '.claude/',
  '.pi/',
  '.githooks/',
];

// Stage tracked modifications and deletions restricted to the given pathspecs
// (defaults to xtrm-managed paths). Safe: no-ops on non-git repos, dry-runs,
// or when nothing under the pathspecs is dirty. Never commits.
export function stageTrackedChanges(
  repoPath: string,
  opts: { dryRun?: boolean; pathspecs?: readonly string[] } = {},
): StageResult {
  if (opts.dryRun) {
    return { staged: false, filesStaged: 0, skipped: 'dry-run' };
  }
  if (!isGitRepo(repoPath)) {
    return { staged: false, filesStaged: 0, skipped: 'not-a-git-repo' };
  }

  // Filter pathspecs to those that actually exist under repoPath — git errors
  // on 'pathspec did not match any files' otherwise. This is common in real
  // consumer repos (e.g. no .githooks/, no .pi/).
  const pathspecs = (opts.pathspecs ?? XTRM_MANAGED_PATHSPECS).filter((spec) =>
    fsSync.existsSync(path.join(repoPath, spec.replace(/\/$/, ''))),
  );

  if (pathspecs.length === 0) {
    return { staged: false, filesStaged: 0, skipped: 'nothing-to-stage' };
  }

  const before = runGit(repoPath, ['diff', '--cached', '--name-only']);
  const beforeCount = before.stdout.trim() ? before.stdout.trim().split('\n').length : 0;

  // Run per-pathspec: `git add -u -- <spec>` errors out if <spec> has no tracked
  // files at all (common after we've just git rm --cached'd everything under
  // .xtrm/ in a mostly-empty test / edge-case repo). Tolerating per-spec means
  // one dry pathspec doesn't take out the others.
  for (const spec of pathspecs) {
    runGit(repoPath, ['add', '-u', '--', spec]);
  }

  const after = runGit(repoPath, ['diff', '--cached', '--name-only']);
  const afterCount = after.stdout.trim() ? after.stdout.trim().split('\n').length : 0;
  const delta = Math.max(0, afterCount - beforeCount);

  if (delta === 0) {
    return { staged: false, filesStaged: 0, skipped: 'nothing-to-stage' };
  }
  return { staged: true, filesStaged: delta, skipped: undefined };
}

// Untrack runtime paths from the index (git rm --cached). Idempotent — no-ops
// for paths not tracked. Callers must ensure the paths are known runtime state
// (e.g. .xtrm/skills/state.json, .xtrm/worktrees/*), never source files.
export function untrackRuntimePaths(
  repoPath: string,
  runtimePaths: readonly string[],
  opts: { dryRun?: boolean } = {},
): { untracked: string[] } {
  if (opts.dryRun || !isGitRepo(repoPath)) {
    return { untracked: [] };
  }
  const untracked: string[] = [];
  for (const runtimePath of runtimePaths) {
    const ls = runGit(repoPath, ['ls-files', '--', runtimePath]);
    if (ls.status !== 0 || !ls.stdout.trim()) {
      continue;
    }
    const files = ls.stdout.trim().split('\n');
    for (const file of files) {
      const rm = runGit(repoPath, ['rm', '--cached', '--quiet', '--', file]);
      if (rm.status === 0) {
        untracked.push(file);
      }
    }
  }
  return { untracked };
}

// Ensure .gitignore contains the canonical xtrm runtime block. Idempotent —
// detects the marker and skips if already present. Returns true if the file
// was written. Callers must stage the .gitignore separately if they want it
// in the same commit as other staged changes.
export async function ensureRuntimeGitignoreBlock(
  repoPath: string,
  opts: { dryRun?: boolean } = {},
): Promise<{ written: boolean }> {
  if (opts.dryRun) {
    return { written: false };
  }
  const gitignorePath = path.join(repoPath, '.gitignore');
  const existing = (await fs.pathExists(gitignorePath))
    ? await fs.readFile(gitignorePath, 'utf8')
    : '';
  if (existing.includes(RUNTIME_GITIGNORE_MARKER)) {
    return { written: false };
  }
  const nextContent = existing.endsWith('\n') || existing === ''
    ? existing + RUNTIME_GITIGNORE_BLOCK + '\n'
    : existing + '\n' + RUNTIME_GITIGNORE_BLOCK + '\n';
  await fs.writeFile(gitignorePath, nextContent);
  return { written: true };
}

// Stage the .gitignore itself if it was modified. Small helper so callers
// can chain ensureRuntimeGitignoreBlock -> stageGitignore.
export function stageGitignore(repoPath: string, opts: { dryRun?: boolean } = {}): boolean {
  if (opts.dryRun || !isGitRepo(repoPath)) {
    return false;
  }
  const result = runGit(repoPath, ['add', '--', '.gitignore']);
  return result.status === 0;
}

// Convenience: full post-migration git housekeeping in one call.
// 1. Ensure runtime gitignore block.
// 2. Untrack known runtime paths from the index.
// 3. Stage remaining tracked modifications (D/M).
// 4. Stage the .gitignore file itself.
// Never commits. Emits a small summary via the returned counts.
export async function stageMigrationChanges(
  repoPath: string,
  opts: { dryRun?: boolean } = {},
): Promise<{ gitignoreWritten: boolean; untracked: string[]; filesStaged: number; skipped?: StageResult['skipped'] }> {
  const { written: gitignoreWritten } = await ensureRuntimeGitignoreBlock(repoPath, opts);
  const runtimePaths = [
    '.xtrm/skills/state.json',
    '.xtrm/worktrees/',
    '.pi/skills/',
    '.xtrm/cache/',
    '.xtrm/statusline-claim',
  ];
  // Order matters: stage tracked mods FIRST, then untrack runtime paths.
  // Doing untrack first can leave a pathspec (e.g. .xtrm/) with no tracked
  // files, and `git add -u -- .xtrm/` then errors and skips staging the rest.
  const stage = stageTrackedChanges(repoPath, opts);
  const { untracked } = untrackRuntimePaths(repoPath, runtimePaths, opts);
  if (gitignoreWritten) {
    stageGitignore(repoPath, opts);
  }
  return {
    gitignoreWritten,
    untracked,
    filesStaged: stage.filesStaged + untracked.length,
    skipped: stage.skipped,
  };
}
