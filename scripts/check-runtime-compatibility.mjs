#!/usr/bin/env node
// Validate docs/runtime-compatibility.json:
//   - shape matches xtrm.runtime-compatibility.v1
//   - core.requires.node matches root package.json engines.node
//   - every referenced schema_version constant follows xtrm.<kebab>.v<int>
//
// Build-time gate. Not consulted at CLI startup.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const compatPath = path.join(repoRoot, 'docs', 'runtime-compatibility.json');
const rootPkgPath = path.join(repoRoot, 'package.json');

const EXPECTED_SCHEMA = 'xtrm.runtime-compatibility.v1';
const REQUIRED_TOP = ['schema_version', 'core', 'contracts'];
const REQUIRED_CORE_REQUIRES = ['specialists', 'xtmux', 'node'];
// Allow multi-segment names: xtrm.xtmux.bridge.v1, xtrm.pi-extension-manifest.v1, …
const SCHEMA_ID_RE = /^xtrm\.[a-z][\w.-]*\.v\d+$/;

function main() {
    if (!fs.existsSync(compatPath)) {
        console.error(`Missing: ${path.relative(repoRoot, compatPath)}`);
        process.exit(1);
    }
    const compat = JSON.parse(fs.readFileSync(compatPath, 'utf8'));
    const errors = [];

    for (const key of REQUIRED_TOP) {
        if (!(key in compat)) errors.push(`missing top-level ${key}`);
    }
    if (compat.schema_version !== EXPECTED_SCHEMA) {
        errors.push(`schema_version: expected ${EXPECTED_SCHEMA}, got ${compat.schema_version}`);
    }

    const core = compat.core ?? {};
    if (!core.package) errors.push('core.package missing');
    if (!core.requires) errors.push('core.requires missing');
    else {
        for (const dep of REQUIRED_CORE_REQUIRES) {
            if (!core.requires[dep]) errors.push(`core.requires.${dep} missing`);
        }
    }

    // Cross-check node minimum matches root package.json engines.node.
    const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8'));
    const enginesNode = rootPkg.engines?.node;
    const contractNode = core.requires?.node;
    if (enginesNode && contractNode && enginesNode !== contractNode) {
        errors.push(
            `node range mismatch: package.json engines.node=${enginesNode} vs docs/runtime-compatibility.json core.requires.node=${contractNode}`
        );
    }

    const contracts = compat.contracts ?? {};
    if (typeof contracts !== 'object' || Array.isArray(contracts)) {
        errors.push('contracts: expected object');
    } else {
        for (const [name, id] of Object.entries(contracts)) {
            if (typeof id !== 'string' || (id !== '1' && !SCHEMA_ID_RE.test(id))) {
                errors.push(`contracts.${name}: expected xtrm.<kebab>.v<int> (or literal "1"), got ${JSON.stringify(id)}`);
            }
        }
    }

    if (errors.length) {
        console.error('runtime-compatibility validation failed:');
        for (const err of errors) console.error(`  - ${err}`);
        process.exit(1);
    }
    console.log(`Runtime compatibility ok: core requires specialists ${core.requires.specialists}, xtmux ${core.requires.xtmux}, node ${core.requires.node}.`);
}

main();
