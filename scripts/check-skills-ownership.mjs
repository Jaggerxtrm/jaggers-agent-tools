#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const manifestPath = path.join(repoRoot, 'docs', 'skills-ownership.json');
const releasePath = path.join(repoRoot, 'docs', 'skills-ownership.release.json');
const docsPath = path.join(repoRoot, 'docs', 'skills-ownership.md');

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function placementPath(name, placement) {
  if (placement.tier === 'default') return path.join(repoRoot, '.xtrm/skills/default', name);
  assert(placement.tier === 'optional' && placement.pack, `invalid placement for ${name}`);
  return path.join(repoRoot, '.xtrm/skills/optional', placement.pack, name);
}

function specialistsEntries(manifest) {
  return Object.entries(manifest.owners ?? {})
    .filter(([, entry]) => entry.owner === 'specialists')
    .map(([name, entry]) => ({ name, entry }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function validateManifest(manifest) {
  assert(manifest?.version === 2, 'manifest version must be 2');
  assert(manifest.owners?.releasing?.owner === 'xtrm-tools', 'releasing owner mismatch');
  assert(!manifest.owners?.['using-specialists-auto'], 'retired using-specialists-auto must not be vendored');

  const entries = specialistsEntries(manifest);
  assert(entries.length > 0, 'no Specialists-owned skill entries');

  for (const { name, entry } of entries) {
    const placement = entry.placement;
    assert(placement, `missing placement for ${name}`);
    const target = placementPath(name, placement);
    try {
      const stats = await fs.stat(target);
      assert(stats.isDirectory(), `placement target is not a directory: ${path.relative(repoRoot, target)}`);
    } catch {
      throw new Error(`missing placed skill: ${path.relative(repoRoot, target)}`);
    }

    if (placement.tier === 'optional') {
      const pack = await readJson(path.join(repoRoot, '.xtrm/skills/optional', placement.pack, 'PACK.json'));
      assert(pack.name === placement.pack, `PACK name mismatch for ${placement.pack}`);
      assert(pack.skills?.includes(name), `${placement.pack}/PACK.json missing ${name}`);
    }
  }

  assert(manifest.owners['using-specialists']?.placement?.tier === 'default', 'using-specialists must remain default');
  return entries;
}

function validateDocs(docsText, entries) {
  for (const { name } of entries) {
    assert(docsText.includes(`\`${name}\``), `docs missing Specialists skill name: ${name}`);
  }
  assert(docsText.includes('Machine-readable source:'), 'docs missing manifest note');
  assert(docsText.includes('docs/skills-ownership.json'), 'docs missing manifest path');
  assert(docsText.includes('placement'), 'docs missing placement contract');
}

function validateRelease(release, manifest, entries) {
  const mirror = release?.mirrors?.specialists;
  assert(mirror?.package === 'specialists', 'specialists release package mismatch');
  assert(Array.isArray(mirror.assets), 'specialists release assets missing');

  const names = entries.map(({ name }) => name);
  assert(JSON.stringify([...mirror.assets].sort()) === JSON.stringify(names), 'specialists release asset set mismatch');

  for (const { name } of entries) {
    assert(manifest.owners[name]?.owner === 'specialists', `release asset not specialists-owned: ${name}`);
    assert(
      JSON.stringify(mirror.placements?.[name]) === JSON.stringify(manifest.owners[name].placement),
      `release placement mismatch: ${name}`,
    );
  }

  const declaredSha = manifest.mirrors?.specialists?.release?.sha;
  assert(declaredSha && declaredSha !== 'unknown', 'manifest Specialists release SHA missing');
  assert(mirror.sha === declaredSha, 'release/manifest Specialists SHA mismatch');
}

async function main() {
  const [manifest, release, docsText] = await Promise.all([
    readJson(manifestPath),
    readJson(releasePath),
    fs.readFile(docsPath, 'utf8'),
  ]);

  const entries = await validateManifest(manifest);
  validateDocs(docsText, entries);
  validateRelease(release, manifest, entries);
  console.log(`Skills ownership + placement manifest OK — ${entries.length} Specialists-owned skill(s)`);
}

main().catch((error) => {
  console.error(`Skills ownership check failed: ${error.message}`);
  process.exit(1);
});
