---
title: .xtrm Directory Reference
scope: xtrm-directory
category: reference
version: 2.0.0
updated: 2026-07-16
synced_at: xtrm-bq7yd.8
description: "Centralized xtrm configuration and runtime data directory with global skills SSOT"
source_of_truth_for:
  - ".xtrm/**"
  - "~/.xtrm/**"
  - "packages/pi-extensions/package.json"
  - "cli/src/core/pi-runtime.ts"
  - "cli/src/commands/update.ts"
  - "cli/src/commands/doctor.ts"
  - "cli/src/commands/bootstrap.ts"
domain: [config, xtrm]
updated_at: 2026-07-16
---

<!-- INDEX: auto-generated -->
| Section | Summary |
|---|---|
| [Overview](#overview) | .xtrm/ for project scope, ~/.xtrm/ for global SSOT |
| [Directory Layout](#directory-layout) | Project + global directory structures |
| [What Lives Here](#what-lives-here) | Project-scoped assets |
| [Global Scope](#global-scope) | HOME-scoped SSOT assets |
| [Extension Architecture](#extension-architecture) | Pi extensions via npm package |
| [Deprecation Notes](#deprecation-notes) | Deprecated paths |
| [Related Docs](#related-docs) | Architecture and migration docs |
---

# .xtrm Directory Reference

## Overview

`.xtrm/` is the **canonical location** for all xtrm-managed project data. After the global skills migration (Batches A–F, epic `xtrm-bq7yd`), skills use a layered model:

| Scope | Location | Contents |
|---|---|---|
| **Project** | `.xtrm/` | User packs, service-skills output, composed active view |
| **Global** | `~/.xtrm/` | Default skills SSOT, optional packs, global user packs |

Previously, xtrm assets were scattered across multiple directories:

| Old Location | New Location | Contents |
|---|---|---|
| `.claude/hooks/` | `.xtrm/hooks/` | Hook scripts |
| `.claude/settings.json` hooks | `.xtrm/hooks/` + policy compile | Hook configuration |
| `.agents/skills/` | `~/.xtrm/skills/` (global SSOT) | Skills tier architecture |
| `.pi/extensions/` managed copies/symlinks | `npm:@jaggerxtrm/pi-extensions` + `.pi/settings.json` package entry | Pi extension package |
| `.pi/skills/` | `.xtrm/skills/active/` | Runtime active view |
| Worktree sibling dirs | `.xtrm/worktrees/` | Git worktrees |

See [docs/plans/global-skills-migration.md](plans/global-skills-migration.md) for the canonical migration architecture.

## Directory Layout

### Project Scope (`.xtrm/`)

```
.xtrm/
├── skills/              # Skills tier architecture (project residual state)
│   ├── user/packs/      # User packs (writable) + service-skills output
│   ├── active/          # Composed runtime view (global + local)
│   ├── state.json       # Project delta overrides on global state
│   └── INVARIANTS.md    # Contract documentation
│
├── hooks/               # Hook scripts and compiled config
│   ├── *.mjs            # Hook scripts
│   ├── *.py             # Python hooks
│   └── hooks.json       # Compiled hook configuration
│
├── ext-src/             # [DEPRECATED] Legacy Pi extension source (pre-v0.7.8)
│   └── ...              # Empty or legacy files — do not use
│
├── worktrees/           # Git worktrees for sessions
│   └── <branch>/        # Per-branch worktree
│
├── reports/             # Session close reports
│   └── <date>-<hash>.md
│
├── cache/               # Runtime cache
│
├── config/              # Project-local config
│
├── registry.json        # Service registry
│
└── debug.db             # SQLite debug log
```

### Global Scope (`~/.xtrm/`)

```
~/.xtrm/                 # Global SSOT (HOME scope)
├── skills/
│   ├── default/         # Baseline skills (copied from xtrm package)
│   ├── optional/        # Optional packs (managed)
│   ├── user/packs/      # Global user-authored packs
│   ├── active/          # Global runtime active view
│   └── state.json       # Global enablement state
│
├── hooks/               # Global hook scripts (if applicable)
├── config/              # Global config
├── logs/                # Audit logs (skills-migration.jsonl, etc.)
├── migration-backups/   # Tarball backups from xt migrate
└── known-repos.json     # Migration state tracking
```

## What Lives Here

| Subdirectory | Purpose | Managed by |
|---|---|---|
| `skills/` | Project residual state: user packs + service-skills + composed active view | `xt init`, `xt skills`, `xt migrate` |
| `hooks/` | Hook scripts + compiled config | Policy compile, `xt init` / `xt update --apply` |
| `ext-src/` | [DEPRECATED] Legacy extension source | Do not use — migrated to `packages/pi-extensions/` |
| `worktrees/` | Session worktrees | `xt worktree`, `xt claude`, `xt pi` |
| `reports/` | Session handoff reports | `xt report generate` |
| `registry.json` | Service registry | Service-skills system |

## Global Scope

| Subdirectory | Purpose | Managed by |
|---|---|---|
| `skills/default/` | Baseline skills SSOT | `xt bootstrap` |
| `skills/optional/` | Optional packs SSOT | `xt bootstrap` |
| `skills/user/packs/` | Global user-authored packs | User |
| `skills/active/` | Global runtime active view | `xt skills enable/disable` |
| `skills/state.json` | Global enablement state | `xt skills` |
| `logs/` | Audit trail (skills-migration.jsonl) | CLI logging |
| `migration-backups/` | Tarball backups from migration | `xt migrate` |
| `known-repos.json` | Migration state tracking | `xt migrate` |

## Extension Architecture

Pi extensions are delivered via npm package installation:

1. **Source**: `packages/pi-extensions/extensions/<name>/` in the xtrm-tools monorepo
2. **Distribution**: `npm:@jaggerxtrm/pi-extensions` — published to npm registry
3. **Project wiring**: `.pi/settings.json` records `npm:@jaggerxtrm/pi-extensions` and `.xtrm/skills/active` so Pi loads the project runtime
4. **Package assurance**: `xt pi`, `xt update`, and `xt doctor` share the canonical xt-managed Pi package inventory from `cli/src/core/pi-runtime.ts`
5. **Runtime load**: Pi discovers extensions via `keywords: ["pi-package"]` + `pi.extensions: ["./src/index.ts"]`

This means:
- Extensions are versioned and published independently of the main xtrm-tools package
- `xt pi install` ensures the extension package is registered and installed for Pi runtime use
- `xt update` dry-run reports missing/outdated xt-managed Pi packages, and `xt update --apply` refreshes only those managed packages
- `xt doctor` reports package freshness in text and JSON (`piPackages`) but never mutates state
- Worktrees automatically share the package model (`.pi/npm` can be symlinked to the main repo)
- No legacy extension source mirroring or duplicate discovery issues

See [pi-extensions.md](pi-extensions.md) for the full extension reference.

## Deprecation Notes

The following paths are **deprecated** and should not be used:

- `.agents/skills/` — migrated to `~/.xtrm/skills/` (global SSOT)
- `.pi/skills/` — migrated to `.xtrm/skills/active/`
- `.xtrm/extensions/` — migrated to npm package `@jaggerxtrm/pi-extensions` in v0.7.8
- `.xtrm/ext-src/` — migrated to `packages/pi-extensions/` in v0.7.8
- `.pi/extensions/<managed-id>` — replaced by npm package install (cleanup during migration)
- `.pi/node_modules/@xtrm/pi-core` — migrated to `packages/pi-extensions/src/core/`
- Legacy symlinks in `~/.pi/agent/extensions/` for managed extensions — cleaned during package migration
- `.xtrm/skills/default/` (per-repo) — migrated to `~/.xtrm/skills/default/` (global SSOT)
- `.xtrm/skills/optional/` (per-repo) — migrated to `~/.xtrm/skills/optional/` (global SSOT)

The `xt init` command creates project skills scaffold (user/ + active/ + state.json) without per-repo default/optional after migration.

Optional packs under `~/.xtrm/skills/optional/` are populated by default during `xt bootstrap`; enable runtime activation with `xt skills enable <pack> --global`.

## Related Docs

- [plans/global-skills-migration.md](plans/global-skills-migration.md) — Canonical migration architecture and operator workflow
- [skills-tier-architecture.md](skills-tier-architecture.md) — Skills architecture
- [hooks.md](hooks.md) — Hook configuration
- [pi-extensions.md](pi-extensions.md) — Pi extensions
- [worktrees.md](worktrees.md) — Worktree sessions
- [project-skills.md](project-skills.md) — Residual per-repo state documentation
