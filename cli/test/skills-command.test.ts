import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_BIN = path.join(__dirname, '../dist/index.cjs');

function run(args: string[], opts: { env?: NodeJS.ProcessEnv; cwd?: string } = {}): { stdout: string; stderr: string; status: number } {
  const result = spawnSync('node', [CLI_BIN, ...args], {
    encoding: 'utf8',
    timeout: 15000,
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
  });

  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status ?? -1,
  };
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function createSkill(skillRoot: string, skillName: string): void {
  const dir = path.join(skillRoot, skillName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `# ${skillName}\n`, 'utf8');
}

function createPack(packRoot: string, packName: string, skills: readonly string[], includeMetadata = true): void {
  const dir = path.join(packRoot, packName);
  fs.mkdirSync(dir, { recursive: true });
  if (includeMetadata) {
    writeJson(path.join(dir, 'PACK.json'), {
      schemaVersion: '1',
      name: packName,
      version: '1.0.0',
      description: `${packName} pack`,
      skills,
    });
  }

  for (const skill of skills) {
    createSkill(dir, skill);
  }
}

describe('xt skills CLI integration', () => {
  let tmpHome = '';

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'xtrm-skills-'));
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('prints list summary and supports runtime flags in human output mode', () => {
    const skillsRoot = path.join(tmpHome, '.xtrm', 'skills');
    createSkill(path.join(skillsRoot, 'default'), 'always-on');
    createPack(path.join(skillsRoot, 'optional'), 'alpha-pack', ['alpha-skill']);

    writeJson(path.join(skillsRoot, 'state.json'), {
      schemaVersion: '1',
      enabledPacks: {
        claude: ['alpha-pack'],
        pi: [],
      },
    });

    const result = run(['skills', 'list', '--global', '--claude'], { env: { HOME: tmpHome } });

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/xt skills list/i);
    expect(result.stdout).toMatch(/alpha-pack/i);
    expect(result.stdout).toMatch(/claude: 2 active skills/i);
    expect(result.stdout).not.toMatch(/pi: \d+ active skills/i);
  });

  it('ignores retired PACK.json metadata in flat packs without failing list', () => {
    const skillsRoot = path.join(tmpHome, '.xtrm', 'skills');
    createSkill(path.join(skillsRoot, 'default'), 'always-on');

    const packDir = path.join(skillsRoot, 'drift-pack');
    fs.mkdirSync(packDir, { recursive: true });
    writeJson(path.join(packDir, 'PACK.json'), {
      schemaVersion: '1',
      name: 'drift-pack',
      version: '1.0.0',
      description: 'drift-pack',
      skills: ['metadata-only'],
    });
    createSkill(packDir, 'filesystem-only');

    writeJson(path.join(skillsRoot, 'state.json'), {
      schemaVersion: '1',
      enabledPacks: {
        claude: [],
        pi: [],
      },
    });

    const result = run(['skills', 'list', '--global'], { env: { HOME: tmpHome } });

    expect(result.status).toBe(0);
    expect(result.stdout).not.toMatch(/warnings/i);
    expect(result.stdout).toMatch(/drift-pack/i);
  });

  it('returns non-zero with clear stderr for invalid disable/enable operations', () => {
    const skillsRoot = path.join(tmpHome, '.xtrm', 'skills');
    createSkill(path.join(skillsRoot, 'default'), 'always-on');
    createPack(path.join(skillsRoot, 'optional'), 'alpha-pack', ['alpha-skill']);

    writeJson(path.join(skillsRoot, 'state.json'), {
      schemaVersion: '1',
      enabledPacks: {
        claude: [],
        pi: [],
      },
    });

    const disableDefault = run(['skills', 'disable', 'always-on', '--global'], {
      env: { HOME: tmpHome },
    });
    expect(disableDefault.status).not.toBe(0);
    expect(disableDefault.stderr).toMatch(/default skill, not a pack/i);

    const enableMissing = run(['skills', 'enable', 'missing-pack', '--global'], {
      env: { HOME: tmpHome },
    });
    expect(enableMissing.status).not.toBe(0);
    expect(enableMissing.stderr).toMatch(/not found in \.xtrm\/skills packs/i);

    const disableMissing = run(['skills', 'disable', 'missing-pack', '--global'], {
      env: { HOME: tmpHome },
    });
    expect(disableMissing.status).not.toBe(0);
    expect(disableMissing.stderr).toMatch(/not found in \.xtrm\/skills packs/i);
  });

  it('create-pack reports collisions and invalid names as failures', () => {
    const skillsRoot = path.join(tmpHome, '.xtrm', 'skills');
    createPack(skillsRoot, 'existing-pack', [], false);

    const created = run(['skills', 'create-pack', 'fresh-pack', '--global'], {
      env: { HOME: tmpHome },
    });
    expect(created.status).toBe(0);
    expect(created.stdout).toMatch(/created pack 'fresh-pack'/i);

    const collision = run(['skills', 'create-pack', 'existing-pack', '--global'], {
      env: { HOME: tmpHome },
    });
    expect(collision.status).not.toBe(0);
    expect(collision.stderr).toMatch(/already exists/i);

    const invalidName = run(['skills', 'create-pack', 'Bad Name', '--global'], {
      env: { HOME: tmpHome },
    });
    expect(invalidName.status).not.toBe(0);
    expect(invalidName.stderr).toMatch(/invalid pack name/i);
  });
});
