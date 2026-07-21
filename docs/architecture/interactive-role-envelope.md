# Interactive-role envelope (`xtrm.interactive-role-envelope.v1`)

Audit reference: `~/dev/11.md` §P1-01.

Core's integration with Specialists for **interactive role launch** is
deliberately slim. This document declares the fields Core is
allowed to consume and the fields it must not — establishing a
narrow, versioned boundary that prevents drift between the two
repos over time.

The TypeScript interface is exported from
`cli/src/types/interactive-role-envelope.ts` and any Core code
that consumes a role from Specialists SHOULD type-check against it.

## The envelope

```ts
interface InteractiveRoleEnvelope {
  role: string;              // canonical role name (e.g. "chain-coordinator")
  systemPrompt: string;      // effective merged system prompt for the interactive persona
  skillPaths: string[];      // absolute paths of skills the interactive session must load
  model?: string;            // surface-specific model override, if any
  thinkingLevel?: string;    // thinking level where the surface supports it
  interactive?: boolean;     // role runs as a persistent interactive session
}
```

`interactive` was added additively in **xtrm-6hey0.3** (audit P1-05) — no version
bump, per the versioning rule below. Core consumes it for exactly one decision:
refusing a `--subordinate` coordinator launch of a role that declares `false`.
It is tri-state on purpose — `undefined` means the installed Specialists release
does not declare it, and must stay permissive so older releases keep working.

It is not a job-supervision field: it describes the *shape* of the role, not how
Specialists governs its execution.

## Core owns

- worktree creation
- branch creation
- runtime selection (claude / pi)
- interactive role composition from the envelope
- tmux placement (`@agent_*` pane metadata)
- parent identity (`XTMUX_AGENT_*` env vars)
- bead metadata
- session launch

## Specialists owns

- background job execution
- retry policy
- stall detection
- job permissions
- specialist capabilities
- job result persistence
- job lineage

## Rules

Core **must not** consume, enforce, or persist any of the following
fields even if they appear in a Specialist role definition:

- `retries`
- `stall_timeout`
- `overall_job_timeout`
- `permission_tier`
- `external_command_capabilities`
- `background_execution_policy`
- `supervisor_restart_policy`

Those fields describe **Specialists-supervised jobs** — background
work that Specialists itself governs. If Core were to consume them,
Core would become a second, competing job supervisor. That is
explicitly forbidden.

If a new interactive requirement appears (say, a role wanting to
inject an initial bead), extend the envelope with the smallest
additive field — do **not** grow it into a full launch-plan
abstraction. Prefer adding one optional field to introducing a new
schema version.

## Versioning

- Current version: `xtrm.interactive-role-envelope.v1`.
- Additive fields (new optional properties) do NOT require a
  version bump — they are backwards-compatible.
- Removing or renaming a field, or changing the semantics of an
  existing field, requires bumping to `v2` AND updating
  `docs/runtime-compatibility.json` in the same PR.

## Cross-references

- Compatibility window: `docs/runtime-compatibility.json` (`contracts.interactive_role_envelope`).
- Runtime matrix: `docs/runtime-matrix.yml`.
- Envelope type: `cli/src/types/interactive-role-envelope.ts`.
