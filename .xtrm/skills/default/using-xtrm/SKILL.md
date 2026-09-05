---
name: using-xtrm
description: >
  Core operating doctrine for an XTRM-equipped agent. Use at the start of substantial
  work and whenever deciding how to work, establish durable execution identity, create
  or hand off tracked work, delegate to another agent, or choose between direct work,
  native subagents, xt peers, Specialists, and deterministic workflows. XTRM agents are
  participants in a durable multi-agent system, not isolated chats. This skill defines
  work identity, contract quality, evidence, minimal-engineering, and routing rules;
  runtime hooks own deterministic enforcement.
priority: high
---

# Using XTRM

You are working inside XTRM, not alone.

Your current model/session is one participant in a durable work system. Work may move
between this session, native subagents, `xt pi` / `xt claude` / `xt codex` peers,
Specialists, and later substrate/ChainRun stages. Design work so another participant can
recover reality without reconstructing private chat context.

## The system contract

1. **Live state wins.** Current code, CLI help, Beads/work state, runtime state, tests,
   and external systems beat remembered commands, old reports, and model memory.
2. **No anonymous mutation.** Every repository mutation belongs to a claimed durable
   work identity. Today that identity is Beads-backed; use `xt work` rather than teaching
   every worker raw implementation mechanics.
3. **Beads owns current durable work state.** Contracts, dependencies, claims, progress,
   evidence, and execution journals live there today. Messages coordinate; they are not
   durable authority.
4. **A dispatchable work item is a contract.** Do not hand another worker a title and
   expect it to infer the job.
5. **XTRM is multi-agent by default, not delegation-by-default.** Use another worker when
   isolation, parallelism, role independence, fresh context, or long-running ownership
   adds value. Do obvious coherent work locally.
6. **Evidence before completion.** A worker summary is a claim. Verify important claims
   against the current tree, tests, runtime state, or external system.
7. **Continuity is execution state, not ceremony.** Keep durable state current at
   meaningful transitions; do not manufacture a second handoff artifact when the work
   record + repository evidence already say what the next worker needs.
8. **Debug causally.** For regressions, reconstruct symptom -> runtime/code path -> recent
   change -> commit/PR/Bead/worker intent -> causal mechanism before proposing a fix.

## Establish work identity before editing

The edit gate is intentionally strict. The cheap path is creating legitimate tracked
work, not bypassing the gate.

```text
existing Bead accurately represents this work?
  -> xt work start --bead <id>

no Bead + substantial / ambiguous / multi-worker work?
  -> /planning
  -> create or promote contract-quality work
  -> xt work start --bead <id>

no Bead + bounded / local work?
  -> xt work start "<short title>" [--validation "<proof>"]
```

`xt work start "..."` creates a lightweight execution/check-in Bead and claims it. This
is not an excuse to avoid planning: if scope grows, becomes ambiguous/high-risk, or will
be consumed by another worker, stop and use `/planning`.

Use `xt work guide` for the packaged lifecycle contract and current command semantics.
The CLI is the worker-facing abstraction so the underlying execution entity can later
move from Beads to substrate without reteaching every agent.

## Progress is a journal, not a transcript

Record meaningful state transitions, not every tool call:

```bash
xt work note "identified first bad boundary; implementation next"
xt work note "validation passed: <command/evidence>" --bead <id>
xt work status [id]
```

Useful updates include a completed coherent phase, changed scope, discovered blocker or
dependency, consumed review/worker result, validation outcome, and final evidence.

When a lightweight check-in serves existing planned work, link it non-blockingly:

```bash
xt work start "<bounded session work>" --relates <issue-id>
```

Do not use blocking dependency edges merely to mean “this worker is working on that.”
Dependencies must retain scheduling semantics.

## Contract quality applies to every consumed work item

The same quality floor applies whether a Bead goes to a Specialist, an `xt` peer, a
native subagent, a human, or a future ChainRun participant.

A ready contract answers:

```text
PROBLEM      why this work exists and what is wrong/missing
SUCCESS      observable end state
SCOPE        files/systems/work boundary the worker owns
NON_GOALS    nearby work it must not absorb
CONSTRAINTS  invariants, compatibility, safety and ownership rules
VALIDATION   commands/checks/evidence that prove success
OUTPUT       durable result expected from the worker
```

Add `SCRUTINY` for substantial, ambiguous, high-risk, or review-sensitive work. Add
`REFERENCES`, `LIBRARIES`, rollout/rollback, or telemetry requirements when they matter.

A backlog idea may be explicitly draft, but draft work is not dispatchable. `/planning`
owns the detailed authoring, decomposition, and promotion procedure.

**For substantial tracked work, the Bead is the prompt. For every mutating worker, the
claimed work identity is its durable execution journal.**

## How to engineer: smallest correct system change

Use a Ponytail-style reduction ladder, adapted for XTRM. The goal is not the fewest lines;
it is the least new machinery that fully satisfies the contract.

Before adding code or infrastructure:

1. Trace the real call/data/control flow and current behavior.
2. Ask whether a change is actually required.
3. Prefer deleting obsolete behavior or reusing an existing project primitive.
4. Prefer a capability the current runtime/platform already provides.
5. Prefer the language standard library.
6. Prefer an already-installed dependency with the right semantics.
7. Add the smallest custom implementation that remains clear and testable.

Do not optimize away validation, safety checks, security boundaries, accessibility,
observability, rollback, evidence, tests, durable state, or required failure handling.

## Choose the work shape deliberately

```text
one coherent task, current context is sufficient
  -> work here under a claimed work identity

bounded independent question / fresh context helps
  -> native subagent when the harness provides it

long-lived peer, separate worktree, cross-agent collaboration
  -> xt pi|claude|codex + /multiplexing

role-shaped tracked work with supervised evidence/review lifecycle
  -> /using-specialists

deterministic mechanical transform or validation
  -> script/tool/runtime primitive rather than another reasoning agent
```

Do not choose a bigger topology before you understand the work-list and overlap surface.
Parallelism is useful only when ownership boundaries are real.

## Before handing work to another worker

- Re-read current work state and repository evidence.
- Make the contract complete enough that the recipient does not need hidden context.
- State ownership and non-goals, especially for shared files/services.
- Give exact validation/evidence expectations.
- Choose a durable result location.
- Make reply/decision expectations explicit through `/multiplexing` when coordination is
  required.

If two workers would edit the same surface without a defined ordering/merge owner, do not
parallelize them.

## Memory and inherited context

Use `bd memories <topic>` when prior project history is relevant. Memories are dated
leads, never authority. Confirm anything actionable against live state.

A worker result, old Bead note, handoff, or prior assistant summary is also a lead.
Re-derive expensive or irreversible facts before acting.

## Runtime enforcement

Do not duplicate deterministic runtime gates in prose or manually simulate them.
Depending on the installed runtime, XTRM may enforce or inject claim/edit/commit gates,
worktree boundaries, memory doctrine, compact restore, quality checks, GitNexus context,
inbox reminders, logging, and other lifecycle behavior.

The claim gate means **establish work identity**, not “find a way around the hook.” When
exact mechanics matter, use `xt work guide` and current CLI help.

Hooks/extensions are the enforcement plane; skills are the judgment/procedure plane.

## Route to the focused skill

| Need | Skill / surface |
|---|---|
| Establish/inspect/update execution identity | `xt work` / `xt work guide` |
| Fresh-session re-entry, takeover, context pressure, stalled continuation | `/starting-and-resuming-work` |
| Coordinate peers/subagents and replies/wakeups | `/multiplexing` |
| Build/promote contracts, decompose work, triage/test-plan | `/planning` |
| Debug regressions, review, test, verify, reduce complexity | `/engineering-quality` |
| Use supervised Specialist roles/jobs | `/using-specialists` |
| Explore code graph, callers/processes, blast radius | `/gitnexus` |
| Create or improve skills | `/skill-creator` |
| Find/import additional governed skills | `/find-skills` |
| Production/SRE investigation when pack is enabled | `/sre-ops` |
Load the focused skill when you reach that phase. Do not preload every manual.

## Completion rule

Before declaring work done, answer four questions with evidence:

1. Is the intended state actually present now?
2. Did the required validation run, and what did it show?
3. Is durable work state updated so the next participant sees reality?
4. Are there unresolved workers, replies, risks, or follow-ups that change the claim?

Then close through the lifecycle (`xt work done ...`) rather than bypassing current Beads
memory/commit/stop gates. If any answer is unknown, report the unknown instead of
converting it into success.