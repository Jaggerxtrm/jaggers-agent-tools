#!/usr/bin/env node
// Validate packages/pi-extensions/src/manifest.json against the
// xtrm.pi-extension-manifest.v1 shape.
//
// Enforced:
//   - top-level keys ⊆ {schema_version, active, disabled}
//   - schema_version === "xtrm.pi-extension-manifest.v1"
//   - active: array; each entry {id, displayName, required, ownership}
//     with correct types and ownership === "xtrm" (managed entries only)
//   - disabled: object; each value is a non-empty string reason
//   - ids unique across active and disabled
//
// Compatible with the existing runtime consumer at
// cli/src/core/pi-runtime.ts:82 (loadPiExtensionManifest), which
// tolerates extra fields but still requires id/displayName/required.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const manifestPath = path.join(repoRoot, 'packages', 'pi-extensions', 'src', 'manifest.json');

const EXPECTED_SCHEMA = 'xtrm.pi-extension-manifest.v1';
const ALLOWED_TOP_KEYS = new Set(['schema_version', 'active', 'disabled']);
const REQUIRED_ENTRY_FIELDS = ['id', 'displayName', 'required', 'ownership'];
const VALID_OWNERSHIP = new Set(['xtrm']);

function main() {
    if (!fs.existsSync(manifestPath)) {
        console.error(`Missing manifest: ${path.relative(repoRoot, manifestPath)}`);
        process.exit(1);
    }
    let manifest;
    try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (err) {
        console.error(`manifest.json is not valid JSON: ${err.message}`);
        process.exit(1);
    }

    const errors = [];

    if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
        errors.push('top-level must be a JSON object');
        report(errors);
    }

    if (manifest.schema_version !== EXPECTED_SCHEMA) {
        errors.push(`schema_version: expected "${EXPECTED_SCHEMA}", got ${JSON.stringify(manifest.schema_version)}`);
    }

    for (const key of Object.keys(manifest)) {
        if (!ALLOWED_TOP_KEYS.has(key)) {
            errors.push(`unknown top-level key: ${key}`);
        }
    }

    const ids = new Set();

    if (!Array.isArray(manifest.active)) {
        errors.push('active: expected array');
    } else {
        for (const [i, entry] of manifest.active.entries()) {
            if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
                errors.push(`active[${i}]: expected object`);
                continue;
            }
            for (const field of REQUIRED_ENTRY_FIELDS) {
                if (!(field in entry)) errors.push(`active[${i}]: missing ${field}`);
            }
            if (typeof entry.id !== 'string' || entry.id.length === 0) {
                errors.push(`active[${i}].id: expected non-empty string`);
            }
            if (typeof entry.displayName !== 'string' || entry.displayName.length === 0) {
                errors.push(`active[${i}].displayName: expected non-empty string`);
            }
            if (typeof entry.required !== 'boolean') {
                errors.push(`active[${i}].required: expected boolean`);
            }
            if (!VALID_OWNERSHIP.has(entry.ownership)) {
                errors.push(`active[${i}].ownership: expected one of ${[...VALID_OWNERSHIP].join(', ')}, got ${JSON.stringify(entry.ownership)}`);
            }
            if (typeof entry.id === 'string') {
                if (ids.has(entry.id)) errors.push(`duplicate id: ${entry.id}`);
                ids.add(entry.id);
            }
        }
    }

    if (manifest.disabled === null || typeof manifest.disabled !== 'object' || Array.isArray(manifest.disabled)) {
        errors.push('disabled: expected object');
    } else {
        for (const [id, reason] of Object.entries(manifest.disabled)) {
            if (typeof reason !== 'string' || reason.length === 0) {
                errors.push(`disabled["${id}"]: expected non-empty string`);
            }
            if (ids.has(id)) errors.push(`id "${id}" appears in both active and disabled`);
            ids.add(id);
        }
    }

    report(errors);
    const activeCount = Array.isArray(manifest.active) ? manifest.active.length : 0;
    const disabledCount = manifest.disabled ? Object.keys(manifest.disabled).length : 0;
    console.log(`Pi extension manifest ok: ${activeCount} active, ${disabledCount} disabled (schema ${manifest.schema_version}).`);
}

function report(errors) {
    if (errors.length === 0) return;
    console.error('Pi extension manifest validation failed:');
    for (const err of errors) console.error(`  - ${err}`);
    process.exit(1);
}

main();
