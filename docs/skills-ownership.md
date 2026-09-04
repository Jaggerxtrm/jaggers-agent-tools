---
updated_at: 2026-09-04
---

# Skills ownership and placement

Machine-readable source: `docs/skills-ownership.json`.
Release mirror metadata: `docs/skills-ownership.release.json`.

## Authority

Core-owned skills are authored in `xtrm-dev/core` and shipped through the package/global materialization path. Installed copies under `~/.xtrm/skills/**`, `.claude/skills`, or runtime views are generated/managed state, not an independent authoring source.

Specialists-owned skills are authored in `xtrm-dev/specialists/config/skills` and vendored into Core from an immutable `source.resolved_sha`. The vendor operation reads bytes from that exact Git commit; it must not copy the current checkout working tree and then merely label the result with a pin.

`releasing` remains Core-owned.

## Specialists-owned runtime payload

Only `using-specialists` is universal enough to live in the default skill tier.

| Skill | Placement | Reason |
|---|---|---|
| `using-specialists` | `default` | Core XTRM execution-backend doctrine needed by ordinary agents. |
| `specialists-creator` | `optional/specialists-advanced` | Specialist authoring/maintainer capability. |
| `using-kpi` | `optional/specialists-advanced` | Specialist runtime observability/tuning. |
| `using-nodes` | `optional/specialists-advanced` | Advanced NodeSupervisor execution surface. |
| `using-script-specialists` | `optional/specialists-advanced` | Advanced script/serve execution surface. |
| `update-specialists` | `optional/xtrm-maintenance` | Distribution/runtime maintenance workflow. |

`using-specialists-auto` is retired from the XTRM distributed skill surface. Older prompts that mention it should route through `using-specialists`, `multiplexing`, and `starting-and-resuming-work`; it must not be restored by the vendor step.

The placement contract is declared per skill in `docs/skills-ownership.json`. `scripts/vendor-specialists-skills.mjs` materializes that placement and writes `.xtrm/specialists-source.json` v2 containing the source SHA, per-skill placement, SHA-256 file hashes, and upstream Git blob identities.

Evaluation fixtures and iterative workspaces remain in the Specialists source repository. Core vendors runtime skill content only (`SKILL.md`, references, scripts/assets required at runtime).

## Managed skill tiers

```text
~/.xtrm/skills/
├── default/       package-managed universal skills
├── optional/      package-managed opt-in packs
├── <user-pack>/   user-managed global packs
└── active/        composed runtime view
```

Project user packs live under `.xtrm/skills/<pack>/`. Package-managed `default/` and `optional/` are reconstructed from the package registry; do not put user-authored content there.

Enable shipped optional packs through the current `xt skills` surface. Examples:

```bash
xt skills enable sre-ops --global
xt skills enable specialists-advanced --global
xt skills enable xtrm-maintenance --local
```

Use live `xt skills --help` for exact syntax when the installed version differs.

## Update/materialization safety

Registry-owned paths may be repaired or pruned on update:

- `~/.xtrm/skills/default/**`
- `~/.xtrm/skills/optional/**`
- managed runtime-view symlinks resolving into those roots

User-owned global/project packs are preserved. A user-owned collision with a managed skill name must fail loudly rather than being overwritten.

Do not hand-edit a managed installed copy as a durable repair. Change the owning repository, regenerate/vendor the package payload, regenerate `.xtrm/registry.json`, and verify materialized parity.

## Release invariants

A Core release is not skill-clean unless all of these hold:

1. every Specialists-owned distributed skill appears exactly once at its declared placement;
2. `using-specialists-auto` is absent from the distributed payload;
3. vendored bytes hash-match the pinned Specialists commit;
4. the v2 vendor manifest records the same placements as the ownership and release manifests;
5. optional `PACK.json` files declare every placed optional skill;
6. generated registry and npm package payload agree;
7. no nested runtime roots (`.claude`, `.agents`, `.pi`) exist inside a skill root;
8. default skill roots remain the small universal XTRM operating surface.

The relevant release guards are `check:skills-ownership`, `check:specialists-vendor`, `check:vendored-specialists-parity`, `check:registry-pack-parity`, layout guards, skill schema/root-budget checks, and package/build tests.
