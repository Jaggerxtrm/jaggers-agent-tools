import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  spawnSync: vi.fn(),
  ensureAgentsSkillsSymlink: vi.fn(async () => undefined),
}));

vi.mock('node:child_process', () => ({
  spawnSync: mocked.spawnSync,
}));

vi.mock('../core/skills-scaffold.js', () => ({
  ensureAgentsSkillsSymlink: mocked.ensureAgentsSkillsSymlink,
}));

describe('worktree session bare-mode slash guard', () => {
  let tempRoot = '';
  let previousCwd = '';
  let previousHome: string | undefined;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'xtrm-worktree-bare-slash-'));
    previousCwd = process.cwd();
    previousHome = process.env.HOME;
    mocked.spawnSync.mockReset();
    mocked.ensureAgentsSkillsSymlink.mockReset();
    mocked.ensureAgentsSkillsSymlink.mockResolvedValue(undefined);
    vi.resetModules();
  });

  afterEach(async () => {
    process.chdir(previousCwd);
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    await fs.remove(tempRoot);
    vi.restoreAllMocks();
  });

  function mockProcessExit(): ReturnType<typeof vi.spyOn> {
    return vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
      throw new Error(`exit:${code ?? 0}`) as never;
    });
  }

  // Fail the first git worktree add so the launcher exits cleanly AFTER the
  // composition/slash-guard phase. Any exit here proves we crossed composition
  // without the guard rejecting.
  function mockGitWorktreeAddFails(): ReturnType<typeof vi.spyOn> {
    mocked.spawnSync.mockImplementation((command: string, args: string[] = []) => {
      if (command === 'git' && args[0] === 'worktree' && args[1] === 'add') {
        return { status: 1, stdout: '', stderr: 'mock-worktree-add-fail', pid: 0, output: [], signal: null };
      }
      return { status: 0, stdout: '', stderr: '', pid: 0, output: [], signal: null };
    });
    return vi.spyOn(console, 'error').mockImplementation(() => {});
  }

  it('accepts bare-mode Claude --prompt starting with /<name> (sanctioned skill-load pattern)', async () => {
    const repoRoot = path.join(tempRoot, 'repo');
    process.env.HOME = path.join(tempRoot, 'home');
    await fs.ensureDir(repoRoot);
    process.chdir(repoRoot);

    const errorSpy = mockGitWorktreeAddFails();
    mockProcessExit();
    const { launchWorktreeSession } = await import('../utils/worktree-session.js');

    await expect(launchWorktreeSession({
      runtime: 'claude',
      sessionSlug: 'bare-claude-slash',
      prompt: '/multiplexing leggi /tmp/foo.txt e seguilo',
    })).rejects.toThrow(/exit:/);

    const errorOutput = errorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(errorOutput).not.toMatch(/starts with '\/'/);
    expect(errorOutput).not.toMatch(/no '.*' prefix/);
  });

  it('accepts bare-mode pi --prompt starting with /skill:<name>', async () => {
    const repoRoot = path.join(tempRoot, 'repo');
    process.env.HOME = path.join(tempRoot, 'home');
    await fs.ensureDir(repoRoot);
    process.chdir(repoRoot);

    const errorSpy = mockGitWorktreeAddFails();
    mockProcessExit();
    const { launchWorktreeSession } = await import('../utils/worktree-session.js');

    await expect(launchWorktreeSession({
      runtime: 'pi',
      sessionSlug: 'bare-pi-slash',
      prompt: '/skill:multiplexing leggi /tmp/foo.txt e seguilo',
    })).rejects.toThrow(/exit:/);

    const errorOutput = errorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(errorOutput).not.toMatch(/starts with '\/'/);
    expect(errorOutput).not.toMatch(/no '.*' prefix/);
  });

  it('bare-mode --prompt without leading slash still passes composition', async () => {
    // Regression: don't accidentally break plain --prompt.
    const repoRoot = path.join(tempRoot, 'repo');
    process.env.HOME = path.join(tempRoot, 'home');
    await fs.ensureDir(repoRoot);
    process.chdir(repoRoot);

    const errorSpy = mockGitWorktreeAddFails();
    mockProcessExit();
    const { launchWorktreeSession } = await import('../utils/worktree-session.js');

    await expect(launchWorktreeSession({
      runtime: 'claude',
      sessionSlug: 'bare-plain',
      prompt: 'plain operator prompt without slash',
    })).rejects.toThrow(/exit:/);

    const errorOutput = errorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(errorOutput).not.toMatch(/starts with '\/'/);
  });
});
