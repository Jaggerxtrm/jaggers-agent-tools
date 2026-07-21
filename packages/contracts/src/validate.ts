import { Ajv, type ValidateFunction, type ErrorObject } from 'ajv';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Schemas ship as static JSON under ../schemas (sibling of both src/ and dist/,
// so this resolves the same whether running from source or the packed build).
const schemasDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'schemas');

export type JsonSchema = Record<string, unknown> & { $id: string };

function loadSchemas(): JsonSchema[] {
    return readdirSync(schemasDir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => JSON.parse(readFileSync(path.join(schemasDir, f), 'utf8')) as JsonSchema);
}

// strict:false — contract ids (e.g. "xtrm.runtime-origin.v1") are intentionally
// not URIs, and we lean on draft-07 `const`; neither should be a strict-mode error.
// validateFormats:false — `format` (e.g. date-time) is kept as documentation only;
// enforcing it would need ajv-formats. Keeps output clean and dependency-light.
// allErrors defaults to false (fail-fast): a validator that may see cross-repo
// payloads shouldn't let a crafted input balloon the error array (DoS).
const ajv = new Ajv({ strict: false, validateFormats: false });
const schemas = loadSchemas();
for (const schema of schemas) ajv.addSchema(schema);

/** All contract schema ids shipped by this package, sorted. */
export const SCHEMA_IDS: readonly string[] = schemas.map((s) => s.$id).sort();

/** Return the raw JSON Schema object for a contract id, or undefined. */
export function getSchema(id: string): JsonSchema | undefined {
    return schemas.find((s) => s.$id === id);
}

/** Compiled ajv validator for a contract id. Throws on unknown id. */
export function getValidator(id: string): ValidateFunction {
    const validator = ajv.getSchema(id);
    if (!validator) {
        throw new Error(`Unknown contract schema id: ${id}. Known ids: ${SCHEMA_IDS.join(', ')}`);
    }
    return validator as ValidateFunction;
}

export interface ValidationResult {
    valid: boolean;
    errors: ErrorObject[];
}

/** Validate data against a contract schema. Never throws on invalid data. */
export function validate(id: string, data: unknown): ValidationResult {
    const validator = getValidator(id);
    const valid = validator(data) as boolean;
    return { valid, errors: valid ? [] : validator.errors ?? [] };
}

/** Validate and throw a readable error if invalid. */
export function assertValid(id: string, data: unknown): void {
    const { valid, errors } = validate(id, data);
    if (!valid) {
        const detail = errors.map((e) => `${e.instancePath || '/'} ${e.message}`).join('; ');
        throw new Error(`Contract ${id} validation failed: ${detail}`);
    }
}
