#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const manifestPath = path.join(repoRoot, '.xtrm', 'specialists-source.json');
const defaultRoot = path.join(repoRoot, '.xtrm', 'skills', 'default');
const optionalRoot = path.join(repoRoot, '.xtrm', 'skills', 'optional');

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function hashFile(filePath) {
  return crypto.createHash('sha256').update(await fs.readFile(filePath)).digest('hex');
}

async function collectFileHashes(rootDir) {
  const files = {};
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectFileHashes(absolutePath);
      for (const [relativePath, hash] of Object.entries(nested)) {
        files[path.posix.join(entry.name, relativePath)] = hash;
      }
    } else if (entry.isFile()) {
      files[entry.name] = await hashFile(absolutePath);
    }
  }
  return files;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function destinationDir(manifest, skillName) {
  const placement = manifest.placements?.[skillName] ?? { tier: 'default' };
  if (placement.tier === 'default') return path.join(defaultRoot, skillName);
  assert(placement.tier === 'optional' && placement.pack, `invalid placement for ${skillName}`);
  return path.join(optionalRoot, placement.pack, skillName);
}

async function main() {
  const manifest = await readJson(manifestPath);
  assert(manifest.version === 2, 'manifest version mismatch; expected v2 placement-aware manifest');
  assert(Array.isArray(manifest.skills) && manifest.skills.length > 0, 'manifest skills missing');
  assert(manifest.source?.resolved_sha, 'manifest source.resolved_sha missing');
  assert(manifest.placements && typeof manifest.placements === 'object', 'manifest placements missing');

  for (const skillName of manifest.skills) {
    const skillDir = destinationDir(manifest, skillName);
    const expectedFiles = manifest.files?.[skillName] ?? {};
    const actualFiles = await collectFileHashes(skillDir);
    const expectedPaths = Object.keys(expectedFiles).sort();
    const actualPaths = Object.keys(actualFiles).sort();

    assert(JSON.stringify(expectedPaths) === JSON.stringify(actualPaths), `file set mismatch for ${skillName}`);
    for (const relativePath of expectedPaths) {
      assert(actualFiles[relativePath] === expectedFiles[relativePath], `hash mismatch for ${skillName}/${relativePath}`);
    }
  }

  console.log(`Specialists vendor manifest OK — ${manifest.skills.length} skill(s) @ ${manifest.source.resolved_sha.slice(0, 12)}`);
}

main().catch((error) => {
  console.error(`Specialists vendor verify failed: ${error.message}`);
  process.exit(1);
});
