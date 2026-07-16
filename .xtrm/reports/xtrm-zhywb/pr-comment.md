## Dependency update: Vite/esbuild remediation

**Verdict: PASS_WITH_NOTES**

- Vite `8.0.12` → `8.0.16`.
- esbuild `0.27.4` → `0.28.1`.
- Reachability: dev-only CLI build/test tooling; not runtime-reachable or publicly exposed.
- Target OSV/npm audit: clean; root and CLI audits report 0 vulnerabilities.
- Compatibility: focused typecheck, tsup build, Vitest tests, and dependency-inspector tests passed.
- Gate: preserve explicit pins and reject lockfiles containing Vite `<=8.0.15` or esbuild `>=0.27.3 <0.28.1`.

Evidence: `upgrade-dossier.md`, `dependency_update_case.json`, and `dependency_update_case-esbuild.json`.
