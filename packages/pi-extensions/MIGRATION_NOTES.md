# Pi extension source migration notes (P2)

## Legacy → new source map

| Legacy path | New path | Notes |
|---|---|---|
| `packages/pi-extensions/extensions/auto-session-name` | `packages/pi-extensions/extensions/auto-session-name` | extension source moved unchanged |
| `packages/pi-extensions/extensions/beads` | `packages/pi-extensions/extensions/beads` | now imports `../../src/core` |
| `packages/pi-extensions/extensions/compact-header` | `packages/pi-extensions/extensions/compact-header` | extension source moved unchanged |
| `packages/pi-extensions/extensions/custom-footer` | `packages/pi-extensions/extensions/custom-footer` | now imports `../../src/core` |
| `packages/pi-extensions/extensions/custom-provider-qwen-cli` | `packages/pi-extensions/extensions/custom-provider-qwen-cli` | extension source moved unchanged |
| `packages/pi-extensions/extensions/git-checkpoint` | `packages/pi-extensions/extensions/git-checkpoint` | extension source moved unchanged |
| `packages/pi-extensions/extensions/lsp-bootstrap` | `packages/pi-extensions/extensions/lsp-bootstrap` | extension source moved unchanged |
| `packages/pi-extensions/extensions/pi-serena-compact` | `packages/pi-extensions/extensions/pi-serena-compact` | extension source moved unchanged |
| `packages/pi-extensions/extensions/quality-gates` | `packages/pi-extensions/extensions/quality-gates` | now imports `../../src/core` |
| `packages/pi-extensions/extensions/service-skills` | `packages/pi-extensions/extensions/service-skills` | now imports `../../src/core` |
| `packages/pi-extensions/extensions/session-flow` | `packages/pi-extensions/extensions/session-flow` | now imports `../../src/core` |
| `packages/pi-extensions/extensions/xtrm-loader` | `packages/pi-extensions/extensions/xtrm-loader` | now imports `../../src/core` |
| `packages/pi-extensions/extensions/xtrm-ui` | `packages/pi-extensions/extensions/xtrm-ui` | theme assets moved to package-level `themes/xtrm-ui` |
| `packages/pi-extensions/src/core` | `packages/pi-extensions/src/core` | internal helpers; no separate `@xtrm/pi-core` package required |
| `~/.pi/agent/extensions/python-kernel.ts` (user-local loose file) | `packages/pi-extensions/extensions/python-kernel` | persistent sequential python3 tool moved into the managed package (xtrm-3ljgz.1) |

## python-kernel (xtrm-3ljgz.1)

- The persistent `python` tool moved from the user-local
  `~/.pi/agent/extensions/python-kernel.ts` into the managed package.
- **Prerequisite:** `python3` must be on PATH. A missing interpreter is
  reported as a structured tool error on every call — the host never crashes.
- **Manual loose-file migration:** compare the managed copy against your local
  file for customisations, apply them to the managed copy if needed, then
  delete `~/.pi/agent/extensions/python-kernel.ts` yourself and restart pi (or
  `/reload`). xt never deletes user-owned loose files.
- `xt update` recognises a local source checkout
  (`../../dev/core/packages/pi-extensions` in `~/.pi/agent/settings.json`) as
  the same managed package and will not register the npm copy beside it.

## Asset migration

- `xtrm-ui/themes/*.json` moved to `packages/pi-extensions/themes/xtrm-ui/*.json`.
- `xtrm-ui` now discovers themes from `join(__dirname, "../../themes/xtrm-ui")`.

## Follow-up updates required in later phases
1. **Installer/runtime sync paths**
   - Replace hardcoded `packages/pi-extensions/extensions/**` references with `packages/pi-extensions/extensions/**` in install/runtime copy logic.
2. **Registry generation**
   - Update `scripts/gen-registry.mjs` asset sources once package path is the canonical source-of-truth.
3. **Tests and fixtures**
   - Update tests asserting extension source paths (currently expecting `packages/pi-extensions/extensions`).
4. **Policies/docs references**
   - Update docs/policies that still mention `packages/pi-extensions/extensions` after runtime switch lands.
5. **Packaging entrypoint wiring**
   - Wire `packages/pi-extensions/src/index.ts` into Pi package install flow and extension registration.
