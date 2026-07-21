import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { SCHEMA_IDS, SCHEMA_ID, validate, getSchema, isValid } from '../src/index.js';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const golden = JSON.parse(readFileSync(path.join(fixturesDir, 'golden.json'), 'utf8')) as Record<string, unknown>;
const invalid = JSON.parse(readFileSync(path.join(fixturesDir, 'invalid.json'), 'utf8')) as Record<string, unknown>;

describe('@xtrm/contracts registry', () => {
    it('exposes every declared SCHEMA_ID as a loadable schema', () => {
        for (const id of Object.values(SCHEMA_ID)) {
            expect(SCHEMA_IDS, `SCHEMA_ID.${id} missing from loaded schemas`).toContain(id);
            expect(getSchema(id), `schema ${id} not loadable`).toBeTruthy();
        }
    });

    it('loaded schema set exactly matches the SCHEMA_ID constants (no orphans, no gaps)', () => {
        expect([...SCHEMA_IDS].sort()).toEqual([...Object.values(SCHEMA_ID)].sort());
    });

    it('every schema ships a golden + invalid fixture', () => {
        for (const id of SCHEMA_IDS) {
            expect(golden, `golden fixture missing for ${id}`).toHaveProperty(id);
            expect(invalid, `invalid fixture missing for ${id}`).toHaveProperty(id);
        }
    });
});

describe('golden fixtures validate', () => {
    for (const id of SCHEMA_IDS) {
        it(`accepts the golden payload for ${id}`, () => {
            const result = validate(id, golden[id]);
            expect(result.errors, `${id}: ${JSON.stringify(result.errors)}`).toEqual([]);
            expect(result.valid).toBe(true);
        });
    }
});

describe('invalid fixtures are rejected', () => {
    for (const id of SCHEMA_IDS) {
        it(`rejects the fabricated invalid payload for ${id}`, () => {
            expect(validate(id, invalid[id]).valid).toBe(false);
        });
    }
});

describe('validator behavior', () => {
    it('rejects a fabricated invalid pi-extension manifest (audit acceptance criterion)', () => {
        const fabricated = {
            schema_version: 'xtrm.pi-extension-manifest.v1',
            active: [{ id: 'evil', displayName: 'evil', required: 'not-a-boolean' }],
            disabled: { foo: '' },
        };
        const { valid, errors } = validate(SCHEMA_ID.piExtensionManifest, fabricated);
        expect(valid).toBe(false);
        expect(errors.length).toBeGreaterThan(0);
    });

    it('isValid narrows a valid runtime-origin payload', () => {
        expect(isValid(SCHEMA_ID.runtimeOrigin, golden[SCHEMA_ID.runtimeOrigin])).toBe(true);
        expect(isValid(SCHEMA_ID.runtimeOrigin, { nope: true })).toBe(false);
    });

    it('throws on an unknown schema id', () => {
        expect(() => validate('xtrm.not-a-real-schema.v1', {})).toThrow(/Unknown contract schema id/);
    });
});
