# Post-update watch spec

Scope: dependency installation and CLI build/test only.

Observe the first clean install and subsequent security sweep for:

- `npm audit` regressions involving Vite or esbuild.
- `vite`/`esbuild` resolution changing away from `8.0.16`/`0.28.1`.
- CLI typecheck, tsup bundle, or Vitest startup failures.
- Any unexpected Pi runtime or packaged dependency changes.

Escalate to the dependency owner if a vulnerable lockfile entry returns or if build/test failures indicate an unsupported parent-tool range.
