#!/usr/bin/env node
// Own the [Unreleased] section of CHANGELOG.md.
//
// The committed [Unreleased] is an EMPTY placeholder. Entries are generated from the
// git log at release time (`--tag`), never committed on a branch.
//
// Why empty instead of kept fresh on every branch:
//   The block is derived from the git log, so two branches off the same main hold two
//   different generated states of the same lines. Every merge to main then conflicts
//   every other open pull request on a file no human disagreed about — five rebases in
//   one day, cost growing with the square of the open pull requests (bead xtrm-wiy5n.4.28).
//   Committing it bought nothing: `--tag` regenerates the whole block from the log and
//   ignores whatever was committed, and squash-merge rewrites the commit ids and
//   timestamps it is keyed on, so on main it is stale the instant a merge lands
//   (bead xtrm-wiy5n.4.29). Use `--preview` to see what is pending.
//
// Why this exists instead of `git-cliff --prepend`:
//   --prepend blindly inserts at line 1. On this repo that put the generated block
//   ABOVE the "# Changelog" title (stranding it mid-file) and stacked a SECOND
//   [Unreleased] section on top of the existing one. Every run made it worse.
//
// This script is idempotent: it replaces the [Unreleased] section in place, keeping
// the title/preamble at the top and every released section untouched. Run it twice,
// get the same file.
//
// It never uses `git-cliff -o` / plain generate — those rebuild CHANGELOG.md from the
// git log and would drop every hand-written line (measured: 362 lines in this repo).
//
//   node scripts/changelog-update.mjs [--check] [--preview] [--tag vX.Y.Z]
//     (no flags)    reset [Unreleased] to the empty placeholder
//     --check       exit 1 if the file would change (CI guard), write nothing
//     --preview     print the pending entries to stdout, write nothing
//     --tag vX.Y.Z  promote unreleased commits into a versioned section
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const CHANGELOG = 'CHANGELOG.md';
const CONFIG = 'changelog/cliff.toml';
const UNRELEASED = '## [Unreleased]';
const check = process.argv.includes('--check');
const preview = process.argv.includes('--preview');
const tagIndex = process.argv.indexOf('--tag');
const tag = tagIndex === -1 ? undefined : process.argv[tagIndex + 1];
if (tagIndex !== -1 && !tag) throw new Error('--tag requires a version');

const current = readFileSync(CHANGELOG, 'utf8');

// The header is everything before the first section heading (title + preamble + rule).
const firstSection = current.search(/^## \[/m);
if (firstSection === -1) throw new Error(`${CHANGELOG}: no "## [" section found — refusing to guess its shape.`);
const header = current.slice(0, firstSection).trimEnd();

// A file already corrupted by `git-cliff --prepend` has its "# Changelog" title BELOW the
// injected [Unreleased] block, so "everything above the first section" is empty and the title
// would be dropped along with that block. Refuse rather than silently delete it.
if (!/^# /m.test(header)) {
  throw new Error(
    `${CHANGELOG}: no "# " title above the first section — the file looks --prepend-corrupted.\n` +
    `Restore the title/preamble to the top of the file, then re-run.`,
  );
}

// Only a release or an explicit preview reads the git log. --check and the default
// reset compare against the empty placeholder, so they need no git-cliff, no
// devDependency and no unshallowed history — which is what makes them satisfiable
// on main as well as on a branch.
function cliff() {
  // Resolve git-cliff via npm exec (falls back to fetching if not installed).
  // More robust than import.meta.resolve across CI setups where node's ESM
  // resolver disagrees with npm about where the workspace installed the dep.
  // Requires git-cliff as a devDependency.
  const cliffArgs = ['--yes', 'git-cliff', '--config', CONFIG, '--unreleased'];
  if (tag) cliffArgs.push('--tag', tag);
  return execFileSync('npx', cliffArgs, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim();
}

if (preview) {
  const pending = cliff();
  console.log(/^- /m.test(pending) ? pending : 'no unreleased commits');
  process.exit(0);
}

// Empty everywhere except a tagged release: the committed [Unreleased] is a placeholder.
const generated = tag ? cliff() : '';

// Released sections = everything from the first "## [" that is NOT [Unreleased].
// Dropping the target version too keeps tagged runs idempotent.
const sections = current.slice(firstSection).split(/^(?=## \[)/m);
const targetHeading = tag ? `## [${tag.replace(/^v/, '')}]` : undefined;
const released = sections
  .filter((section) => !section.startsWith(UNRELEASED) && (!targetHeading || !section.startsWith(targetHeading)))
  .join('')
  .trimEnd();

const hasEntries = /^- /m.test(generated);
const next = `${header}\n\n${hasEntries ? `${UNRELEASED}\n\n${generated}` : UNRELEASED}\n\n${released}\n`;

if (next === current) {
  console.log(`${CHANGELOG}: already up to date`);
  process.exit(0);
}
if (check) {
  console.error(
    `${CHANGELOG}: [Unreleased] must be an empty placeholder — entries are generated at release time.\n` +
    `  Fix: npm run changelog:update   (see what is pending: npm run changelog:preview)`,
  );
  process.exit(1);
}

// Safety net: never lose a released section.
for (const heading of current.match(/^## \[v[^\]]+\].*$/gm) ?? []) {
  if (!next.includes(heading)) throw new Error(`refusing to write: would drop released section ${heading}`);
}

writeFileSync(CHANGELOG, next);
console.log(
  tag
    ? `${CHANGELOG}: ${tag} written (${(generated.match(/^- /gm) ?? []).length} entries)`
    : `${CHANGELOG}: [Unreleased] reset to the empty placeholder`,
);
