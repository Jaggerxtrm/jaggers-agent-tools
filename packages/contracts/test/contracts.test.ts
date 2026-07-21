import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { SCHEMA_IDS, SCHEMA_ID, validate, getSchema, isValid, uuidV7TimestampMs } from '../src/index.js';

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

describe('Beads lifecycle event contract', () => {
    const id = 'xtrm.beads.lifecycle-event.v1';
    const base = {
        schema_version: id,
        source: 'beads.events',
        id: '019f847d-530b-77a1-9603-25eeeae6ea27',
        issue_id: 'xtrm-etmv4.2',
        actor: 'jaggerxtrm',
        old_value: { status: 'open' },
        new_value: { status: 'in_progress' },
        comment: null,
        created_at: '2026-07-21T13:43:53Z',
        occurred_at_ms: 1784634233611,
        timestamp_source: 'uuidv7',
    };

    it.each(['created', 'claimed', 'updated', 'closed', 'reopened', 'status_changed'])('accepts %s', (event_type) => {
        expect(validate(id, { ...base, event_type }).valid).toBe(true);
    });

    it('rejects legacy imperative aliases and hook sources', () => {
        expect(validate(id, { ...base, event_type: 'claim' }).valid).toBe(false);
        expect(validate(id, { ...base, event_type: 'claimed', source: 'xtrm-hook' }).valid).toBe(false);
    });

    it('derives UTC milliseconds from the UUIDv7 identity', () => {
        expect(uuidV7TimestampMs(base.id)).toBe(base.occurred_at_ms);
        expect(() => uuidV7TimestampMs('not-a-uuidv7')).toThrow(/UUIDv7/);
    });
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
