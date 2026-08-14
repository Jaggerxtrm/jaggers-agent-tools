---
title: Global Skills Migration Plan
scope: global-skills-migration
category: migration
version: 1.0.0
updated: 2026-07-08
description: "Architecture and operator workflow for migrating from per-repo default/optional skills to global SSOT at ~/.xtrm/skills/"
source_of_truth_for:
  - "cli/src/core/global-skills-bootstrap.ts"
  - "cli/src/core/skills-materializer.ts"
  - "cli/src/commands/migrate.ts"
  - "cli/src/commands/bootstrap.ts"
domain: [skills, migration, cli]
status: shipped
---

# Global Skills Migration Plan

**Status:** Shipped (Batches A–F complete)

**Owner:** xtrm-tools core team

**Epic:** xtrm-bq7yd (Batch H — documentation sweep)

---

## Executive Summary

Skills have migrated from per-repo materialization (`.xtrm/skills/default/`, `.xtrm/skills/optional/`) to a global source of truth at `~/.xtrm/skills/`. Consumer repos now contain only user-authored packs (`.xtrm/skills/user/packs/`), service-skills output, and the composed active view. This reduces disk usage, eliminates N-copy drift across a fleet of N repos, and centralizes skill updates.

Migration is opt-in via `XTRM_GLOBAL_SKILLS=1` feature flag (v-next-1 preview, v-next-2 default, v-next-3 enforced). The `xt migrate skills` command performs SHA-256 verification, tarball backup, and idempotent cleanup of redundant per-repo assets.

---

## Architecture

### Global + Project Layered Model

```
~/.xtrm/skills/                    # Global SSOT (HOME scope)
├── default/                       # Baseline skills from xtrm package
├── optional/                      # Optional packs (research-methods, code-quality, etc.)
├── user/packs/                    # Global user-authored packs
├── active/                        # Composed runtime view (symlinks)
└── state.json                     # Global enablement state

<repo>/.xtrm/skills/               # Project scope (residual)
├── user/packs/                    # Project-specific user packs
├── active/                        # Composed: global + local user + service-skills
├── state.json                     # Local overrides (delta on global)
└── INVARIANTS.md
```

### Runtime Resolution Order

1. **Global default** — baseline skills always present
2. **Global enabled optional packs** — per `~/.xtrm/skills/state.json`
3. **Global user packs** — user-authored overlays at HOME scope
4. **Project user packs** — project-specific overrides
5. **Service-skills output** — generated per-repo service skill packages

Active view composition: `selectRuntimeSkills()` merges global + project roots, with project scope winning on path conflict.

### Agent Runtime Pointers

- **Claude Code**: `~/.claude/skills → ~/.xtrm/skills/active` (absolute symlink)
- **Pi**: `.pi/settings.json.skills` array contains `["~/.xtrm/skills/active"]` (global) or `["../.xtrm/skills/active", "~/.xtrm/skills/active"]` (composed)

Both pointers are created by `xt bootstrap` and self-healed by `xt install`, `xt init`, `xt update --apply`.

---

## Migration Workflow

### Prerequisites

- xtrm-tools >= v0.7.21 (Batches A–F shipped)
- `XTRM_GLOBAL_SKILLS=1` environment flag set
- Global tree bootstrapped: `xt bootstrap` or first `xt install`/`xt init`

### Step 1: Bootstrap Global Tree

```bash
# One-time per HOME
xt bootstrap
```

Populates `~/.xtrm/skills/{default,optional,active}/` from the installed xtrm package. Idempotent — second run reports "already up to date".

### Step 2: Verify Runtime Pointers

```bash
# Claude Code pointer
readlink ~/.claude/skills
# → ~/.xtrm/skills/active

# Pi pointer
cat ~/.pi/agent/settings.json | jq .skills
# → ["~/.xtrm/skills/active"]
```

Both should resolve to global active view.

### Step 3: Run Migration (Per Repo)

```bash
cd <repo>

# Dry-run first (default)
xt migrate skills --repo .

# Review planned actions, then apply
xt migrate skills --repo . --apply
```

Migration performs:

1. **SHA-256 verification** — compares per-repo `default/` and `optional/` against `~/.xtrm/skills/` equivalents
2. **Tarball backup** — creates `~/.xtrm/migration-backups/<repo>-<timestamp>-skills.tgz` before any deletion
3. **Delete identical** — removes per-repo assets that match global SSOT
4. **Preserve diverged** — moves diverged files to `.xtrm/skills/user/packs/local-legacy/<skill>/` as override
5. **Clean settings.json** — removes xtrm-owned entries from `.claude/settings.json` and `.pi/agent/settings.json` (tagged `_source: "xtrm-global"` or hash-matched)
6. **Log audit trail** — writes to `~/.xtrm/logs/skills-migration.jsonl` with events `migrate.skills.{start,verify,backup,delete,preserve,ok}`

### Step 4: Verify Migration

```bash
# Per-repo default/ should be absent (or empty)
ls -la .xtrm/skills/default/
# → No such file or directory (or empty)

# Active view should resolve via global
ls -l .xtrm/skills/active/
# → Symlinks pointing to ~/.xtrm/skills/default/...

# Agent pointers intact
ls -l ~/.claude/skills
# → ~/.xtrm/skills/active
```

### Step 5: Fleet Sweep (Optional)

```bash
# Sweep all repos under a root
xt migrate skills --root ~/dev --apply

# Or all known repos
xt migrate skills --all-repos --apply
```

---

## Rollback

Migration is reversible via backup tarballs:

```bash
# List backups
ls -la ~/.xtrm/migration-backups/

# Restore (manual for now)
tar -xzf ~/.xtrm/migration-backups/<repo>-<timestamp>-skills.tgz -C <repo>/.xtrm/skills/
```

Restore command (`xt migrate --restore <backup>`) deferred to follow-up bead.

### Runtime-root adoption rollback

`xt migrate skills-layout` adoption never mutates the source target (`.xtrm/skills/default`). To undo, move/remove the adopted runtime dir and recreate the original symlink; `.migrate-old-*` next to a runtime dir is recovery after an interrupted swap. Adoption snapshots (`adopt-runtime-*`) are not restorable via `--restore`.

---

## Audit Trail

All migration events logged to `~/.xtrm/logs/skills-migration.jsonl`:

```jsonl
{"timestamp":"2026-07-08T12:00:00.000Z","component":"skills-migration","event":"migrate.skills.start","repo":"/home/dawid/dev/my-repo","scope":"skills"}
{"timestamp":"2026-07-08T12:00:01.234Z","component":"skills-migration","event":"migrate.skills.verify","file":".xtrm/skills/default/using-xtrm","globalHash":"abc123...","localHash":"abc123...","identical":true}
{"timestamp":"2026-07-08T12:00:02.456Z","component":"skills-migration","event":"migrate.skills.backup","path":"~/.xtrm/migration-backups/my-repo-20260708120002-skills.tgz","files":55}
{"timestamp":"2026-07-08T12:00:03.789Z","component":"skills-migration","event":"migrate.skills.delete","file":".xtrm/skills/default/using-xtrm","reason":"identical-to-global"}
{"timestamp":"2026-07-08T12:00:04.012Z","component":"skills-migration","event":"migrate.skills.ok","deleted":55,"preserved":0,"durationMs":4012}
```

Query with:

```bash
jq 'select(.component == "skills-migration")' ~/.xtrm/logs/skills-migration.jsonl
```

---

## Feature Flag Lifecycle

| Version | Default | Behavior |
|---------|---------|----------|
| v-next-1 (preview) | OFF | Per-repo scaffold unchanged; `XTRM_GLOBAL_SKILLS=1` opts in |
| v-next-2 (default) | ON | Global bootstrap runs; per-repo scaffold skipped with migration nudge |
| v-next-3 (enforced) | ON (locked) | Per-repo scaffold code removed; global-only model |

---

## Known Issues

- **HOME/project collision in tests**: Test fixtures that set `process.env.HOME = tmpDir` AND use `tmpDir` as project root will collide under `XTRM_GLOBAL_SKILLS=1`. Fix: use separate subdir for HOME.
- **Env pollution in install-integration.test.ts**: Pre-existing `~/.claude/skills` causes "Refusing to replace existing" errors. Classified pre_existing; test cleanup deferred.
- **Restore command**: Not yet implemented; manual tarball extraction required.

---

## Related Docs

- `docs/skills.md` — Skills tier architecture reference
- `docs/skills-tier-architecture.md` — Detailed tier model
- `docs/project-skills.md` — Residual per-repo state documentation
- `docs/cli-architecture.md` — CLI command internals
- `CHANGELOG.md` — Migration entry in [Unreleased] block

---

## Beads

- Epic: xtrm-bq7yd
- Batch A: xtrm-bq7yd.1 (Global scaffold primitives)
- Batch B: xtrm-bq7yd.2 (xt bootstrap command)
- Batch C: xtrm-bq7yd.3 (Retire per-repo scaffold)
- Batch D: xtrm-bq7yd.4 (Runtime pointers global)
- Batch E: xtrm-bq7yd.5 (Migration skill)
- Batch F: xtrm-bq7yd.6 (xt skills scope flip)
- Batch H: xtrm-bq7yd.8 (Docs sweep — this doc)
