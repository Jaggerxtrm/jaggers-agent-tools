#!/usr/bin/env node
// Refresh the [Unreleased] section of CHANGELOG.md from the git log.
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
//   node scripts/changelog-update.mjs [--check] [--tag vX.Y.Z]
//     --check       exit 1 if the file would change (CI guard), write nothing
//     --tag vX.Y.Z  promote unreleased commits into a versioned section
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CHANGELOG = 'CHANGELOG.md';
const CONFIG = 'changelog/cliff.toml';
const UNRELEASED = '## [Unreleased]';
const check = process.argv.includes('--check');
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

// Resolve git-cliff via npm exec (falls back to fetching if not installed).
// More robust than import.meta.resolve across CI setups where node's ESM
// resolver disagrees with npm about where the workspace installed the dep.
// Requires git-cliff as a devDependency.
const cliffArgs = ['--yes', 'git-cliff', '--config', CONFIG, '--unreleased'];
if (tag) cliffArgs.push('--tag', tag);
const generated = execFileSync('npx', cliffArgs, {
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
}).trim();

// Released sections = everything from the first "## [" that is NOT [Unreleased].
// Dropping the target version too keeps tagged runs idempotent.
const sections = current.slice(firstSection).split(/^(?=## \[)/m);
const targetHeading = tag ? `## [${tag.replace(/^v/, '')}]` : undefined;
const released = sections
  .filter((section) => !section.startsWith(UNRELEASED) && (!targetHeading || !section.startsWith(targetHeading)))
  .join('')
  .trimEnd();

const hasEntries = /^- /m.test(generated);
const refreshed = tag
  ? `${UNRELEASED}\n\n${generated}`
  : generated.startsWith(UNRELEASED) ? generated : `${UNRELEASED}\n\n${generated}`;
const next = `${header}\n\n${hasEntries ? refreshed : UNRELEASED}\n\n${released}\n`;

if (next === current) {
  console.log(`${CHANGELOG}: already up to date`);
  process.exit(0);
}
if (check) {
  console.error(`${CHANGELOG}: out of date — run: node scripts/changelog-update.mjs${tag ? ` --tag ${tag}` : ''}`);
  process.exit(1);
}

// Safety net: never lose a released section.
for (const heading of current.match(/^## \[v[^\]]+\].*$/gm) ?? []) {
  if (!next.includes(heading)) throw new Error(`refusing to write: would drop released section ${heading}`);
}

writeFileSync(CHANGELOG, next);
console.log(`${CHANGELOG}: ${tag ?? '[Unreleased]'} refreshed (${(generated.match(/^- /gm) ?? []).length} entries)`);
