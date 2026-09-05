---
name: using-xtrm
description: >
  Compatibility/source-tree copy of XTRM's core operating doctrine. The managed runtime
  skill is `.xtrm/skills/default/using-xtrm/SKILL.md`; exact work-lifecycle mechanics are
  exposed by `xt work` and `xt work guide`.
priority: high
---

# Using XTRM

The managed v4 doctrine lives in `.xtrm/skills/default/using-xtrm/SKILL.md`.

This source-tree surface intentionally keeps only the invariants that must not drift into
legacy behavior.

## Durable execution identity

XTRM does not allow anonymous repository mutation.

```text
existing tracked work
  -> xt work start --bead <id>

substantial / ambiguous / multi-worker work
  -> /planning
  -> contract-quality Bead
  -> xt work start --bead <id>

bounded local edit
  -> xt work start "<short title>" [--validation "<proof>"]
```

The lightweight path is an execution/check-in identity, not a fake planning exercise. If
scope grows or another worker will consume the work, route to `/planning`.

Use `xt work note` for meaningful progress transitions and `xt work status` to recover
current work. `xt work guide` prints the packaged lifecycle contract.

`bd prime` is an opt-in diagnostic, not a mandatory session-start ritual.

## Contract rule

Anything another worker may consume needs a real contract:

```text
PROBLEM
SUCCESS
SCOPE
NON_GOALS
CONSTRAINTS
VALIDATION
OUTPUT
```

Add `SCRUTINY` when risk, ambiguity, or review sensitivity warrants it.

> For substantial tracked work, the Bead is the prompt. For every mutating worker, the
> claimed work identity is its durable execution journal.

## Multi-agent rule

Workers are participants in one durable system. Prefer the smallest execution shape that
fits the job:

- current session for coherent local work;
- native subagent for bounded independent questions;
- `xt pi|claude|codex` for isolated/long-lived peers;
- `/using-specialists` for role-shaped governed work;
- deterministic scripts/tools for mechanical transforms.

Use `/multiplexing` for peer communication semantics. Native/extension transports are
preferred; tmux messaging is compatibility/observability, not the primary coordination
model.

## Continuity

`/starting-and-resuming-work` is for re-entry, takeover, context-pressure continuation,
and stalled-lane recovery. It no longer owns the generic requirement to create tracked
work or a ceremonial handoff artifact.

The next worker should recover from durable work state + repository/runtime evidence, not
from private transcript reconstruction.

## Runtime enforcement

Claim/edit/commit/stop hooks enforce deterministic lifecycle rules. Do not work around a
claim gate. Establish legitimate tracked identity instead.

For exact current behavior, use live CLI help and the managed default skill rather than
preserving old command recipes here.