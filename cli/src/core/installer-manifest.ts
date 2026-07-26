import fs from 'fs-extra';
import path from 'node:path';

// xtrm-wiy5n.4.37 — the installer must never delete a file it cannot prove it
// wrote. A manifest of what the previous install shipped is the proof.
// Chosen over per-file `_source` markers because (1) skill/hook payloads are
// arbitrary content (Markdown, JSON, binaries) that per-file markers would
// intrude on, (2) one manifest write per install is atomic, (3) an untagged
// entry has no per-file marker to forge or strip, and (4) an absent manifest
// safely means "own nothing" — no legacy user file can be mistaken for ours.

export const INSTALLER_MANIFEST_FILENAME = '.installer-manifest.json';

// Installer metadata at the root of a tracked tree must never be recorded as
// shipped payload. `__pycache__` is skipped at every depth because
// bytecode caches can appear anywhere; the metadata names apply only to the
// top level, so a legitimately shipped file deeper in the tree that happens to
// be called `state.json` is preserved.
const RESERVED_ROOT_NAMES = new Set([INSTALLER_MANIFEST_FILENAME, 'state.json']);

export async function listFilesUnder(root: string): Promise<string[]> {
  const files: string[] = [];
  const resolvedRoot = path.resolve(root);
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const atRoot = path.resolve(dir) === resolvedRoot;
    for (const entry of entries) {
      if (entry.name === '__pycache__') continue;
      if (atRoot && RESERVED_ROOT_NAMES.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        files.push(path.relative(root, full));
      }
    }
  }
  if (await fs.pathExists(root)) await walk(root);
  return files.sort();
}

// xtrm-wiy5n.4.37 (Codex P1) — if any directory between the tracked root and a
// manifest entry is a symlink, `fs.remove(abs)` follows the parent-dir link and
// deletes a file OUTSIDE the managed root. The lexical `startsWith` check does
// not catch this because it operates on unresolved strings. Refuse to remove
// any tracked path whose ancestor chain crosses a symlink.
async function ancestorIsSymlink(root: string, absTarget: string): Promise<boolean> {
  const rel = path.relative(root, absTarget);
  if (!rel || rel === '' || rel.startsWith('..' + path.sep) || rel === '..') return true;
  const parts = rel.split(path.sep).filter(Boolean);
  let current = root;
  for (let i = 0; i < parts.length - 1; i++) {
    current = path.join(current, parts[i]);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) return true;
    } catch {
      // Ancestor does not exist — nothing to follow, so no traversal risk.
      return false;
    }
  }
  return false;
}

export async function removeTrackedEntries(root: string, relPaths: readonly string[]): Promise<void> {
  const resolvedRoot = path.resolve(root);
  const rootPrefix = resolvedRoot + path.sep;
  for (const rel of relPaths) {
    const abs = path.resolve(resolvedRoot, rel);
    // ponytail: manifest entries came from an earlier write of ours, but a
    // corrupted or hand-edited manifest could still smuggle in `..` — refuse
    // any path that escapes the tracked root.
    if (abs !== resolvedRoot && !abs.startsWith(rootPrefix)) continue;
    if (abs === resolvedRoot) continue;
    if (await ancestorIsSymlink(resolvedRoot, abs)) continue;
    await fs.remove(abs);
  }
}

export async function pruneEmptyDirsUnder(root: string): Promise<void> {
  if (!await fs.pathExists(root)) return;
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const child = path.join(root, entry.name);
    await pruneEmptyDirsUnder(child);
    const remaining = await fs.readdir(child);
    if (remaining.length === 0) await fs.rmdir(child);
  }
}

export async function readManifestJson<T>(manifestPath: string, fallback: T): Promise<T> {
  if (!await fs.pathExists(manifestPath)) return fallback;
  try {
    return await fs.readJson(manifestPath) as T;
  } catch {
    return fallback;
  }
}

export async function writeManifestJson(manifestPath: string, payload: unknown): Promise<void> {
  await fs.ensureDir(path.dirname(manifestPath));
  await fs.writeJson(manifestPath, payload, { spaces: 2 });
  await fs.appendFile(manifestPath, '\n');
}
