// Suite A — installed-artifact conformance (audit §P2-01 steps 1, 6, 19, 20).
//
// Exercises all three release-candidate artifacts from PACKED tarballs inside an
// isolated HOME. Hermetic: no tmux, no live coordinator, no network beyond the
// local npm install of the provided tarballs.
//
//   node test/integration-suite/suite-a-installed-artifact.mjs \
//     <core.tgz> <specialists.tgz> <xtmux.tgz>
//
// Tarballs default to the P201_*_TARBALL env vars when positional args are
// omitted; run pack-artifacts.mjs first to produce them locally.

import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SECRET, assertNoSecret, assertSuccess, combined, makeSandbox, reporter, run } from './lib/harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const compat = JSON.parse(readFileSync(path.resolve(here, '..', '..', 'docs', 'runtime-compatibility.json'), 'utf8'));

const coreTgz = process.argv[2] || process.env.P201_CORE_TARBALL;
const specialistsTgz = process.argv[3] || process.env.P201_SPECIALISTS_TARBALL;
const xtmuxTgz = process.argv[4] || process.env.P201_XTMUX_TARBALL;
for (const [name, v] of [['core', coreTgz], ['specialists', specialistsTgz], ['xtmux', xtmuxTgz]]) {
  if (!v || !existsSync(v)) {
    console.error(`suite-a: missing ${name} tarball (arg or P201_${name.toUpperCase()}_TARBALL). Run pack-artifacts.mjs.`);
    process.exit(2);
  }
}

const parse = (v) => v.replace(/^[v^~]/, '').split('.').map((n) => parseInt(n, 10) || 0);
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
// ponytail: comparator only understands the ">=a <b" two-clause form — which is
// exactly what docs/runtime-compatibility.json declares. If the contract ever
// grows caret/OR ranges, swap this for the `semver` package.
function satisfies(version, range) {
  const v = parse(version);
  return range.split(/\s+/).every((clause) => {
    const m = clause.match(/^(>=|<=|>|<|=)?(.+)$/);
    const op = m[1] || '=';
    const bound = parse(m[2]);
    const c = cmp(v, bound);
    return op === '>=' ? c >= 0 : op === '<=' ? c <= 0 : op === '>' ? c > 0 : op === '<' ? c < 0 : c === 0;
  });
}

const r = reporter('suite-a');
const box = makeSandbox('xtrm-p201-a-');
const { env, project, installPrefix } = box;

// process.exit() inside the try block skips the finally, so exiting there leaked
// the whole ~615MB sandbox per run and eventually filled /tmp. Record the code,
// let finally clean up, exit last.
let exitCode = 0;

try {
  // ── STEP 1: install Core, Specialists and xtmux release candidates ─────────
  const installed = run('npm', [
    'install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-save',
    '--prefix', installPrefix, coreTgz, specialistsTgz, xtmuxTgz,
  ], { cwd: project, env });
  assertSuccess('install three RC tarballs', installed);

  const modules = path.join(installPrefix, 'node_modules');
  const coreRoot = path.join(modules, 'xtrm-tools');
  const specialistsRoot = path.join(modules, '@jaggerxtrm', 'specialists');
  const xtmuxRoot = path.join(modules, '@jaggerxtrm', 'xtmux');
  const cli = path.join(coreRoot, 'cli', 'dist', 'index.cjs');

  assert.ok(existsSync(cli), 'core: cli/dist/index.cjs missing from packed install');
  assert.ok(existsSync(specialistsRoot), 'specialists: package missing from install');
  assert.ok(existsSync(xtmuxRoot), 'xtmux: package missing from install');

  // Cross-repo version conformance against Core's declared compatibility window.
  // This is the assertion that makes the suite genuinely cross-repository: the
  // installed sibling artifacts must satisfy the range Core ships in
  // docs/runtime-compatibility.json.
  const req = compat.core.requires;
  const specVersion = JSON.parse(readFileSync(path.join(specialistsRoot, 'package.json'), 'utf8')).version;
  const xtmuxVersion = JSON.parse(readFileSync(path.join(xtmuxRoot, 'package.json'), 'utf8')).version;
  assert.ok(
    satisfies(specVersion, req.specialists),
    `specialists ${specVersion} violates Core requires "${req.specialists}"`,
  );
  assert.ok(satisfies(xtmuxVersion, req.xtmux), `xtmux ${xtmuxVersion} violates Core requires "${req.xtmux}"`);

  const help = run('node', [cli, '--help'], { cwd: project, env });
  assertSuccess('installed Core CLI --help', help);
  assert.match(help.stdout, /update/i, 'core help missing `update` command');
  r.ok('step 1: install Core+Specialists+xtmux RCs', `spec ${specVersion} ∈ ${req.specialists}, xtmux ${xtmuxVersion} ∈ ${req.xtmux}`);

  // ── STEP 6 (shape): xtrm.runtime-origin.v1 contract present in Specialists ──
  // Full LIVE capture needs a dispatched specialist under a coordinator (Suite C,
  // blocked on xtrm-3xgs5). Here we assert the installed artifact ships the
  // contract Core declares — a real installed-artifact conformance check.
  const originSchema = compat.contracts.runtime_origin; // "xtrm.runtime-origin.v1"
  const distFiles = walk(path.join(specialistsRoot, 'dist')).filter((f) => f.endsWith('.js') || f.endsWith('.cjs') || f.endsWith('.mjs'));
  const originHit = distFiles.some((f) => readFileSync(f, 'utf8').includes(originSchema));
  assert.ok(originHit, `specialists dist does not expose the ${originSchema} contract`);
  r.ok('step 6 (shape): runtime-origin contract in installed Specialists', originSchema);
  r.skip('step 6 (live capture)', 'needs dispatched specialist under coordinator → Suite C (xtrm-3xgs5)');

  // ── Seed user-owned + stale state for steps 19/20 ──────────────────────────
  // Hooks and extensions have explicit foreign-preserved handling in
  // claude-runtime-sync.ts / pi-runtime.ts; they are the surfaces `update`
  // demonstrably keeps. Skills are the managed projection — see the observation
  // on `userNativeSkill` below.
  const userHook = path.join(env.HOME, '.claude', 'hooks', 'user-hook.mjs');
  const userExt = path.join(env.PI_AGENT_DIR, 'extensions', 'user-ext');
  const userNativeSkill = path.join(env.HOME, '.claude', 'skills', 'user-native');
  mkdirSync(path.dirname(userHook), { recursive: true });
  mkdirSync(userExt, { recursive: true });
  mkdirSync(userNativeSkill, { recursive: true });
  writeFileSync(userHook, `// user hook ${SECRET}\n`);
  writeFileSync(path.join(userExt, 'index.mjs'), `// user extension ${SECRET}\n`);
  writeFileSync(path.join(userNativeSkill, 'SKILL.md'), '# user native skill\n');

  // ── Seed the user-owned skill LOCATION contract (xtrm-vtqlg.7) ─────────────
  // Survival across `xt update --apply` is decided by LOCATION, not by a marker
  // (xtrm-kvsrd.4). `default/` and `optional/` are both package-managed — bootstrap
  // repairs them from the payload — while user packs, project packs and foreign
  // runtime entries are only ever DISCOVERED. Step 20 used to observe just the
  // negative half, so a regression that started eating user packs or untracked
  // runtime entries would have passed. Seed both halves here.
  //
  // The global user-pack location is the FLAT `~/.xtrm/skills/<pack>/`, which
  // `xt skills create-pack --global` writes and `discoverTierPacks(root, 'user')`
  // discovers — NOT `optional/`, which bootstrap's copyTier removes and re-copies.
  const globalSkills = path.join(env.HOME, '.xtrm', 'skills');
  const globalUserPack = path.join(globalSkills, 'p201-user-pack');
  const globalUserPackSkill = path.join(globalUserPack, 'p201-user-skill');
  const unmanagedDefaultSentinel = path.join(globalSkills, 'default', 'p201-unmanaged-default');
  const projectClaudeSkills = path.join(project, '.claude', 'skills');
  const projectForeignSkill = path.join(projectClaudeSkills, 'p201-project-owned');
  const outsideRoot = path.join(box.root, 'outside-managed-roots', 'p201-external-skill');
  const foreignRuntimeLink = path.join(projectClaudeSkills, 'p201-external-link');

  for (const dir of [globalUserPackSkill, unmanagedDefaultSentinel, projectForeignSkill, outsideRoot]) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path.join(globalUserPack, 'PACK.json'), JSON.stringify({ name: 'p201-user-pack' }, null, 2));
  writeFileSync(path.join(globalUserPackSkill, 'SKILL.md'), '# global user-pack skill\n');
  writeFileSync(path.join(unmanagedDefaultSentinel, 'SKILL.md'), '# unmanaged default sentinel\n');
  writeFileSync(path.join(projectForeignSkill, 'SKILL.md'), '# project runtime entry, never in managedLinks\n');
  writeFileSync(path.join(outsideRoot, 'SKILL.md'), '# lives outside every managed root\n');
  symlinkSync(outsideRoot, foreignRuntimeLink);

  // Stale xtrm-managed Pi pointer: an outdated project .pi state that update must
  // reconcile without touching the user-owned artifacts above.
  const staleProjectPi = path.join(project, '.pi', 'settings.json');
  mkdirSync(path.dirname(staleProjectPi), { recursive: true });
  writeFileSync(staleProjectPi, JSON.stringify({ skills: { source: 'active/pi-STALE' }, _stale: true }, null, 2));

  // ── STEP 19: xt update --apply against stale Pi state (idempotent) ──────────
  // Tolerant of partial-bootstrap exit codes exactly like fresh-machine-smoke:
  // the release contract here is "reconciles Pi state and preserves user assets",
  // not "full init succeeds against @beads/bd postinstall".
  const up1 = run('node', [cli, 'update', '--apply'], { cwd: project, env });
  assert.ok([0, 1].includes(up1.status), `xt update --apply crashed hard (status=${up1.status})`);
  assertNoSecret('xt update --apply (run 1)', up1);
  assert.match(combined(up1), /pi|extension|skill|hook|sync|update|apply|repaired/i, 'update produced no reconciliation output');
  assert.match(combined(up1), /Repaired .xtrm\/skills\/default|Runtime maintenance complete/i, 'update did not repair the managed skills tree');

  const up2 = run('node', [cli, 'update', '--apply'], { cwd: project, env });
  assert.ok([0, 1].includes(up2.status), `xt update --apply (run 2) crashed hard (status=${up2.status})`);
  assertNoSecret('xt update --apply (run 2)', up2);
  r.ok('step 19: xt update --apply against stale Pi state', 'idempotent, repaired managed tree, no hard crash, no secret leak');

  // ── STEP 20: user-owned hooks, skills and extensions preserved ─────────────
  // ASSERTED — hooks + extensions are code-backed foreign-preserved surfaces.
  assert.ok(existsSync(userHook), 'user-owned hook removed by update');
  assert.match(readFileSync(userHook, 'utf8'), /\/\/ user hook/, 'user hook body altered by update');
  assert.ok(existsSync(path.join(userExt, 'index.mjs')), 'user-owned extension removed by update');
  r.ok('step 20: user-owned hooks + extensions preserved', 'both present with body intact after update');

  // ── STEP 20b: user-owned skill LOCATION contract (xtrm-vtqlg.7) ────────────
  // ASSERTED, both halves. Enforcement lives in registry-scaffold.ts:188
  // (pruneRetiredManagedSkills) and skills-runtime-reconcile.ts:157-167/:176.

  // PRESERVED — locations the update path only ever discovers or cannot prove
  // it owns.
  assert.ok(
    existsSync(path.join(globalUserPackSkill, 'SKILL.md')),
    'global user pack removed by update (~/.xtrm/skills/<pack> is the supported user-pack home)',
  );
  assert.ok(
    existsSync(path.join(unmanagedDefaultSentinel, 'SKILL.md')),
    'unmanaged default-root sentinel removed by update without ownership proof',
  );
  assert.ok(
    existsSync(path.join(projectForeignSkill, 'SKILL.md')),
    'untracked real dir in project .claude/skills removed by update',
  );
  assert.ok(lstatSync(foreignRuntimeLink).isSymbolicLink(), 'foreign runtime symlink replaced by update');
  assert.ok(
    existsSync(path.join(foreignRuntimeLink, 'SKILL.md')),
    'foreign runtime symlink no longer resolves after update (target outside managed roots must be left alone)',
  );
  r.ok(
    'step 20b: user-owned skill location contract',
    'global user pack + unmanaged default sentinel + project runtime entry + outside-root symlink preserved',
  );

  // ~/.claude/skills is the GLOBAL runtime projection of that same registry-owned
  // default tree, which is why the bare skill seeded there above shares the
  // default/ fate rather than the foreign-preserved one.
  const nativeSkillKept = existsSync(path.join(userNativeSkill, 'SKILL.md'));
  assert.ok(!nativeSkillKept, 'bare ~/.claude/skills entry survived — managed projection must be repaired from payload');
  r.ok('step 20c: ~/.claude/skills is registry-owned', 'bare unmarked entry repaired away, per docs/skills-ownership.md');

  r.summary();
  console.log('suite-a: PASS');
} catch (err) {
  r.summary();
  console.error('suite-a: FAIL');
  console.error(err?.message || err);
  exitCode = 1;
} finally {
  box.cleanup();
}

process.exit(exitCode);

function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}
