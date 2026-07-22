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
| `~/.claude/skills` | A symlink to `~/.xtrm/skills/default`, so it shares that tree's fate exactly. |
| `~/.xtrm/skills/optional/**` | ⚠️ See the caveat below — currently registry-owned in practice, despite being documented as a user-content tier. |
| Runtime-view symlinks that are simultaneously recorded in `state.managedLinks[runtime]`, resolve **inside** a managed root, and are no longer desired. All three conditions are required. |

### Preserved — safe for user content

| Location | Why |
|---|---|
| Project packs `.xtrm/skills/<pack>/` | Discovered, never payload-repaired. |
| A real directory at `.claude/skills/<name>` or `.pi/skills/<name>` | The removal loop only iterates managed entries, so an untracked one is never considered. |
| A runtime-view symlink pointing **outside** the managed roots | Removal additionally requires the resolved target to be inside a managed root. |
| The runtime directory itself when it is a symlink | Refused loudly: `Refusing to replace user-owned runtime directory`. |
| A non-symlink managed entry | Refused loudly: `Cannot replace non-symlink managed entry <path>`. |

If a user-owned name collides with a managed skill name, reconcile **fails
loudly** rather than overwriting: `Cannot enable skill '<name>': <path> is user-owned`.

### Caveat: `~/.xtrm/skills/optional/` is not currently safe

`global-skills-bootstrap.ts` `copyTier()` runs `fs.remove(targetRoot)` before
copying, for **both** `default/` and `optional/`. Any xtrm-tools version bump
therefore wipes user content under `~/.xtrm/skills/optional/` wholesale, even
though `pruneRetiredManagedSkills()` targets `default/` alone. Until that is
resolved, keep user-authored skills in a **project pack** (`.xtrm/skills/<pack>/`)
or a real directory in the runtime view. Tracked as `xtrm-vtqlg.8`.
