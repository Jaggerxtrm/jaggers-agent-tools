#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultRoot = path.join(repoRoot, '.xtrm', 'skills', 'default');
const optionalRoot = path.join(repoRoot, '.xtrm', 'skills', 'optional');
const KEBAB = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const FORBIDDEN_RUNTIME_DIRS = new Set(['.claude', '.agents', '.pi']);
const HARD_ROOT_LINE_BUDGET = 500;

const failures = [];
const seenRuntimeNames = new Map();

function fail(message) {
  failures.push(message);
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function directories(root) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

function parseFrontmatter(text, source) {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') {
    fail(`${source}: missing YAML frontmatter opening delimiter`);
    return { lines, name: null, description: null };
  }

  const end = lines.slice(1).findIndex((line) => line.trim() === '---');
  if (end < 0) {
    fail(`${source}: missing YAML frontmatter closing delimiter`);
    return { lines, name: null, description: null };
  }

  const front = lines.slice(1, end + 1);
  const nameLine = front.find((line) => /^name\s*:/.test(line));
  const name = nameLine ? nameLine.replace(/^name\s*:\s*/, '').trim().replace(/^['"]|['"]$/g, '') : null;

  const descIndex = front.findIndex((line) => /^description\s*:/.test(line));
  let description = null;
  if (descIndex >= 0) {
    const first = front[descIndex].replace(/^description\s*:\s*/, '').trim();
    if (first && !['>', '>-', '|', '|-'].includes(first)) {
      description = first.replace(/^['"]|['"]$/g, '').trim();
    } else {
      const body = [];
      for (let i = descIndex + 1; i < front.length; i += 1) {
        const line = front[i];
        if (/^[A-Za-z0-9_-]+\s*:/.test(line) && !/^\s/.test(line)) break;
        if (line.trim()) body.push(line.trim());
      }
      description = body.join(' ').trim();
    }
  }

  return { lines, name, description };
}

async function findForbiddenRuntimeDirs(root, relative = '') {
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const rel = path.posix.join(relative, entry.name);
    if (FORBIDDEN_RUNTIME_DIRS.has(entry.name)) {
      fail(`${path.relative(repoRoot, root)}: nested runtime root ${rel}`);
      continue;
    }
    await findForbiddenRuntimeDirs(path.join(root, entry.name), rel);
  }
}

async function validateSkill(skillDir, expectedName, location) {
  const skillPath = path.join(skillDir, 'SKILL.md');
  if (!await exists(skillPath)) {
    fail(`${location}: missing SKILL.md`);
    return;
  }

  const text = await fs.readFile(skillPath, 'utf8');
  const { lines, name, description } = parseFrontmatter(text, location);

  if (!name) fail(`${location}: frontmatter.name is required`);
  else {
    if (!KEBAB.test(name)) fail(`${location}: name must be kebab-case, got ${JSON.stringify(name)}`);
    if (name !== expectedName) fail(`${location}: frontmatter name ${JSON.stringify(name)} != directory ${JSON.stringify(expectedName)}`);

    const previous = seenRuntimeNames.get(name);
    if (previous) fail(`${location}: duplicate managed runtime skill name ${name}; first seen at ${previous}`);
    else seenRuntimeNames.set(name, location);
  }

  if (!description || description.length < 20) {
    fail(`${location}: frontmatter.description is required and must describe the routing contract`);
  }

  if (lines.length > HARD_ROOT_LINE_BUDGET) {
    fail(`${location}: SKILL.md is ${lines.length} lines; hard budget is ${HARD_ROOT_LINE_BUDGET}; move detail to references/scripts`);
  }

  await findForbiddenRuntimeDirs(skillDir);
}

async function validateDefault() {
  for (const name of await directories(defaultRoot)) {
    const dir = path.join(defaultRoot, name);
    const location = `.xtrm/skills/default/${name}`;
    if (!await exists(path.join(dir, 'SKILL.md'))) {
      fail(`${location}: direct default child directory is not a skill (missing SKILL.md)`);
      continue;
    }
    await validateSkill(dir, name, location);
  }
}

async function validateOptional() {
  for (const packName of await directories(optionalRoot)) {
    const packDir = path.join(optionalRoot, packName);
    const packPath = path.join(packDir, 'PACK.json');
    if (!await exists(packPath)) {
      fail(`.xtrm/skills/optional/${packName}: missing PACK.json`);
      continue;
    }

    let pack;
    try {
      pack = JSON.parse(await fs.readFile(packPath, 'utf8'));
    } catch (error) {
      fail(`.xtrm/skills/optional/${packName}/PACK.json: invalid JSON: ${error.message}`);
      continue;
    }

    if (!KEBAB.test(packName)) fail(`optional pack directory must be kebab-case: ${packName}`);
    if (pack.name !== packName) fail(`${packName}/PACK.json: name ${JSON.stringify(pack.name)} != directory ${JSON.stringify(packName)}`);
    if (!Array.isArray(pack.skills) || pack.skills.length === 0) {
      fail(`${packName}/PACK.json: skills must be a non-empty array`);
      continue;
    }

    const declared = new Set();
    for (const skillName of pack.skills) {
      if (typeof skillName !== 'string' || !KEBAB.test(skillName)) {
        fail(`${packName}/PACK.json: invalid skill name ${JSON.stringify(skillName)}`);
        continue;
      }
      if (declared.has(skillName)) fail(`${packName}/PACK.json: duplicate skill ${skillName}`);
      declared.add(skillName);

      const skillDir = path.join(packDir, skillName);
      if (!await exists(skillDir)) {
        fail(`${packName}/PACK.json: declared skill directory missing: ${skillName}`);
        continue;
      }
      await validateSkill(skillDir, skillName, `.xtrm/skills/optional/${packName}/${skillName}`);
    }

    const directDirs = await directories(packDir);
    for (const child of directDirs) {
      if (await exists(path.join(packDir, child, 'SKILL.md')) && !declared.has(child)) {
        fail(`.xtrm/skills/optional/${packName}/${child}: skill exists but is not declared in PACK.json`);
      }
    }
  }
}

await validateDefault();
await validateOptional();

if (failures.length) {
  console.error(`check-managed-skills failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`check-managed-skills passed — ${seenRuntimeNames.size} managed skill(s), unique names, valid roots/packs`);
