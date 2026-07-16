# Upgrade Dossier — Vite 8.0.12 → 8.0.16; esbuild 0.27.4 → 0.28.1

case_id: `dep-618b7a71418a`, `dep-02df92f4af0d` · verdict: **PASS_WITH_NOTES**

## Summary
Updated the development-only Vite/esbuild toolchain to versions with no matching OSV/npm audit advisories. Vite is pinned through the existing override path and CLI dev tooling is explicit so npm and pnpm lockfiles resolve the patched esbuild release. No Pi runtime source or production dependency changed.

## Trigger
Advisory remediation for `xtrm-dev/core`, branch `xt/2x1m`.

## Package / version diff
- `vite`: `8.0.12` → `8.0.16` (patch, transitive build/test tooling; scope inferred from Vitest usage).
- `esbuild`: `0.27.4` → `0.28.1` (minor, transitive build tooling; scope inferred from tsup/tsx usage).
- Changed manifests: `package.json`, `cli/package.json`.
- Changed lockfiles: `package-lock.json`, `cli/package-lock.json`, `cli/pnpm-lock.yaml`.

## Source matrix
- **Tier 1 — authoritative:** baseline and post-update `npm audit --json`; OSV-backed advisory IDs/ranges; npm registry versions, release times, engines, peer dependencies; final lockfiles.
- **Tier 2 — migration semantics:** published Vite 8.0.16 peer range accepts `esbuild ^0.27.0 || ^0.28.0`; Vitest 4.1.6 accepts Vite `^8.0.0`; local tsup/tsx manifests retain their existing build API surface.
- **Tier 3 — threat intelligence:** not consulted; no strong supply-chain signal was observed in Tier 1 evidence.
- **Tier 4 — community:** not used; community signals never block alone.

## Security context
Baseline audit: 2 findings — Vite high (`GHSA-fx2h-pf6j-xcff`) plus moderate-range `GHSA-v6wh-96g9-6wx`, and esbuild low (`GHSA-g7r4-m6w7-qqqr`). Both are dev-only and not runtime-reachable (`runtime_reachable=no`, `publicly_exposed_path=no`). Target-version OSV inspection returned no advisories; post-update npm audit is clean. No KEV, public exploit, or malicious-package signal was identified. The Vite CVSS 7.5 finding is advisory, not SECURITY_FORCED under the local policy because the affected path is not runtime-reachable and no active-exploitation signal was observed.

## Supply-chain context
Both target releases are registry-normal and beyond the 168-hour cooldown: Vite approximately 1,087 hours; esbuild approximately 834 hours. No maintainer change, install-script change, or artifact mismatch was detected; artifact mismatch remains `unknown` because no SBOM/provenance artifact was supplied.

## Compatibility / migration notes
No API migration is required. Vite 8.0.16 and esbuild 0.28.1 satisfy the supported Vite/Vitest peer ranges. The CLI keeps its existing tsup/tsx/vitest versions; esbuild is pinned explicitly to prevent their broad/transitive ranges from reintroducing the vulnerable release.

## Local usage map
Affected service: CLI build/test tooling only. The lockfile marks these packages as dev dependencies and source usage is limited to Vitest/Vite test tooling plus tsup/tsx bundling. No Pi runtime behavior, shipped CLI dependency, GitHub Action, or public request path is affected.

## Service-skill impact
No service-skill dependency surface was found. Relevant health checks are npm audit, CLI typecheck, direct tsup build, and focused Vitest tests. Watch signals are build failures, test startup failures, or a reintroduced vulnerable lockfile entry.

## Tests
- `node --test scripts/dep-inspect.test.mjs` — 11 passed.
- `cd cli && npm run typecheck` — passed.
- `cd cli && npx tsup --out-dir .xtrm/cache/dependency-build-check` — passed; output was temporary and removed.
- `cd cli && npx vitest run test/config-schema.test.ts test/docs-scanner.unit.test.ts` — passed.
- Root and CLI `npm audit --package-lock-only --json` — 0 vulnerabilities.
- Lockfile review found only Vite 8.0.16 and esbuild 0.28.1; stale Vite 8.0.12 and esbuild 0.27.x entries are absent.

## Verdict
**PASS_WITH_NOTES** — Tier 1 target-version audit/OSV evidence is clean and the deterministic cases are `safe_candidate` with cleared cooldown. Keep the explicit manifest pins and retain the focused audit/build/test gates because parent tooling declares ranges that otherwise permit vulnerable esbuild versions.

## Required gates
Run root and CLI npm audit plus focused CLI typecheck/build/tests before merge. Reject any lockfile containing Vite `<=8.0.15` or esbuild `>=0.27.3 <0.28.1`.

## Deploy notes
Development-toolchain-only remediation. No deploy or Pi runtime rollout is required.

## Post-deploy watch spec
See `post-deploy-watch-spec.md`; observe the next dependency install/build and security sweep.

## Follow-up tasks
None. The missing provenance/SBOM field is a noted evidence limitation, not a code follow-up.
