#!/usr/bin/env node
// Extract the draft-07 JSON Schemas that Codex embeds in its binary.
//
// This reproduces, verbatim, the capture_method recorded in the K1 fixture
// manifest (cli/src/tests/fixtures/codex/<version>/manifest.json). That was a
// hand-run procedure at capture time; the 0.146.0 -> 0.147.0 bump made it
// something we have to repeat, so it is a script now.
//
// Static extraction only: no Codex session is started and no hook is invoked,
// so the output holds schema documents and never instance data.
//
// Usage: node scripts/capture-codex-schemas.mjs <outDir> [codexBinary]

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';

const MARKER = '{\n  "$schema"';

function resolveCodex(explicit) {
    if (explicit) return explicit;
    const which = execFileSync('bash', ['-lc', 'command -v codex'], { encoding: 'utf8' }).trim();
    return execFileSync('readlink', ['-f', which], { encoding: 'utf8' }).trim();
}

// Scan forward with a string-aware brace-balance counter, tracking quotes and
// backslash escapes, until depth returns to 0. A naive counter terminates early
// on any brace that appears inside a string literal.
function extractFrom(text, start) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < text.length; i++) {
        const c = text[i];
        if (esc) { esc = false; continue; }
        if (c === '\\') { esc = true; continue; }
        if (c === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) return text.slice(start, i + 1); }
    }
    return null;
}

// Python's json.dumps(..., sort_keys=True) sorts recursively; JSON.stringify
// does not, so key order is normalised explicitly or every file would differ
// from the 0.146.0 set on ordering alone.
function sortKeys(value) {
    if (Array.isArray(value)) return value.map(sortKeys);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortKeys(value[k])]));
    }
    return value;
}

const outDir = process.argv[2];
if (!outDir) {
    console.error('usage: capture-codex-schemas.mjs <outDir> [codexBinary]');
    process.exit(2);
}
const binary = resolveCodex(process.argv[3]);

const bytes = readFileSync(binary);
// latin1 keeps a 1:1 byte<->char mapping, so string indices stay byte offsets.
const text = bytes.toString('latin1');

const occurrences = [];
for (let i = text.indexOf(MARKER); i !== -1; i = text.indexOf(MARKER, i + 1)) occurrences.push(i);

mkdirSync(outDir, { recursive: true });

const files = {};
for (const offset of occurrences) {
    const slice = extractFrom(text, offset);
    if (!slice) continue;
    let schema;
    try {
        schema = JSON.parse(Buffer.from(slice, 'latin1').toString('utf8'));
    } catch {
        continue;
    }
    const title = schema.title;
    if (typeof title !== 'string' || !title) continue;
    const out = `${JSON.stringify(sortKeys(schema), null, 2)}\n`;
    const name = `${title}.json`;
    writeFileSync(path.join(outDir, name), out);
    files[name] = {
        title,
        byte_offset: offset,
        byte_length: Buffer.byteLength(slice, 'latin1'),
        sha256: createHash('sha256').update(out).digest('hex'),
    };
}

console.log(JSON.stringify({
    binary,
    version: execFileSync(binary, ['--version'], { encoding: 'utf8' }).trim(),
    binary_bytes: bytes.length,
    occurrence_count: occurrences.length,
    extracted: Object.keys(files).length,
    byte_range_searched: occurrences.length
        ? [occurrences[0], occurrences[occurrences.length - 1]]
        : null,
    files,
}, null, 2));
