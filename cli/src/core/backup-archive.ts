// xtrm-zc1rs: safe archive validation + staged extraction for `migrate --restore`.
//
// Pre-fix, restoreBackup streamed `tar -xzf` straight into .xtrm/ and checked
// traversal only afterwards, so a crafted archive could write partial or wrong
// content into the destination before rejection (and some shapes were accepted
// outright). This module owns the restore archive path:
//
//   1. inspectBackupArchive  — parse every tar entry; reject absolute / `..`
//      names, symlink / hardlink / special entries, malformed or truncated
//      archives, and any entry outside the expected component root
//      (`skills/...` or `hooks/...`) BEFORE a single byte reaches the
//      destination. Archive bytes are parsed by us (stdlib zlib + tar format),
//      never trusted to tar's own extraction.
//   2. extractValidatedBackup — replay the already-validated entries into a
//      private mkdtemp staging dir (paths cannot escape: only regular
//      files/directories with validated relative names are written).
//   3. assertStagedTreeSafe — recursive lstat walk proving the staged tree
//      contains nothing but regular files and directories, then the caller
//      swaps it into place.
//
// Supported tar surface is deliberately narrow: USTAR/GNU headers with regular
// file ('0') and directory ('5') entries, GNU long-name ('L') entries (xtrm
// backups contain them for deep skill paths), and pax `path=` overrides ('x').
// Every other typeflag — links, devices, FIFOs, sparse, pax-global, long-link
// — is rejected. Checksums are verified (space- or NUL-filled, like GNU tar)
// so structurally corrupt headers cannot slip through.
//
// Diagnostics name archive entry paths and types, never file bodies.

import fs from 'fs-extra';
import path from 'node:path';
import zlib from 'node:zlib';

export type BackupComponent = 'skills' | 'hooks';

export interface ValidatedBackupEntry {
  /** POSIX-style relative path, no leading './', no '..', no empty segments. */
  relPath: string;
  kind: 'file' | 'dir';
  /** Stored mode (octal) from the archive header. */
  mode: number;
}

const COMPONENT_ROOT: Record<BackupComponent, string> = {
  skills: 'skills',
  hooks: 'hooks',
};

const ENTRY_TYPE_NAMES: Record<string, string> = {
  '1': 'hard link',
  '2': 'symbolic link',
  '3': 'character device',
  '4': 'block device',
  '6': 'FIFO',
  '7': 'contiguous file',
  S: 'sparse file',
};

function rejected(message: string): Error {
  return new Error(`Rejected backup archive: ${message}`);
}

function isZeroBlock(buf: Buffer): boolean {
  for (let i = 0; i < 512; i++) {
    if (buf[i] !== 0) return false;
  }
  return true;
}

function parseOctalField(buf: Buffer, offset: number, length: number): number {
  const raw = buf.subarray(offset, offset + length).toString('latin1').trim().split('\0')[0].trim();
  if (raw === '') return Number.NaN;
  return parseInt(raw, 8);
}

function cutAtNul(buf: Buffer): Buffer {
  const nul = buf.indexOf(0);
  return nul === -1 ? buf : buf.subarray(0, nul);
}

function tarHeaderName(header: Buffer): string {
  const name = cutAtNul(header.subarray(0, 100)).toString('utf8');
  const prefix = cutAtNul(header.subarray(345, 500)).toString('utf8');
  return prefix.length > 0 ? `${prefix}/${name}` : name;
}

function hasUstarMagic(header: Buffer): boolean {
  const magic = header.subarray(257, 263).toString('latin1');
  return magic === 'ustar\0' || magic === 'ustar ';
}

function verifyHeaderChecksum(header: Buffer): boolean {
  const stored = parseOctalField(header, 148, 8);
  if (Number.isNaN(stored)) return false;
  for (const fill of [0x20, 0]) {
    let sum = 0;
    for (let i = 0; i < 512; i++) {
      sum += i >= 148 && i < 156 ? fill : header[i];
    }
    if (sum === stored) return true;
  }
  return false;
}

/**
 * Normalize and validate a tar entry name. Rejects absolute paths, `..`
 * traversal, `.` segments, empty segments, and empty names. Returns a
 * POSIX-style relative path with no leading or trailing '/'.
 */
function normalizeEntryPath(rawName: string): string {
  let name = rawName;
  const nul = name.indexOf('\0');
  if (nul !== -1) name = name.slice(0, nul);
  if (name.endsWith('/')) name = name.slice(0, -1);
  if (name === '') throw rejected('empty entry name');
  if (name.startsWith('/')) {
    throw rejected(`absolute entry path '${name}'`);
  }
  const parts = name.split('/');
  for (const part of parts) {
    if (part === '') throw rejected(`malformed entry path '${name}'`);
    if (part === '.') throw rejected(`entry path '${name}' contains '.' segments`);
    if (part === '..') {
      throw rejected(`entry path '${name}' escapes the restore root ('..' traversal)`);
    }
  }
  return parts.join('/');
}

/** pax extended-header `path=` record, or null when the record is absent. */
function parsePaxPath(data: Buffer): string | null {
  const text = data.toString('utf8');
  let pos = 0;
  while (pos < text.length) {
    const nl = text.indexOf('\n', pos);
    if (nl === -1) break;
    const record = text.slice(pos, nl);
    const sp = record.indexOf(' ');
    if (sp === -1) break;
    const len = parseInt(record.slice(0, sp), 10);
    if (Number.isNaN(len)) break;
    const eq = record.indexOf('=', sp + 1);
    if (eq === -1) break;
    if (record.slice(sp + 1, eq) === 'path') return record.slice(eq + 1);
    pos += len;
  }
  return null;
}

/**
 * Walk a decompressed tar byte buffer, validating every header and invoking
 * `onEntry` for each accepted regular file / directory with its raw data
 * (empty when `skipData`). Throws on the first unsafe or malformed entry, so
 * a full scan rejects the archive before extraction begins.
 */
function walkTarBuffer(
  buf: Buffer,
  component: BackupComponent,
  onEntry: (entry: ValidatedBackupEntry, data: Buffer) => void,
  skipData: boolean,
): void {
  const root = COMPONENT_ROOT[component];
  let pos = 0;
  let pendingLongName: string | null = null;
  let pendingPaxPath: string | null = null;

  while (pos + 512 <= buf.length) {
    const header = buf.subarray(pos, pos + 512);
    if (isZeroBlock(header)) {
      // End-of-archive marker: a second zero block (or clean EOF) closes it.
      const next = buf.subarray(pos + 512, pos + 1024);
      if (next.length === 0 || isZeroBlock(next)) return;
      throw rejected(`unexpected lone zero block at offset ${pos}`);
    }
    if (!hasUstarMagic(header) || !verifyHeaderChecksum(header)) {
      throw rejected(`malformed tar header at offset ${pos} (bad magic or checksum)`);
    }

    const typeflag = String.fromCharCode(header[156]);
    const size = parseOctalField(header, 124, 12);
    if (Number.isNaN(size) || size < 0) {
      throw rejected(`malformed size field at offset ${pos}`);
    }
    const dataStart = pos + 512;
    const dataEnd = dataStart + size;
    const paddedEnd = dataStart + Math.ceil(size / 512) * 512;
    if (dataEnd > buf.length) {
      throw rejected(`truncated archive: entry at offset ${pos} claims ${size} bytes of data`);
    }
    const data = buf.subarray(dataStart, dataEnd);

    if (typeflag === 'L') {
      pendingLongName = cutAtNul(data).toString('utf8');
      pos = paddedEnd;
      continue;
    }
    if (typeflag === 'x') {
      pendingPaxPath = parsePaxPath(data);
      pos = paddedEnd;
      continue;
    }
    if (typeflag === 'g' || typeflag === 'K') {
      throw rejected(`unsupported tar extension entry (${typeflag === 'g' ? 'global pax header' : 'long link name'})`);
    }

    let rawName: string;
    if (pendingLongName !== null) {
      rawName = pendingLongName;
      pendingLongName = null;
    } else if (pendingPaxPath !== null) {
      rawName = pendingPaxPath;
      pendingPaxPath = null;
    } else {
      rawName = tarHeaderName(header);
    }

    const linkKind = ENTRY_TYPE_NAMES[typeflag];
    if (linkKind !== undefined) {
      throw rejected(`entry '${rawName}' is a ${linkKind}; restorable backups contain only regular files and directories`);
    }
    if (typeflag !== '0' && typeflag !== '\0' && typeflag !== '5') {
      throw rejected(`entry has unsupported tar type '${typeflag}'`);
    }

    const relPath = normalizeEntryPath(rawName);
    if (relPath !== root && !relPath.startsWith(`${root}/`)) {
      throw rejected(
        `entry '${relPath}' is outside the ${component} restore root — expected '${root}/...' layout`,
      );
    }

    onEntry(
      {
        relPath,
        kind: typeflag === '5' ? 'dir' : 'file',
        mode: parseOctalField(header, 100, 8) || 0o644,
      },
      skipData ? Buffer.alloc(0) : data,
    );
    pos = paddedEnd;
  }

  throw rejected('truncated archive: no end-of-archive marker');
}

function readArchiveBytes(archivePath: string): Buffer {
  let data: Buffer;
  try {
    data = fs.readFileSync(archivePath);
  } catch (error) {
    throw new Error(`Failed to read backup archive: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b) {
    try {
      return zlib.gunzipSync(data);
    } catch {
      throw rejected('corrupt gzip data');
    }
  }
  // Plain (uncompressed) tar is accepted for parity with `tar -xzf` autodetect.
  return data;
}

/**
 * Pre-scan an operator-supplied backup archive. Throws before any destination
 * mutation on: absolute / `..` paths, symlink / hardlink / special entries,
 * malformed or truncated archives, entries outside the component root, and a
 * skills backup missing `skills/default/`. Returns the validated entry list.
 */
export function inspectBackupArchive(archivePath: string, component: BackupComponent): ValidatedBackupEntry[] {
  const buf = readArchiveBytes(archivePath);
  const entries: ValidatedBackupEntry[] = [];
  walkTarBuffer(buf, component, (entry) => {
    entries.push(entry);
  }, true);
  if (entries.length === 0) {
    throw rejected('contains no entries');
  }
  if (component === 'skills') {
    const hasDefault = entries.some(
      (entry) => entry.relPath === 'skills/default' || entry.relPath.startsWith('skills/default/'),
    );
    if (!hasDefault) {
      throw rejected("skills backup must contain 'skills/default/' (unexpected layout)");
    }
  }
  return entries;
}

/**
 * Replay validated entries into `stagingDir` (a private mkdtemp dir). Only
 * regular files and directories with validated relative paths are written, so
 * nothing can escape the staging area. Modes are applied after all entries
 * exist so a restrictive directory mode cannot block later writes.
 */
export function extractValidatedBackup(
  archivePath: string,
  component: BackupComponent,
  stagingDir: string,
): void {
  const buf = readArchiveBytes(archivePath);
  const chmodQueue: Array<{ target: string; mode: number }> = [];
  walkTarBuffer(buf, component, (entry, data) => {
    const dest = path.join(stagingDir, ...entry.relPath.split('/'));
    if (entry.kind === 'dir') {
      fs.mkdirSync(dest, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, data, { mode: 0o600 });
    }
    chmodQueue.push({ target: dest, mode: entry.mode & 0o777 });
  }, false);
  for (const { target, mode } of chmodQueue) {
    fs.chmodSync(target, mode);
  }
}

function describeStagedEntryType(stats: fs.Stats): string {
  if (stats.isSymbolicLink()) return 'a symbolic link';
  if (stats.isFIFO()) return 'a FIFO';
  if (stats.isSocket()) return 'a socket';
  if (stats.isCharacterDevice()) return 'a character device';
  if (stats.isBlockDevice()) return 'a block device';
  return 'a special entry';
}

/**
 * Recursive lstat walk of the staged tree: proves every node is a regular file
 * or directory (no links, no special entries that could alias or block), the
 * top level is exactly the component root, and a skills tree contains
 * `skills/default/`.
 */
export async function assertStagedTreeSafe(stagingDir: string, component: BackupComponent): Promise<void> {
  const root = COMPONENT_ROOT[component];
  const top = await fs.readdir(stagingDir, { withFileTypes: true });
  const topNames = top.map((entry) => entry.name).sort();
  if (topNames.length !== 1 || topNames[0] !== root) {
    throw rejected(
      `staged tree root is '${topNames.join(', ') || '(empty)'}', expected '${root}'`,
    );
  }
  const stack: string[] = [stagingDir];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const target = path.join(dir, entry.name);
      const stats = await fs.lstat(target);
      const rel = path.relative(stagingDir, target).split(path.sep).join('/');
      if (stats.isDirectory()) {
        stack.push(target);
      } else if (!stats.isFile()) {
        throw rejected(`staged entry '${rel}' is ${describeStagedEntryType(stats)}`);
      }
    }
  }
  if (component === 'skills') {
    const defaultDir = path.join(stagingDir, 'skills', 'default');
    if (!(await fs.pathExists(defaultDir))) {
      throw rejected("skills backup missing 'skills/default/' (expected layout)");
    }
  }
}
