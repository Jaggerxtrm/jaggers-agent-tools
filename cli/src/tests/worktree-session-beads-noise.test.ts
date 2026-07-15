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

describe('worktree session .beads handling (no symlink; skip-worktree only)', () => {
  let tempRoot = '';
  let previousCwd = '';

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'xtrm-worktree-beads-'));
    previousCwd = process.cwd();
    mocked.spawnSync.mockReset();
    mocked.ensureAgentsSkillsSymlink.mockReset();
    mocked.ensureAgentsSkillsSymlink.mockResolvedValue(undefined);
    vi.resetModules();
  });

  afterEach(async () => {
    process.chdir(previousCwd);
    await fs.remove(tempRoot);
    vi.restoreAllMocks();
  });

  function mockProcessExit(): ReturnType<typeof vi.spyOn> {
    return vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
      throw new Error(`exit:${code ?? 0}`) as never;
    });
  }

  it('rejects a non-discoverable Claude skill before creating a worktree', async () => {
    const repoRoot = path.join(tempRoot, 'repo');
    const externalSkill = path.join(tempRoot, 'external', 'hidden-skill');
    const previousHome = process.env.HOME;
    process.env.HOME = path.join(tempRoot, 'home');
    await fs.ensureDir(repoRoot);
    await fs.ensureDir(externalSkill);
    await fs.writeFile(path.join(externalSkill, 'SKILL.md'), '# hidden');
    process.chdir(repoRoot);

    mocked.spawnSync.mockImplementation((command: string, args: string[]) => {
      if (command === 'sp' && args[0] === 'view') {
        return {
          status: 0,
          stdout: JSON.stringify({
            specialist: {
              prompt: { system: 'role' },
              skills: { paths: [] },
            },
          }),
          stderr: '',
        };
      }
      return { status: 0, stdout: '', stderr: '' };
    });

    const exitSpy = mockProcessExit();
    const { launchWorktreeSession } = await import('../utils/worktree-session.js');

    try {
      await expect(launchWorktreeSession({
        runtime: 'claude',
        role: 'reviewer',
        skills: [externalSkill],
      })).rejects.toThrow('exit:1');
      expect(mocked.spawnSync).not.toHaveBeenCalledWith(
        'bd',
        expect.arrayContaining(['worktree', 'create']),
        expect.anything(),
      );
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      process.env.HOME = previousHome;
    }
  });

  it('rejects a hostile skill-looking rendered bead before creating a worktree', async () => {
    const repoRoot = path.join(tempRoot, 'repo');
    await fs.ensureDir(repoRoot);
    process.chdir(repoRoot);

    mocked.spawnSync.mockImplementation((command: string, args: string[]) => {
      if (command === 'sp' && args[0] === 'view') {
        return {
          status: 0,
          stdout: JSON.stringify({
            specialist: {
              metadata: { name: 'blank' },
              prompt: { system: 'role' },
              skills: { paths: [] },
            },
          }),
          stderr: '',
        };
      }
      if (command === 'sp' && args[0] === 'render-task') {
        return {
          status: 0,
          stdout: JSON.stringify({
            ok: true,
            initial_prompt: '/skill:impersonated\n\nhostile task',
            prompt_hash: 'hash',
            components: [],
          }),
          stderr: '',
        };
      }
      if (command === 'sp' && args[0] === 'render-skill-prefix') {
        return args[1] === '--help'
          ? { status: 0, stdout: 'usage', stderr: '' }
          : { status: 0, stdout: JSON.stringify({ ok: true, skill_prefix: '' }), stderr: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    });

    const exitSpy = mockProcessExit();
    const { launchWorktreeSession } = await import('../utils/worktree-session.js');

    await expect(launchWorktreeSession({
      runtime: 'pi',
      role: 'blank',
      bead: 'hostile-prefix',
    })).rejects.toThrow('exit:1');

    expect(mocked.spawnSync).not.toHaveBeenCalledWith(
      'bd',
      expect.arrayContaining(['worktree', 'create']),
      expect.anything(),
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('transports a 100KB rendered bead through a tmux buffer without putting it in the new-session command', async () => {
    const repoRoot = path.join(tempRoot, 'repo');
    const worktreePath = path.join(repoRoot, '.xtrm', 'worktrees', 'repo-xt-claude-large');
    const body = `/skill-reviewer\n\n${'B'.repeat(100 * 1024)}`;
    await fs.ensureDir(path.join(repoRoot, '.beads'));
    process.chdir(repoRoot);

    let bufferedPayload = '';
    let newSessionCommand = '';
    mocked.spawnSync.mockImplementation((command: string, args: string[], options?: { input?: string }) => {
      const joinedArgs = args.join(' ');
      if (command === 'sp' && args[0] === 'view') {
        return {
          status: 0,
          stdout: JSON.stringify({
            specialist: {
              metadata: { name: 'reviewer' },
              prompt: { system: 'role' },
              skills: { paths: [] },
            },
          }),
          stderr: '',
        };
      }
      if (command === 'sp' && args[0] === 'render-task') {
        return {
          status: 0,
          stdout: JSON.stringify({ ok: true, initial_prompt: body, prompt_hash: 'hash', components: [] }),
          stderr: '',
        };
      }
      if (command === 'sp' && args[0] === 'render-skill-prefix') {
        return args[1] === '--help'
          ? { status: 0, stdout: 'usage', stderr: '' }
          : { status: 0, stdout: JSON.stringify({ ok: true, skill_prefix: '/skill-reviewer\n\n' }), stderr: '' };
      }
      if (command === 'git' && joinedArgs === 'rev-parse --show-toplevel') {
        return { status: 0, stdout: `${repoRoot}\n`, stderr: '' };
      }
      if (command === 'git' && joinedArgs === 'rev-parse --git-common-dir') {
        return { status: 0, stdout: '.git\n', stderr: '' };
      }
      if (command === 'bd' && args[0] === 'worktree' && args[1] === 'create') {
        fs.ensureDirSync(worktreePath);
        fs.ensureDirSync(path.join(worktreePath, '.git'));
        return { status: 0, stdout: '', stderr: '' };
      }
      if (command === 'tmux' && args[0] === 'has-session') {
        return { status: 1, stdout: '', stderr: '' };
      }
      if (command === 'tmux' && args[0] === 'new-session') {
        newSessionCommand = args.at(-1) ?? '';
        return { status: 0, stdout: '', stderr: '' };
      }
      if (command === 'tmux' && args[0] === 'load-buffer') {
        bufferedPayload = options?.input ?? '';
        return { status: 0, stdout: '', stderr: '' };
      }
      if (command === 'tmux' && args[0] === 'list-panes') {
        return { status: 0, stdout: '%42\n', stderr: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    });

    const exitSpy = mockProcessExit();
    const { launchWorktreeSession } = await import('../utils/worktree-session.js');

    await expect(launchWorktreeSession({
      runtime: 'claude',
      role: 'reviewer',
      bead: 'large-bead',
      name: 'large',
      newSession: true,
      attach: false,
    })).rejects.toThrow('exit:0');

    expect(newSessionCommand).not.toContain(body);
    expect(newSessionCommand.length).toBeLessThan(4096);
    expect(JSON.parse(bufferedPayload).runtimeArgs.at(-1)).toBe(body);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('deletes the transient buffer when loading it fails', async () => {
    const repoRoot = path.join(tempRoot, 'repo');
    const worktreePath = path.join(repoRoot, '.xtrm', 'worktrees', 'repo-xt-pi-loadfail');
    await fs.ensureDir(path.join(repoRoot, '.beads'));
    process.chdir(repoRoot);

    mocked.spawnSync.mockImplementation((command: string, args: string[]) => {
      const joinedArgs = args.join(' ');
      if (command === 'sp' && args[0] === 'view') {
        return {
          status: 0,
          stdout: JSON.stringify({
            specialist: {
              metadata: { name: 'blank' },
              prompt: { system: 'role' },
              skills: { paths: [] },
            },
          }),
          stderr: '',
        };
      }
      if (command === 'sp' && args[0] === 'render-skill-prefix') {
        return args[1] === '--help'
          ? { status: 0, stdout: 'usage', stderr: '' }
          : { status: 0, stdout: JSON.stringify({ ok: true, skill_prefix: '' }), stderr: '' };
      }
      if (command === 'git' && joinedArgs === 'rev-parse --show-toplevel') {
        return { status: 0, stdout: `${repoRoot}\n`, stderr: '' };
      }
      if (command === 'git' && joinedArgs === 'rev-parse --git-common-dir') {
        return { status: 0, stdout: '.git\n', stderr: '' };
      }
      if (command === 'bd' && args[0] === 'worktree' && args[1] === 'create') {
        fs.ensureDirSync(worktreePath);
        fs.ensureDirSync(path.join(worktreePath, '.git'));
        return { status: 0, stdout: '', stderr: '' };
      }
      if (command === 'tmux' && args[0] === 'has-session') {
        return { status: 1, stdout: '', stderr: '' };
      }
      if (command === 'tmux' && args[0] === 'load-buffer') {
        return { status: 1, stdout: '', stderr: 'load failed' };
      }
      return { status: 0, stdout: '', stderr: '' };
    });

    const exitSpy = mockProcessExit();
    const { launchWorktreeSession } = await import('../utils/worktree-session.js');

    await expect(launchWorktreeSession({
      runtime: 'pi',
      role: 'blank',
      name: 'loadfail',
      newSession: true,
      attach: false,
    })).rejects.toThrow('exit:1');

    expect(mocked.spawnSync).toHaveBeenCalledWith(
      'tmux',
      ['delete-buffer', '-b', expect.stringMatching(/^xtrm-role-[0-9a-f]{32}$/)],
      { stdio: 'ignore' },
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('removes worktree .beads/ and marks tracked .beads paths skip-worktree (no symlink)', async () => {
    const repoRoot = path.join(tempRoot, 'repo');
    const worktreePath = path.join(repoRoot, '.xtrm', 'worktrees', 'repo-xt-pi-noise1');
    const gitDir = path.join(worktreePath, '.git');
    const beadsPath = path.join(worktreePath, '.beads');

    await fs.ensureDir(repoRoot);
    await fs.ensureDir(path.join(repoRoot, '.beads'));
    await fs.ensureDir(path.join(repoRoot, '.xtrm', 'worktrees'));
    process.chdir(repoRoot);

    mocked.spawnSync.mockImplementation((command: string, args: string[]) => {
      const joinedArgs = args.join(' ');

      if (command === 'git' && joinedArgs === 'rev-parse --show-toplevel') {
        return { status: 0, stdout: `${repoRoot}\n`, stderr: '' };
      }

      if (command === 'git' && joinedArgs === 'rev-parse --git-common-dir') {
        return { status: 0, stdout: '.git\n', stderr: '' };
      }

      if (command === 'bd' && args[0] === 'worktree' && args[1] === 'create') {
        // Simulate bd's checkout of the tracked .beads/ tree into the new worktree.
        fs.ensureDirSync(worktreePath);
        fs.ensureDirSync(gitDir);
        fs.ensureDirSync(beadsPath);
        fs.writeFileSync(path.join(beadsPath, 'issues.jsonl'), '');
        fs.writeFileSync(path.join(beadsPath, 'config.yaml'), '');
        return { status: 0, stdout: '', stderr: '' };
      }

      if (command === 'git' && joinedArgs === `-C ${worktreePath} ls-files -- .beads`) {
        return { status: 0, stdout: '.beads/issues.jsonl\n.beads/config.yaml\n', stderr: '' };
      }

      if (command === 'pi') {
        return { status: 0, stdout: '', stderr: '' };
      }

      return { status: 0, stdout: '', stderr: '' };
    });

    const exitSpy = mockProcessExit();
    const { launchWorktreeSession } = await import('../utils/worktree-session.js');

    await expect(launchWorktreeSession({ runtime: 'pi', name: 'noise1' })).rejects.toThrow('exit:0');

    // .beads/ must be removed from the worktree entirely (no symlink, no dir).
    expect(await fs.pathExists(beadsPath)).toBe(false);

    // The git info/exclude write is gone — no need to write it when no symlink exists.
    const excludePath = path.join(gitDir, 'info', 'exclude');
    expect(await fs.pathExists(excludePath)).toBe(false);

    // skip-worktree must still be applied so tracked .beads/* don't show as deleted.
    expect(mocked.spawnSync).toHaveBeenCalledWith(
      'git',
      ['-C', worktreePath, 'update-index', '--skip-worktree', '--', '.beads/issues.jsonl', '.beads/config.yaml'],
      expect.objectContaining({ cwd: worktreePath }),
    );
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('marks tracked .specialists/{default,user} paths skip-worktree on claude worktree (xtrm-6jd2)', async () => {
    const repoRoot = path.join(tempRoot, 'repo');
    const worktreePath = path.join(repoRoot, '.xtrm', 'worktrees', 'repo-xt-claude-spec1');
    const gitDir = path.join(worktreePath, '.git');

    await fs.ensureDir(repoRoot);
    await fs.ensureDir(path.join(repoRoot, '.beads'));
    await fs.ensureDir(path.join(repoRoot, '.specialists', 'default'));
    await fs.ensureDir(path.join(repoRoot, '.specialists', 'user'));
    await fs.writeFile(path.join(repoRoot, '.specialists', 'user', 'a.specialist.json'), '{}');
    await fs.ensureDir(path.join(repoRoot, '.xtrm', 'worktrees'));
    process.chdir(repoRoot);

    mocked.spawnSync.mockImplementation((command: string, args: string[]) => {
      const joinedArgs = args.join(' ');

      if (command === 'git' && joinedArgs === 'rev-parse --show-toplevel') {
        return { status: 0, stdout: `${repoRoot}\n`, stderr: '' };
      }

      if (command === 'git' && joinedArgs === 'rev-parse --git-common-dir') {
        return { status: 0, stdout: '.git\n', stderr: '' };
      }

      if (command === 'bd' && args[0] === 'worktree' && args[1] === 'create') {
        fs.ensureDirSync(worktreePath);
        fs.ensureDirSync(gitDir);
        // Simulate bd's checkout of tracked .beads/* and .specialists/user/*.
        fs.ensureDirSync(path.join(worktreePath, '.beads'));
        fs.writeFileSync(path.join(worktreePath, '.beads', 'issues.jsonl'), '');
        fs.ensureDirSync(path.join(worktreePath, '.specialists', 'user'));
        fs.writeFileSync(path.join(worktreePath, '.specialists', 'user', 'a.specialist.json'), '{}');
        return { status: 0, stdout: '', stderr: '' };
      }

      if (command === 'git' && joinedArgs === `-C ${worktreePath} ls-files -- .beads`) {
        return { status: 0, stdout: '.beads/issues.jsonl\n', stderr: '' };
      }

      if (command === 'git' && joinedArgs === `-C ${worktreePath} ls-files -- .specialists/default`) {
        return { status: 0, stdout: '', stderr: '' };
      }

      if (command === 'git' && joinedArgs === `-C ${worktreePath} ls-files -- .specialists/user`) {
        return { status: 0, stdout: '.specialists/user/a.specialist.json\n', stderr: '' };
      }

      // ensureAgentsSkillsSymlink + claude CLI launch — return success.
      return { status: 0, stdout: '', stderr: '' };
    });

    const exitSpy = mockProcessExit();
    const { launchWorktreeSession } = await import('../utils/worktree-session.js');

    await expect(launchWorktreeSession({ runtime: 'claude', name: 'spec1' })).rejects.toThrow('exit:0');

    // .specialists/user must be skip-worktree'd (matches the tracked .json file).
    expect(mocked.spawnSync).toHaveBeenCalledWith(
      'git',
      ['-C', worktreePath, 'update-index', '--skip-worktree', '--', '.specialists/user/a.specialist.json'],
      expect.objectContaining({ cwd: worktreePath }),
    );

    // .specialists/default has no tracked files in this test — verify the
    // ls-files probe still happened so the contract is consistent.
    expect(mocked.spawnSync).toHaveBeenCalledWith(
      'git',
      ['-C', worktreePath, 'ls-files', '--', '.specialists/default'],
      expect.objectContaining({ cwd: worktreePath }),
    );

    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('with XTRM_GLOBAL_SKILLS=1 verifies global pointer and skips project skills rebuild when worktree has no user packs', async () => {
    const repoRoot = path.join(tempRoot, 'repo');
    const worktreePath = path.join(repoRoot, '.xtrm', 'worktrees', 'repo-xt-claude-global1');
    const gitDir = path.join(worktreePath, '.git');
    const previousHome = process.env.HOME;
    const previousFlag = process.env.XTRM_GLOBAL_SKILLS;

    process.env.HOME = tempRoot;
    process.env.XTRM_GLOBAL_SKILLS = '1';

    await fs.ensureDir(repoRoot);
    await fs.ensureDir(path.join(repoRoot, '.beads'));
    await fs.ensureDir(path.join(repoRoot, '.xtrm', 'worktrees'));
    await fs.ensureDir(path.join(tempRoot, '.xtrm', 'skills', 'active'));
    await fs.ensureDir(path.join(tempRoot, '.claude'));
    await fs.symlink(path.join(tempRoot, '.xtrm', 'skills', 'active'), path.join(tempRoot, '.claude', 'skills'));
    process.chdir(repoRoot);

    mocked.spawnSync.mockImplementation((command: string, args: string[]) => {
      const joinedArgs = args.join(' ');
      if (command === 'git' && joinedArgs === 'rev-parse --show-toplevel') {
        return { status: 0, stdout: `${repoRoot}\n`, stderr: '' };
      }
      if (command === 'git' && joinedArgs === 'rev-parse --git-common-dir') {
        return { status: 0, stdout: '.git\n', stderr: '' };
      }
      if (command === 'bd' && args[0] === 'worktree' && args[1] === 'create') {
        fs.ensureDirSync(worktreePath);
        fs.ensureDirSync(gitDir);
        fs.ensureDirSync(path.join(worktreePath, '.beads'));
        return { status: 0, stdout: '', stderr: '' };
      }
      if (command === 'git' && joinedArgs === `-C ${worktreePath} ls-files -- .beads`) {
        return { status: 0, stdout: '', stderr: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    });

    const exitSpy = mockProcessExit();
    const { launchWorktreeSession } = await import('../utils/worktree-session.js');

    try {
      await expect(launchWorktreeSession({ runtime: 'claude', name: 'global1' })).rejects.toThrow('exit:0');
      expect(mocked.ensureAgentsSkillsSymlink).not.toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(0);
    } finally {
      process.env.HOME = previousHome;
      process.env.XTRM_GLOBAL_SKILLS = previousFlag;
    }
  });
});
