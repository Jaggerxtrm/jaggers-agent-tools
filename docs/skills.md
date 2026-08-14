---
title: Skills Catalog
scope: skills
category: overview
version: 3.0.0
updated: 2026-07-16
synced_at: xtrm-bq7yd.8
description: "Skills global + project layered model: global SSOT at ~/.xtrm/skills/, residual per-repo state, and xt skills CLI"
source_of_truth_for:
  - "~/.xtrm/skills/**"
  - ".xtrm/skills/**"
  - "skills/**/SKILL.md"
domain: [skills, claude, pi]
updated_at: 2026-07-16
---

<!-- INDEX: auto-generated -->
| Section | Summary |
|---|---|
| [Overview](#overview) | Global SSOT + project layered model |
| [Tier Architecture](#tier-architecture) | Global default/optional/user + project residual state |
| [Runtime Active View](#runtime-active-view) | Flat symlink directory composed from global + local |
| [Agent Runtime Pointers](#agent-runtime-pointers) | Claude Code and Pi pointer wiring |
| [xt skills CLI](#xt-skills-cli) | `xt skills list/enable/disable/create-pack` with global default scope |
| [Default Skills Catalog](#default-skills-catalog) | ~30 baseline skills for core workflows |
| [Migration](#migration) | Per-repo to global migration workflow |
| [Related Docs](#related-docs) | Architecture deep-dives and CLI reference |
---

# Skills Module

Skills use a **global + project layered model**. Global source of truth lives at `~/.xtrm/skills/`; project scope retains only user-authored packs, service-skills output, and the composed active view. This eliminates N-copy drift across a fleet of N repos and centralizes skill updates.

See [docs/plans/global-skills-migration.md](plans/global-skills-migration.md) for the canonical migration architecture and operator workflow.

## Tier Architecture

### Global Scope (HOME)

| Tier | Location | Mutability | Purpose |
|---|---|---|---|
| **default** | `~/.xtrm/skills/default/` | Read-only (managed) | Baseline skills bundled with xtrm |
| **optional** | `~/.xtrm/skills/optional/` | Managed packs | Add-on packs (activate with `xt skills enable <pack> --global`) |
| **user** | `~/.xtrm/skills/user/packs/` | User-writable | Global user-authored packs |

### Project Scope (Residual)

| Tier | Location | Mutability | Purpose |
|---|---|---|---|
| **user** | `.xtrm/skills/user/packs/` | User-writable | Project-specific user packs |
| **service-skills** | `.xtrm/skills/user/packs/<repo>-services/` | Generated | Service skill packages from service-skills system |
| **active** | `.xtrm/skills/active/` | Composed | Flat symlink view: global + local user + service-skills |
| **state.json** | `.xtrm/skills/state.json` | Delta overrides | Project-specific enablement deltas on global state |

The `default/` and `optional/` tiers are **no longer materialized per-repo** after migration. They exist only at global scope.

### Optional Pack Catalog

Current optional packs: `research-methods`, `code-quality`, `security-ops`, `data-engineering`, `architecture-design`. Populated at global scope on `xt bootstrap` or first `xt init`.

## Runtime Active View

```
~/.xtrm/skills/active/           # Global active view (symlinks to default + enabled optional + global user)
.xtrm/skills/active/             # Project active view (symlinks to global active + local user + service-skills)
```

Active views are flat symlink directories. Project active view composition order (project wins on conflict):

1. Global default skills
2. Global enabled optional packs
3. Global user packs
4. Project user packs
5. Service-skills output

Views rebuilt on `xt skills enable/disable` via `rebuildGlobalActiveView()` and `rebuildProjectActiveView()`.

## Agent Runtime Pointers

### Claude Code

```bash
~/.claude/skills → ~/.xtrm/skills/active   # Absolute symlink (global)
```

Created by `xt bootstrap`, self-healed by `xt init`/`xt update --apply`. Refuses to replace non-symlink existing dir without `XTRM_FORCE_SKILLS_MIGRATION=1`.

### Pi

`.pi/settings.json` `.skills` array:

```json
{
  "skills": [
    "~/.xtrm/skills/active"
  ]
}
```

Or composed (project has user packs):

```json
{
  "skills": [
    "../.xtrm/skills/active",
    "~/.xtrm/skills/active"
  ]
}
```

First entry wins on conflict. User-added entries between canonical entries preserved on `xt update`.

## state.json

### Global State (`~/.xtrm/skills/state.json`)

```json
{
  "schemaVersion": "1",
  "enabledPacks": {
    "claude": ["code-quality", "security-ops"],
    "pi": ["code-quality"]
  },
  "installedVersion": "0.7.21",
  "installedFrom": "/home/dawid/.nvm/versions/node/v24.15.0/lib/node_modules/xtrm-tools",
  "installedAt": "2026-07-08T12:00:00.000Z"
}
```

### Project State (`.xtrm/skills/state.json`)

Project state is interpreted as **delta overrides** on global state:

```json
{
  "schemaVersion": "1",
  "enabledPacks": {
    "claude": ["my-project-pack"]
  }
}
```

Effective runtime state = union(global.enabledPacks[runtime], local.enabledPacks[runtime]).

See [docs/plans/global-skills-migration.md](plans/global-skills-migration.md) for composition rules.

## xt skills CLI

```bash
xt skills list [--global|--local] [--claude|--pi] [--json]
xt skills enable <pack> [--global|--local] [--claude|--pi]
xt skills disable <pack> [--global|--local] [--claude|--pi]
xt skills create-pack <name> [--global|--local]
```

| Command | Default Scope | Purpose |
|---|---|---|
| `list` | `--global` | Show global inventory (default) or composed local view |
| `enable` | `--global` | Enable pack globally (default) or locally |
| `disable` | `--global` | Disable pack globally (default) or locally |
| `create-pack` | `--local` | Create project-scoped user pack scaffold |

### Scope Flags

- `--global`: Target `~/.xtrm/skills` (default for list/enable/disable)
- `--local`: Target `./.xtrm/skills` (default for create-pack)

### Runtime Flags

- `--claude`: Target Claude runtime
- `--pi`: Target Pi runtime
- Omitting both targets all runtimes

### Output Labels

`xt skills list --local` shows source labels:

```
default/
  using-xtrm [global]
  planning [global]
optional/
  code-quality [global]
user/packs/
  my-project-pack [local]
```

### State Mutation Logging

All enable/disable operations log to `~/.xtrm/logs/skills-state.jsonl`:

```jsonl
{"timestamp":"2026-07-08T12:00:00.000Z","component":"skills-state","event":"skills-state.mutation","scope":"global","action":"enable","pack":"code-quality","runtime":"claude","before":[],"after":["code-quality"]}
```

See [skills-tier-architecture.md](skills-tier-architecture.md) for full CLI reference.

## Default Skills Catalog

### Workflow Skills

| Skill | Primary Use |
|---|---|
| `using-xtrm` | Session operating manual |
| `xt-end` | Close worktree session: commit, push, PR, cleanup |
| `xt-merge` | Drain PR queue: FIFO merge with rebase cascade |
| `xt-debugging` | Debugging workflow with GitNexus call-chain tracing |
| `init-session` | Initialize worktree session with hooks and beads |
| `planning` | Create bd issue board from spec/feature/idea |
| `test-planning` | Attach test coverage to implementation issues |
| `session-close-report` | Generate structured session handoff reports |
| `sync-docs` | Single-document synchronization + drift workflow |
| `delegating` | Delegation routing and model strategy |
| `using-specialists` | Specialist routing and execution workflow (`specialists run/feed/result`) |
| `using-specialists` | Legacy specialist orchestration (v2 contract) |
| `using-specialists` | Specialist orchestration with 7-section bead contract |
| `using-specialists-auto` | Automatic specialist selection and dispatch |
| `using-script-specialists` | Script-based specialist invocation |
| `update-specialists` | Sync vendored specialists-owned skills |
| `update-xt` | Refresh xtrm-managed assets across repos |
| `releasing` | End-to-end release workflow without `xt release` |
| `sync-docs` | Doc audit and structural sync |

### GitNexus Skills

| Skill | Primary Use |
|---|---|
| `gitnexus-cli` | Command-line GitNexus operations |
| `gitnexus-debugging` | Debugging workflow with call-chain tracing |
| `gitnexus-exploring` | Explore code structure and execution flows |
| `gitnexus-guide` | GitNexus usage guide and patterns |
| `gitnexus-impact-analysis` | Blast radius before editing code |
| `gitnexus-pr-review` | Pull request review and risk assessment |
| `gitnexus-refactoring` | Safe rename/extract/split operations |

### Specialist Skills

Owned by the [specialists repo](https://github.com/Jaggerxtrm/specialists) and vendored into xtrm-tools:

| Skill | Primary Use |
|---|---|
| `using-specialists` | Specialist routing and execution workflow |
| `using-specialists` | Legacy specialist orchestration (v2 contract) |
| `using-specialists` | Specialist orchestration with 7-section bead contract |
| `using-specialists-auto` | Automatic specialist selection and dispatch |
| `using-script-specialists` | Script-based specialist invocation |
| `update-specialists` | Sync vendored specialists-owned skills |
| `using-kpi` | KPI tracking and metrics workflows |
| `using-nodes` | Distributed node workflows |
| `specialists-creator` | Create and validate `.specialist.yaml` definitions |

### Quality Skills

| Skill | Primary Use |
|---|---|
| `using-tdd` | Test-driven development workflow |
| `using-quality-gates` | Auto-lint/typecheck on file edits |
| `quality-gates` | Quality gate definitions and enforcement |
| `security-pipeline` | Security scanning baseline (gitleaks, semgrep, osv-scanner) |

### Development Skills

| Skill | Primary Use |
|---|---|
| `clean-code` | Pragmatic coding standards |
| `skill-creator` | Create and improve skills |
| `specialists-creator` | Create and validate `.specialist.yaml` definitions |
| `hook-development` | Claude Code plugin hooks |

### Service Skills

| Skill | Primary Use |
|---|---|
| `service-skills` | Consolidated router for per-service expert personas: discovery + activation, creation, drift-sync, and task routing |

> **v2 (epic `xtrm-b86y5`):** the former quartet (`creating`/`updating`/`scoping`/`using-service-skills`) plus the `service-skills-set` bundle are now **one** skill at `skills/service-skills/` — router `SKILL.md` + `references/{creating,updating,using,routing,system-guide}.md`, co-located `scripts/` (drift_detector, cataloger, skill_activator, umbrella_generator, layout_migrator, …), and `install/`. Per-repo service skills live at `.xtrm/skills/user/packs/<pack>/service-skills/services/<svc>/` under a generated `<repo>-services` umbrella.
>
> Service skills are the **per-service knowledge substrate** consumed by the future devops/AgentOps work (epics `unitAI-eoqxp` / `unitAI-60w93`): health-check + failure-mode tables feed the RCA loop, and the drift machinery is slated to emit telemetry per the forensic contract (bead `unitAI-60w93.1`).

### Utility Skills

| Skill | Primary Use |
|---|---|
| `deepwiki` | Query repository/library docs via DeepWiki |
| `find-docs` | Discover documentation across sources |
| `find-skills` | Discover and install agent skills |
| `github-search` | GitHub code and issue search |
| `last30days` | Recent activity summarization |
| `premortem` | Risk identification before implementation |
| `prompt-improving` | Prompt optimization via Claude XML patterns |
| `vaultctl` | Obsidian vault control and automation |

## Migration

Migrate existing per-repo `default/` and `optional/` to global SSOT:

```bash
# Bootstrap global tree (one-time per HOME)
xt bootstrap

# Per-repo migration
cd <repo>
xt migrate skills --dry-run   # Preview
xt migrate skills --apply     # Execute
```

Migration performs SHA-256 verification, tarball backup at `~/.xtrm/migration-backups/`, deletion of identical per-repo assets, preservation of diverged files as overrides, and cleanup of xtrm-owned settings.json entries.

### Runtime-root adoption

`xt migrate skills-layout --repo . --apply --yes` converts legacy runtime-root symlinks (`.claude/skills`, `.pi/skills` → `.xtrm/skills/default`) to real directories: registry-managed names are omitted, foreign entries are preserved byte-for-byte, and the source target `.xtrm/skills/default` is never mutated. Snapshots are written to `~/.xtrm/migration-backups/adopt-runtime-*.tgz` and are not restorable via `--restore`. To undo an adoption, move/remove the adopted runtime dir and recreate the original symlink; `.migrate-old-*` is recovery after an interrupted swap.

Full workflow: [docs/plans/global-skills-migration.md](plans/global-skills-migration.md)

## Operational Commands

```bash
xt bootstrap         # Bootstrap global skills tree (one-time per HOME)
xt init              # Initialize project skills (user/ + active/ + state.json)
xt skills list       # Show current skill inventory (default: --global)
xt migrate skills    # Migrate per-repo skills to global SSOT
xt status            # Check plugin/runtime health
```

## Related Docs

- [plans/global-skills-migration.md](plans/global-skills-migration.md) — Canonical migration architecture and operator workflow
- [skills-tier-architecture.md](skills-tier-architecture.md) — Full tier architecture reference
- [skills-registry-exploration.md](skills-registry-exploration.md) — Historical design spec (superseded, kept for context)
- [cli-architecture.md](cli-architecture.md) — CLI module reference
- [project-skills.md](project-skills.md) — Residual per-repo state documentation
- [XTRM-GUIDE.md](../XTRM-GUIDE.md) — User guide
