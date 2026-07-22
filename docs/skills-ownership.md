---
updated_at: 2026-07-22
---

# Skills ownership

Machine-readable source: `docs/skills-ownership.json`.

- `releasing` authored and owned by `xtrm-tools`.
- `update-specialists`, `using-kpi`, `using-nodes`, `specialists-creator`, `using-specialists`, `using-specialists`, `using-specialists`, `using-specialists-auto`, `using-script-specialists` authored in `specialists` and vendored into `xtrm-tools` at publish time.
- `xtrm-tools` ships vendor copy in `~/.xtrm/skills/default/` (global SSOT) and `npm publish` refreshes payload via `scripts/vendor-specialists-skills.mjs` before `gen-registry`. The script also writes `source.ref` and `source.resolved_sha` to `~/.xtrm/skills/specialists-source.json` (no hand-edits).
- Publish vendor path defaults to `../specialists`; override with `SPECIALISTS_REPO_PATH` when CI layout differs.
- Release metadata lives in `docs/skills-ownership.release.json`.
- `publish.yml` verifies the mirror against specialists' `dist/asset-contract.json` (sha256) via `scripts/verify-asset-contract.mjs` before `npm publish`. Drift between vendored and shipped fails the gate. See [`release.md`](release.md).

**Note:** After the global skills migration (epic `xtrm-bq7yd`), specialist-owned skills are vendored into the global SSOT at `~/.xtrm/skills/default/` rather than per-repo `.xtrm/skills/default/`. Consumer repos receive them via the composed active view.

## What survives `xt update --apply`

Survival is decided by **location**, not by a marker file. There is no way to
mark a skill as user-owned; put it in a location the update path never repairs.
Contract derived in `xtrm-kvsrd.4`, asserted by Suite A step 20b
(`test/integration-suite/suite-a-installed-artifact.mjs`).

### Registry-owned — delete-on-update, never put user content here

| Location | Why |
|---|---|
| `~/.xtrm/skills/default/**` | Repaired from the package payload by `scaffoldSkillsDefaultFromPackage()`; `pruneRetiredManagedSkills()` then removes every entry the registry manifest does not declare. |
| `~/.xtrm/skills/optional/**` | Package-managed too. `global-skills-bootstrap.ts` `copyTier()` runs `fs.remove(targetRoot)` and re-copies from the payload, for **both** tiers. `optional/` is the *shipped optional packs* tier, not a user-content tier. |
| `~/.claude/skills` | A symlink to `~/.xtrm/skills/default`, so it shares that tree's fate exactly. |
| Runtime-view symlinks that are simultaneously recorded in `state.managedLinks[runtime]`, resolve **inside** a managed root, and are no longer desired. All three conditions are required. |

### Preserved — safe for user content

| Location | Why |
|---|---|
| Global user packs `~/.xtrm/skills/<pack>/` | What `xt skills create-pack --global` writes (`createUserPack` → `resolveRepoPackRoot`). Discovered as the `user` tier, never payload-repaired. **This is the supported home for a user-authored skill that must survive update.** |
| Project packs `.xtrm/skills/<pack>/` | Same mechanism at project scope. Discovered, never payload-repaired. |
| A real directory at `.claude/skills/<name>` or `.pi/skills/<name>` | The removal loop only iterates managed entries, so an untracked one is never considered. |
| A runtime-view symlink pointing **outside** the managed roots | Removal additionally requires the resolved target to be inside a managed root. |
| The runtime directory itself when it is a symlink | Refused loudly: `Refusing to replace user-owned runtime directory`. |
| A non-symlink managed entry | Refused loudly: `Cannot replace non-symlink managed entry <path>`. |

If a user-owned name collides with a managed skill name, reconcile **fails
loudly** rather than overwriting: `Cannot enable skill '<name>': <path> is user-owned`.

### Do not put user content in `optional/`

`xtrm-kvsrd.4` described `~/.xtrm/skills/optional/**` as the supported home for
user-authored skills. That is wrong, and Suite A demonstrates it: the derivation
inspected `pruneRetiredManagedSkills()` (which does target `default/` alone) but
not `copyTier()`, which removes and re-copies **both** tiers from the package
payload on every version bump. Anything you leave in `optional/` is gone at the
next upgrade.

Use `xt skills create-pack --global <name>` (→ `~/.xtrm/skills/<name>/`) or
`xt skills create-pack --local <name>` (→ `.xtrm/skills/<name>/`) instead. Pack
names are validated against `RESERVED_PACK_NAMES`, so `default`, `optional`,
`user`, `active` and `local-legacy` cannot be claimed as user packs.
