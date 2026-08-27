# @jaggerxtrm/pi-extensions

Unified runtime package for xtrm-managed Pi extensions.

## Publish contract

- Package is published as `@jaggerxtrm/pi-extensions` (public npm package).
- No build step is required. Pi loads raw TypeScript extension entrypoints at runtime.
- `prepublishOnly` runs `verify:runtime` to ensure required runtime assets exist:
  - `src/index.ts`
  - `src/registry.ts`
  - `extensions/`
  - `themes/`
- Files shipped to npm are controlled by `files` in `package.json`.

## Release workflow

From repository root:

```bash
npm run release:pi-extensions
```

To publish both root `xtrm-tools` and this package in one pass:

```bash
npm run release:all
```

## Install contract

Managed project runtime install path:

```bash
pi install npm:@jaggerxtrm/pi-extensions
```

Pi discovers this package through:

- `keywords: ["pi-package"]`
- `pi.extensions: ["./src/index.ts"]`

After install, keep `.pi/settings.json` package wiring pointed at `npm:@jaggerxtrm/pi-extensions`.

## Managed extensions

Notable bundled extensions include:

- `python-kernel` — persistent sequential `python` tool (state survives across
  calls; reset/cwd/abort/shutdown semantics). Requires `python3` on PATH.
  v2 adds: python-backed skills as importable kernel modules (skillbridge),
  stdlib prelude, output truncation with shape hint + temp-file fallback, and
  a kernel-side mutation audit seam. See
  [extensions/python-kernel/README.md](extensions/python-kernel/README.md).
- `service-knowledge` — self-gating service-registry status + drift notice.
  Registers a context note and `/service-knowledge:status` ONLY in repos with
  a canonical registry (`.xtrm/skills/<pack>/service-knowledge/`); zero
  surface otherwise. Replaces the retired `service-skills` extension. See
  [extensions/service-knowledge/README.md](extensions/service-knowledge/README.md).
- `xtrm-ui` — XTRM Pi chrome, native tool summaries, selectable external tool chrome (`/xtrm-ui chrome background|box`).
- `sp-terminal-overlay` — `/sp-feed` streaming overlay, `/sp-ps` snapshot overlay, and `/xtrm-terminal` shell overlay for specialist monitoring.

Retired extension sources can remain in the package for migration compatibility. Entries in `src/manifest.json.disabled` are not enrolled or managed by XTRM.
