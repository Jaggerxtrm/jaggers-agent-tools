# XTRM Work Lifecycle

XTRM does not allow anonymous repository mutation.

Every mutating worker needs a durable execution identity before it edits. Today that identity is implemented with a claimed Bead. The CLI contract is intentionally higher-level so a future substrate execution entity can replace the Beads-backed implementation without changing the worker-facing doctrine.

## Start rule

Before repository mutation:

```text
existing Bead accurately represents this work?
  -> xt work start --bead <id>

no Bead + substantial / ambiguous / multi-worker work?
  -> /planning
  -> create or promote a contract-quality Bead
  -> xt work start --bead <id>

no Bead + bounded / local work?
  -> xt work start "<short work title>" [--validation "<proof>"]
```

The gate stays strict. Creating legitimate tracked work should be cheap.

## Two related kinds of durable work

### Contract-quality planned work

Anything another worker may consume must be a real work contract:

```text
PROBLEM
SUCCESS
SCOPE
NON_GOALS
CONSTRAINTS
VALIDATION
OUTPUT
```

Add `SCRUTINY` when the work is substantial, ambiguous, high-risk, or review-sensitive. `/planning` owns authoring and decomposition.

### Lightweight execution check-in

A bounded local edit does not need a fake seven-section planning exercise. `xt work start "..."` creates and claims a small execution/check-in Bead whose job is to answer:

- what is this worker doing;
- what evidence will prove it is done;
- which existing issue(s) does it relate to, when applicable;
- what meaningful progress has happened;
- what remains or is blocked.

If the work grows in scope, becomes ambiguous, or is handed to another worker, stop treating the lightweight check-in as sufficient. Run `/planning` and promote/replace it with contract-quality work.

## Progress is a journal, not a transcript

Update durable state at meaningful transitions, not after every tool call.

Good journal events include:

- investigation established the affected path;
- implementation of a coherent phase completed;
- validation changed the confidence level;
- a blocker or dependency appeared;
- scope materially changed;
- a review/worker result was consumed;
- final evidence is available.

Use:

```bash
xt work note "<meaningful progress>" [--bead <id>]
```

Do not create a second handoff document merely to restate state already present in the Bead, repository, commits, tests, worker results, or PR. The durable work record should make continuation cheap.

## Relationships

A lightweight execution check-in that serves an existing issue should use a non-blocking relationship unless there is a real scheduling dependency.

```bash
xt work start "<session work>" --relates <issue-id>
```

Use blocking dependency edges only when one item truly must complete before another can proceed. Do not overload dependency semantics to mean "this session is working on that issue."

## Resume

`starting-and-resuming-work` owns re-entry, takeover, context-pressure continuation, and stalled-lane recovery. The durable work identity rule itself belongs to `using-xtrm`.

```bash
xt work resume <id>
xt work status [id]
```

A successor should recover from live work state + repository evidence, not from a ceremonial handoff artifact.

## Completion

Before closing:

1. verify intended state;
2. run/record the required validation;
3. append final evidence or unresolved truth;
4. ensure related work/dependencies still reflect reality;
5. close the execution identity.

```bash
xt work done [id] --reason "<validated result>"
```

`xt work done` delegates to the current Beads close lifecycle and does not bypass memory, commit, or other runtime gates.

## Durable rule

> For substantial tracked work, the Bead is the prompt. For every mutating worker, the claimed work identity is its durable execution journal.

The first rule protects contract quality. The second prevents invisible work.