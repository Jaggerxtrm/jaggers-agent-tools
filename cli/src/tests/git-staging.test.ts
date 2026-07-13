import { spawnSync } from 'node:child_process';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ensureRuntimeGitignoreBlock,
  stageMigrationChanges,
  stageTrackedChanges,
  untrackRuntimePaths,
} from '../utils/git-staging.js';

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await fs.remove(dir);
  }
});

function gitInit(repoRoot: string): void {
  spawnSync('git', ['-C', repoRoot, 'init', '-q', '-b', 'main'], { stdio: 'pipe' });
  spawnSync('git', ['-C', repoRoot, 'config', 'user.email', 'test@example.com'], { stdio: 'pipe' });
  spawnSync('git', ['-C', repoRoot, 'config', 'user.name', 'Test'], { stdio: 'pipe' });
  spawnSync('git', ['-C', repoRoot, 'config', 'commit.gpgsign', 'false'], { stdio: 'pipe' });
}

function gitCommitAll(repoRoot: string, msg: string): void {
  spawnSync('git', ['-C', repoRoot, 'add', '-A'], { stdio: 'pipe' });
  spawnSync('git', ['-C', repoRoot, 'commit', '-q', '--no-verify', '-m', msg], { stdio: 'pipe' });
}

async function mkTemp(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe('git-staging', () => {
  it('stageTrackedChanges no-ops on non-git dirs', async () => {
    const repoRoot = await mkTemp('xtrm-stage-nongit-');
    const result = stageTrackedChanges(repoRoot);
    expect(result.staged).toBe(false);
    expect(result.skipped).toBe('not-a-git-repo');
  });

  it('stageTrackedChanges honors dryRun', async () => {
    const repoRoot = await mkTemp('xtrm-stage-dryrun-');
    gitInit(repoRoot);
    await fs.writeFile(path.join(repoRoot, 'a.txt'), 'hello');
    gitCommitAll(repoRoot, 'init');
    await fs.writeFile(path.join(repoRoot, 'a.txt'), 'world');
    const result = stageTrackedChanges(repoRoot, { dryRun: true });
    expect(result.staged).toBe(false);
    expect(result.skipped).toBe('dry-run');
    // Should not have staged anything.
    const cached = spawnSync('git', ['-C', repoRoot, 'diff', '--cached', '--name-only'], { encoding: 'utf8' });
    expect(cached.stdout.trim()).toBe('');
  });

  it('stageTrackedChanges stages modifications and deletions', async () => {
    const repoRoot = await mkTemp('xtrm-stage-mods-');
    gitInit(repoRoot);
    await fs.writeFile(path.join(repoRoot, 'a.txt'), 'a');
    await fs.writeFile(path.join(repoRoot, 'b.txt'), 'b');
    gitCommitAll(repoRoot, 'init');
    await fs.writeFile(path.join(repoRoot, 'a.txt'), 'A');
    await fs.remove(path.join(repoRoot, 'b.txt'));
    const result = stageTrackedChanges(repoRoot);
    expect(result.staged).toBe(true);
    expect(result.filesStaged).toBe(2);
    const cached = spawnSync('git', ['-C', repoRoot, 'diff', '--cached', '--name-only'], { encoding: 'utf8' });
    const files = cached.stdout.trim().split('\n').sort();
    expect(files).toEqual(['a.txt', 'b.txt']);
  });

  it('stageTrackedChanges returns nothing-to-stage on clean tree', async () => {
    const repoRoot = await mkTemp('xtrm-stage-clean-');
    gitInit(repoRoot);
    await fs.writeFile(path.join(repoRoot, 'a.txt'), 'a');
    gitCommitAll(repoRoot, 'init');
    const result = stageTrackedChanges(repoRoot);
    expect(result.staged).toBe(false);
    expect(result.skipped).toBe('nothing-to-stage');
  });

  it('ensureRuntimeGitignoreBlock is idempotent', async () => {
    const repoRoot = await mkTemp('xtrm-gitignore-');
    const first = await ensureRuntimeGitignoreBlock(repoRoot);
    expect(first.written).toBe(true);
    const second = await ensureRuntimeGitignoreBlock(repoRoot);
    expect(second.written).toBe(false);
    const content = await fs.readFile(path.join(repoRoot, '.gitignore'), 'utf8');
    expect(content).toContain('.xtrm/skills/state.json');
    expect(content).toContain('.xtrm/worktrees/');
    expect(content).toContain('.pi/skills/');
    expect(content).toContain('.xtrm/cache/');
    expect(content).toContain('.xtrm/statusline-claim');
  });

  it('ensureRuntimeGitignoreBlock preserves existing entries', async () => {
    const repoRoot = await mkTemp('xtrm-gitignore-preserve-');
    const initial = 'node_modules/\n.env\n';
    await fs.writeFile(path.join(repoRoot, '.gitignore'), initial);
    await ensureRuntimeGitignoreBlock(repoRoot);
    const content = await fs.readFile(path.join(repoRoot, '.gitignore'), 'utf8');
    expect(content).toContain('node_modules/');
    expect(content).toContain('.env');
    expect(content).toContain('.xtrm/skills/state.json');
  });

  it('untrackRuntimePaths removes tracked runtime files', async () => {
    const repoRoot = await mkTemp('xtrm-untrack-');
    gitInit(repoRoot);
    await fs.ensureDir(path.join(repoRoot, '.xtrm', 'skills'));
    await fs.writeFile(path.join(repoRoot, '.xtrm', 'skills', 'state.json'), '{}');
    await fs.writeFile(path.join(repoRoot, 'src.js'), 'code');
    gitCommitAll(repoRoot, 'init');

    const result = untrackRuntimePaths(repoRoot, ['.xtrm/skills/state.json']);
    expect(result.untracked).toEqual(['.xtrm/skills/state.json']);
    // Working tree file preserved.
    expect(await fs.pathExists(path.join(repoRoot, '.xtrm', 'skills', 'state.json'))).toBe(true);
    // Source file untouched in index.
    const ls = spawnSync('git', ['-C', repoRoot, 'ls-files'], { encoding: 'utf8' });
    expect(ls.stdout).toContain('src.js');
    expect(ls.stdout).not.toContain('state.json');
  });

  it('untrackRuntimePaths no-ops when nothing is tracked', async () => {
    const repoRoot = await mkTemp('xtrm-untrack-noop-');
    gitInit(repoRoot);
    const result = untrackRuntimePaths(repoRoot, ['.xtrm/skills/state.json']);
    expect(result.untracked).toEqual([]);
  });

  it('stageMigrationChanges: happy path stages, untracks, gitignores', async () => {
    const repoRoot = await mkTemp('xtrm-stagemig-');
    gitInit(repoRoot);
    // Seed tracked files: one runtime state (to be untracked), one source
    // file that will be modified.
    await fs.ensureDir(path.join(repoRoot, '.xtrm', 'skills'));
    await fs.writeFile(path.join(repoRoot, '.xtrm', 'skills', 'state.json'), '{}');
    await fs.ensureDir(path.join(repoRoot, '.claude'));
    await fs.writeFile(path.join(repoRoot, '.claude', 'settings.json'), 'v1');
    gitCommitAll(repoRoot, 'init');

    // Simulate xt update mutation
    await fs.writeFile(path.join(repoRoot, '.claude', 'settings.json'), 'v2');

    const result = await stageMigrationChanges(repoRoot);
    expect(result.gitignoreWritten).toBe(true);
    expect(result.untracked).toContain('.xtrm/skills/state.json');
    // 1 M (.claude/settings.json) + 1 D (untracked state.json shows as staged)
    expect(result.filesStaged).toBeGreaterThanOrEqual(1);

    // Verify staged state.
    const cached = spawnSync('git', ['-C', repoRoot, 'diff', '--cached', '--name-only'], { encoding: 'utf8' });
    const files = cached.stdout.trim().split('\n');
    expect(files).toContain('.claude/settings.json');
    expect(files).toContain('.gitignore');
  });

  it('stageMigrationChanges is safe on non-git dirs', async () => {
    const repoRoot = await mkTemp('xtrm-stagemig-nongit-');
    const result = await stageMigrationChanges(repoRoot);
    // Gitignore should still be written even without git — templating is
    // filesystem-only.
    expect(result.gitignoreWritten).toBe(true);
    expect(result.untracked).toEqual([]);
    expect(result.filesStaged).toBe(0);
    expect(result.skipped).toBe('not-a-git-repo');
  });

  it('stageMigrationChanges honors dryRun', async () => {
    const repoRoot = await mkTemp('xtrm-stagemig-dry-');
    gitInit(repoRoot);
    await fs.writeFile(path.join(repoRoot, 'a.txt'), 'a');
    gitCommitAll(repoRoot, 'init');
    await fs.writeFile(path.join(repoRoot, 'a.txt'), 'A');
    const result = await stageMigrationChanges(repoRoot, { dryRun: true });
    expect(result.gitignoreWritten).toBe(false);
    expect(result.filesStaged).toBe(0);
    // Not staged.
    const cached = spawnSync('git', ['-C', repoRoot, 'diff', '--cached', '--name-only'], { encoding: 'utf8' });
    expect(cached.stdout.trim()).toBe('');
  });
});
