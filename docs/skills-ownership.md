---
updated_at: 2026-08-22
---

# Skills ownership

Machine-readable source: `docs/skills-ownership.json`.

- `releasing` authored and owned by `xtrm-tools`.
- `update-specialists`, `using-kpi`, `using-nodes`, `specialists-creator`, `using-specialists`, `using-specialists-auto`, `using-script-specialists` are authored in `specialists` and vendored into `xtrm-tools` at publish time.
- Core-owned skills such as `planning` and `test-planning` are authored from this repository and must flow through the package/global/runtime materialization path; installed copies are not an independent authoring authority.
- `xtrm-tools` ships vendor/package copies into `~/.xtrm/skills/default/` (global SSOT) and publish/update tooling refreshes managed payloads; hand-editing managed installed copies is not an authoring workflow.
- Publish vendor paths and source metadata must remain reproducible; package/asset-contract verification is the release guardrail.
- Release metadata lives in `docs/skills-ownership.release.json`.

**Note:** After the global skills migration (epic `xtrm-bq7yd`), managed skills are materialized into the global SSOT at `~/.xtrm/skills/default/` rather than maintained as per-repo runtime copies. Consumer runtimes receive them through the composed active view.

## 2026-08-22 planning/test-planning vendor-drift finding

The XTRM runtime canonicalization audit found a concrete upstream/materialized-copy inversion:

```text
repo source
  skills/planning/SKILL.md          451 lines at audited HEAD
  skills/test-planning/SKILL.md     465 lines at audited HEAD

managed global/runtime copies
  ~/.xtrm/skills/default/planning/SKILL.md       670 lines
  ~/.xtrm/skills/default/test-planning/SKILL.md  542 lines
  ~/.pi/agent/skills/...                        byte-equal to global copies
```

The installed/global copies contained later planning mechanics (including draft-capture/telemetry and Specialist-chain test-planning behavior) that were not present in the repository source. That violates the ownership/materialization direction even when the installed behavior itself is desirable.

This document records the rule and the remediation boundary; it does **not** choose a copy merely because it is newer:

1. repository/package source remains the upstream authoring authority for Core-owned skills;
2. determine the provenance of the installed-only delta (unpushed work vs hand-edit vs old package payload) before copying text back;
3. reconcile useful delta deliberately into repository source with normal review/tests;
4. regenerate global/runtime managed copies through the supported package/update flow;
5. verify byte/hash parity after materialization;
6. never treat `~/.pi/agent/skills/**` or `~/.xtrm/skills/default/**` as a new source repository.

This is a documentation residual from `xtrm-cn8.6`; actual skill-content reconciliation requires the local filesystem/provenance evidence and is therefore not performed by this docs-only PR.

## What survives `xt update --apply`

Survival is decided by **location**, not by a marker file. There is no way to mark a skill as user-owned; put it in a location the update path never repairs.
Contract derived in `xtrm-kvsrd.4`, asserted by Suite A step 20b (`test/integration-suite/suite-a-installed-artifact.mjs`).

### Registry-owned — delete-on-update, never put user content here

| Location | Why |
|---|---|
| `~/.xtrm/skills/default/**` | Repaired from the package payload; pruning removes managed entries the registry manifest no longer declares. |
| `~/.xtrm/skills/optional/**` | Package-managed too; `optional/` is the shipped optional-packs tier, not a user-content tier. |
| `~/.claude/skills` | A symlink to `~/.xtrm/skills/default`, so it shares that tree's fate. |
| Runtime-view symlinks recorded as managed, resolving inside a managed root, and no longer desired | All conditions are required before managed removal. |

### Preserved — safe for user content

| Location | Why |
|---|---|
| Global user packs `~/.xtrm/skills/<pack>/` | Supported user tier; never package-repaired as `default/` or `optional/`. |
| Project packs `.xtrm/skills/<pack>/` | Project user tier; discovered, not payload-repaired. |
| A real directory at `.claude/skills/<name>` or `.pi/skills/<name>` | An untracked user directory is not part of the managed-removal set. |
| A runtime-view symlink pointing outside managed roots | Managed cleanup additionally requires the target to resolve inside a managed root. |
| The runtime directory itself when it is a symlink | Reconciliation refuses loudly rather than replacing a user-owned runtime directory. |
| A non-symlink managed entry | Reconciliation refuses loudly rather than replacing it silently. |

If a user-owned name collides with a managed skill name, reconciliation fails loudly rather than overwriting it.

### Do not put user content in `optional/`

`xtrm-kvsrd.4` once described `~/.xtrm/skills/optional/**` as a supported home for user-authored skills. That is wrong: both managed tiers are reconstructed from package payload on version changes.

Use `xt skills create-pack --global <name>` (→ `~/.xtrm/skills/<name>/`) or `xt skills create-pack --local <name>` (→ `.xtrm/skills/<name>/`) instead. Pack names are validated against `RESERVED_PACK_NAMES`, so `default`, `optional`, `user`, `active` and `local-legacy` cannot be claimed as user packs.