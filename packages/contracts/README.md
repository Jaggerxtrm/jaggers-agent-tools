# @xtrm/contracts

Shared cross-runtime contracts for the xtrm ecosystem (Core ⇄ Specialists ⇄ xtmux).
Publishes the wire/record schemas the three repos agree on, as **JSON Schemas**
(source of truth) plus **TypeScript types**, **ajv runtime validators**, and
**golden fixtures**. Audit item **P2-02**.

## Layout

| Path | What |
|---|---|
| `schemas/*.json` | JSON Schema (draft-07) per contract, `$id` = schema id. The source of truth. |
| `src/validate.ts` | ajv registry: `validate`, `assertValid`, `getValidator`, `getSchema`, `SCHEMA_IDS`. |
| `src/types.ts` | Hand-authored TS types mirroring the schemas + `SCHEMA_ID` constants + `ContractTypeMap`. |
| `fixtures/golden.json` | One valid golden payload per schema. |
| `fixtures/invalid.json` | One intentionally-invalid payload per schema (negative fixtures). |
| `test/contracts.test.ts` | Proves every golden validates, every invalid is rejected, and id coverage. |

## Usage

```ts
import { validate, assertValid, isValid, SCHEMA_ID } from '@xtrm/contracts';
import type { RuntimeOriginV1 } from '@xtrm/contracts';

const { valid, errors } = validate(SCHEMA_ID.runtimeOrigin, payload);
assertValid('xtrm.branch.integration.v1', event); // throws with a readable message
if (isValid(SCHEMA_ID.piExtensionManifest, data)) { /* data: PiExtensionManifestV1 */ }
```

Consumers who only want the raw schemas can read `@xtrm/contracts/schemas/<id>.json`.

## Contracts

Core: `xtrm.runtime-compatibility.v1`, `xtrm.interactive-role-envelope.v1`,
`xtrm.pi-extension-manifest.v1`, `xtrm.command-deprecations.v1`, `xtrm.runtime-matrix.v1`.
Lineage/observability: `xtrm.runtime-origin.v1`, `xtrm.branch.integration.v1`.
xtmux runtime: `xtrm.xtmux.topology.v1`, `xtrm.xtmux.message.v1`, `xtrm.xtmux.obligation.v1`,
`xtrm.xtmux.monitor.v1`, `xtrm.xtmux.wait.v1`, `xtrm.xtmux.bridge.v1`, `xtrm.agent-role-launched.v1`.
Legacy specialists: `xtrm.specialist-role-envelope.v1` (registry version `"1"`).

Each schema documents its authoritative source file in its `description`. The
JSON Schema is the source of truth — the TS types mirror it and the fixture test
guards their agreement.

## Scripts

```
npm run build      # tsup → dist (esm + cjs + d.ts)
npm run typecheck  # tsc --noEmit
npm test           # vitest
```

## Notes

- Un-versioned xtmux CLI responses (message/obligation/monitor/wait) carry no
  `schema_version` on the wire; their schemas mirror the current CLI output shape.
- `format` (e.g. `date-time`) is documentation only — not enforced (no ajv-formats dep).
- This package does **not** yet feed the existing `scripts/check-*.mjs` gates or
  `docs/runtime-compatibility.json`; wiring runtime code to consume these
  validators is a separate follow-up (per the P2-02 brief).
