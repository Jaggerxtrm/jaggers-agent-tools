#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, existsSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tarball = process.argv[2];
const secret = 'fixture-secret-should-not-leak';

if (!tarball) {
  console.error('usage: node scripts/install-update-ux-smoke.mjs <xtrm-tools-tarball>');
  process.exit(2);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    timeout: 120_000,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function combined(result) {
  return `${result.stdout}\n${result.stderr}`;
}

function redacted(value) {
  return value.replaceAll(secret, '[REDACTED]');
}

function assertNoSecret(label, result) {
  assert.doesNotMatch(combined(result), new RegExp(secret), `${label} leaked fixture content`);
}

function assertSuccess(label, result) {
  assert.equal(result.status, 0, `${label} failed (${result.status}): ${redacted(combined(result).slice(-1_000))}`);
  assertNoSecret(label, result);
}

const smokeRoot = mkdtempSync(path.join(os.tmpdir(), 'xtrm-install-update-ux-'));
const home = path.join(smokeRoot, 'home');
const project = path.join(smokeRoot, 'project');
const installPrefix = path.join(smokeRoot, 'install');
const piAgentDir = path.join(home, '.pi', 'agent');
const env = {
  ...process.env,
  HOME: home,
  PI_AGENT_DIR: piAgentDir,
  XTRM_SMOKE_SECRET: secret,
};

try {
  mkdirSync(project, { recursive: true });
  mkdirSync(home, { recursive: true });
  assertSuccess('git init', run('git', ['init', '-q', '-b', 'main'], { cwd: project, env }));

  const installed = run('npm', [
    'install', '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-offline',
    '--prefix', installPrefix, tarball,
  ], { cwd: repoRoot, env });
  assertSuccess('fresh npm install', installed);

  const packageRoot = path.join(installPrefix, 'node_modules', 'xtrm-tools');
  const cli = path.join(packageRoot, 'cli', 'dist', 'index.cjs');
  assert.ok(existsSync(cli), 'packed install did not contain cli/dist/index.cjs');
  assert.ok(existsSync(path.join(packageRoot, '.xtrm', 'config', 'pi', 'install-schema.json')),
    'packed install did not contain .xtrm/config/pi/install-schema.json');

  const help = run('node', [cli, '--help'], { cwd: project, env });
  assertSuccess('installed CLI help', help);
  assert.match(help.stdout, /update/i);
  assert.match(help.stdout, /doctor/i);

  const piHelp = run('node', [cli, 'pi', '--help'], { cwd: project, env });
  assertSuccess('installed Pi help', piHelp);
  assert.doesNotMatch(piHelp.stdout, /^\s+install\b/im, 'retired install token remains in Pi help');

  const piCheck = run('node', [cli, 'pi', 'setup', '--check'], { cwd: project, env });
  assert.ok([0, 1].includes(piCheck.status), `Pi check crashed (${piCheck.status})`);
  assert.match(combined(piCheck), /Pi Runtime|Missing|Extensions/i);
  assert.doesNotMatch(combined(piCheck), /not bundled in npm package/i,
    'packaged Pi resolver fell through to an unbundled path');
  assertNoSecret('packaged Pi check', piCheck);

  for (const args of [['pi', 'install'], ['pi', 'install', '--help']]) {
    const retired = run('node', [cli, ...args], { cwd: project, env });
    assert.equal(retired.status, 1, `retired ${args.join(' ')} did not fail safely`);
    assert.match(combined(retired), /xt pi install is retired.*xt update --apply/i);
    assertNoSecret(`retired ${args.join(' ')}`, retired);
  }

  // Seed only isolated, known-owned legacy state plus user-owned controls.
  const defaultSkills = path.join(home, '.xtrm', 'skills', 'default');
  const activeSkills = path.join(home, '.xtrm', 'skills', 'active');
  const retiredSkill = path.join(defaultSkills, 'using-specialists-v3');
  const activeRetiredSkill = path.join(activeSkills, 'using-specialists-v3');
  const userSkill = path.join(activeSkills, 'user-owned');
  const userHook = path.join(home, '.claude', 'hooks', 'user-hook.mjs');
  mkdirSync(retiredSkill, { recursive: true });
  mkdirSync(userSkill, { recursive: true });
  mkdirSync(path.dirname(userHook), { recursive: true });
  writeFileSync(path.join(retiredSkill, 'SKILL.md'), '# retired\n');
  writeFileSync(path.join(userSkill, 'SKILL.md'), '# user\n');
  writeFileSync(userHook, `// ${secret}\n`);
  symlinkSync('../default/using-specialists-v3', activeRetiredSkill);

  const clean = run('node', [cli, 'clean', '--yes'], { cwd: project, env });
  assertSuccess('ownership-safe clean', clean);
  assert.equal(existsSync(retiredSkill), false, 'owned retired skill was not removed');
  assert.equal(existsSync(activeRetiredSkill), false, 'owned active retired link was not removed');
  assert.equal(existsSync(path.join(userSkill, 'SKILL.md')), true, 'user active skill was removed');
  assert.equal(existsSync(userHook), true, 'user hook was removed');
  assert.match(clean.stdout, /Ownership outcome/i);
  assert.match(clean.stdout, /preserved/i);
  assert.match(clean.stdout, /removed/i);

  console.log('install-update-ux-smoke: PASS');
  console.log('  packed resolver: PASS');
  console.log('  help/retired-token matrix: PASS');
  console.log('  owned-only cleanup and preservation: PASS');
  console.log('  command output redaction: PASS');
} finally {
  rmSync(smokeRoot, { recursive: true, force: true });
}
