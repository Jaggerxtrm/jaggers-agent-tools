---
name: hook-development
description: >
  Develop or change XTRM runtime hooks and policy wiring. Use when adding a hook event,
  changing matchers/gates, porting behavior across Claude/Pi surfaces, or debugging hook
  payload/config drift. Treat `policies/*.json` as wiring source, `.xtrm/hooks/**` as
  shipped payload, and `.xtrm/config/hooks.json` as compiled output; validate all three
  instead of editing generated config by hand.
disable-model-invocation: true
---

# Hook Development

XTRM hook development has three distinct layers:

```text
policies/*.json
  -> scripts/compile-policies.mjs
  -> .xtrm/config/hooks.json

policy command references
  -> .xtrm/hooks/<payload>

runtime adapters
  -> Claude hook config / Pi extensions and equivalent harness surfaces
```

Do not edit `.xtrm/config/hooks.json` directly as the source of a hook change. Change the
policy and payload, then compile and verify parity.

## Start from current truth

Read the affected policy, current hook payload, `scripts/compile-policies.mjs`, and
`docs/hooks.md`. For Pi behavior, inspect the corresponding policy `pi.extension` and the
current extension source rather than assuming Claude events map one-to-one.

Before changing an event/matcher, inspect the runtime's current hook API/documentation if
the contract may have changed.

## Implementation sequence

```text
define event + failure semantics
  -> implement smallest hook payload
  -> wire it in policy
  -> compile hooks config
  -> run payload/wiring parity
  -> test representative allow/block/fail-open cases
  -> verify Pi parity when policy targets Pi/both
  -> update docs if public/current behavior changed
```

A hook must decide explicitly whether errors fail open or fail closed. Do not let an
uncaught exception accidentally choose policy.

## Deterministic validation

The preserved helper scripts under `scripts/` can lint/test hook shape. Their exact
supported inputs may predate current XTRM policy compilation, so use them as helpers rather
than authority. The current release gates are:

```bash
node scripts/compile-policies.mjs --check
node scripts/compile-policies.mjs --check-pi
```

`compile-policies` also validates that every Claude-side `${CLAUDE_PLUGIN_ROOT}/hooks/...`
reference resolves to a regular file under `.xtrm/hooks/`. A missing payload is a release
failure.

## Hook design rules

- Keep hooks deterministic and bounded; move reasoning to skills/agents.
- Read the minimum state needed for the decision.
- Return compact actionable messages; do not dump large context on every event.
- Avoid network calls on hot paths unless the runtime contract explicitly requires them.
- Preserve session/user state on failure; never mutate unrelated work as a side effect.
- Test positive, negative, missing-dependency, malformed-input, and timeout/error paths.
- When a hook maintains cache/KV state, define ownership and cleanup/resume semantics.
- Do not duplicate Beads lifecycle authority in diagnostic hook telemetry; Beads/Dolt owns
  canonical lifecycle facts.

## Current lifecycle coverage

The compiled config currently uses `SessionStart`, `PreToolUse`, `PostToolUse`, `Stop`,
and `PreCompact`. Current Core hooks include worktree boundary/reaping, Beads gates and
continuity, Specialists Agent guard, quality checks, GitNexus enrichment, session/tool
logging, and inbox reminder behavior. Always re-read the compiled config because this set
changes over time.

## Completion

A hook change is ready only when policy compilation is clean, referenced payload exists,
relevant hook tests pass, Pi parity is checked when applicable, generated config has no
unexpected diff, and `docs/hooks.md` reflects any changed current behavior.
