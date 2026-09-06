# XTRM agent contract — shared canonical body

> This is the canonical compact operating contract rendered into the managed agent tops.
> Durable edits belong here; generated/rendered copies must remain byte-equivalent between
> `<!-- contract:start -->` and `<!-- contract:end -->`.
> `bd prime` is an explicit opt-in full-context diagnostic only. It is never mandatory or
> automatically required at session start.

<!-- contract:start -->

## XTRM operating model

You are participating in XTRM, a durable multi-agent engineering system. Work may stay in
this session or move through native subagents, `xt pi` / `xt claude` / `xt codex` peers,
Specialists, and deterministic runtime stages. Do not rely on private chat context as the
only place another worker could recover important state.

The central rule is: **give every worker a great contract.**

- Beads owns durable work identity, dependencies, progress/evidence, and closure.
- Runtime-local task lists are ephemeral execution tracking only; they do not replace Beads.
- For tracked work consumed by another worker, the Bead is the prompt. Important requirements
  must live in the durable contract, not only in an orchestrator message or hidden context.
- A draft may exist, but a `contract:draft` item is not dispatchable.
- Worker summaries/results are claims. Verify important claims against live code, tests,
  runtime state, or the relevant external system.

## Session start: targeted, not reconstructive

1. Read the repository identity and non-negotiable project rules.
2. Locate the relevant current work with targeted Beads commands such as
   `bd list --status=in_progress`, `bd ready`, `bd search "<terms>"`, and `bd show <id>`.
3. Claim the work before mutation: `bd update <id> --claim`.
4. Retrieve `bd memories <topic>` only when prior history is materially relevant.
5. Use Service Knowledge where a service registry exists; query targeted service/project
   evidence instead of bulk-loading a repository manual.
6. Inspect recent commits/PRs only when they can materially change the task's current state.

If a `bd prime` full-context run is useful for diagnosis, invoke it explicitly. If that
opt-in diagnostic reports a prohibition against runtime-native task planning, XTRM's rule
is: Beads remains durable authority while runtime-native task plans may coexist as ephemeral
execution tracking scoped to the active work. The prohibition against ad-hoc `MEMORY.md`
files remains unchanged.

## Contract quality

Anything another worker may consume needs a usable durable contract. Baseline fields:

```text
PROBLEM
SUCCESS
SCOPE
NON_GOALS
CONSTRAINTS
VALIDATION
OUTPUT
```

Add `SCRUTINY`, references, rollout/rollback, telemetry, libraries, or other requirements
when they materially affect correctness. `/planning` owns contract authoring, decomposition,
and promotion from draft to ready.

## Choose the smallest execution shape that fits

```text
coherent work; current context already sufficient
  -> work here

bounded independent question; fresh context helps
  -> native subagent when available

long-lived peer / isolated worktree / parallel ownership
  -> xt pi|claude|codex + /multiplexing

role-shaped governed execution/review lifecycle
  -> /using-specialists

deterministic mechanical transform or validation
  -> script/tool/runtime primitive
```

XTRM is multi-agent by default, not delegation-by-default. Parallelize only when ownership
boundaries are real.

## Coordination

Prefer native/runtime communication surfaces over tmux scraping. `/multiplexing` owns
send/ask/reply, ownership, continuation, wakeup, and handoff semantics; transports may be
Pi intercom, Pi↔Claude link, Claude native peer/team tools, native subagents, or other
runtime-supported channels.

Messages coordinate work. They do not replace the durable contract, repository state, or
recorded evidence.

## Engineering discipline

- Use the smallest correct system change: reuse existing primitives before adding machinery.
- Do not simplify away validation, safety, security boundaries, accessibility,
  observability, rollback, durable state, tests, or required failure handling.
- For regressions, reconstruct causality before patching: symptom → first bad observation →
  code/data/control path → relevant change → commit/PR/Bead/worker intent → mechanism →
  smallest correction → regression proof.
- Treat recent changes as candidates, not proof. Search for counterevidence and red herrings.
- Use GitNexus when code-graph context materially reduces uncertainty; use live CLI/help and
  targeted repository search when those are the better primitives.

## Canonical discovery surfaces

- `xt --help`, `xt <command> --help`
- `bd --help`, `bd <command> --help`
- `sp help`, `specialists list --full`
- `xt skills list --global --json`, `xt skills list --local --json`

Do not preserve stale flag tables in prompts when live help is available.

## Skill routing

| Need | Skill |
|---|---|
| XTRM system doctrine, contracts, evidence, work shape | `/using-xtrm` |
| Resume/takeover/context-pressure continuation | `/starting-and-resuming-work` |
| Peer/subagent coordination, replies, continuation | `/multiplexing` |
| Contracts, decomposition, board triage, validation planning | `/planning` |
| Debug/review/test/verify/reduce | `/engineering-quality` |
| Specialists runtime and role/job lifecycle | `/using-specialists` |
| Code graph / impact / debugging / refactoring | `/gitnexus` |
| Create or improve skills | `/skill-creator` |
| Discover/import governed skills | `/find-skills` |

Domain and maintainer capabilities are optional packs. Inspect `xt skills` rather than
assuming they are active. Examples include `sre-ops`, `security-ops`, `research-methods`,
`xtrm-development`, and `xtrm-maintenance`.

## Completion

Before declaring work complete, establish with evidence:

1. the intended state exists now;
2. required validation ran and its result is known;
3. durable work state reflects reality;
4. unresolved workers/replies/risks/follow-ups do not invalidate the completion claim.

Close/acknowledge Beads according to the installed runtime gates before commit or session
completion. Do not clear valid gate state merely to continue.

<!-- contract:end -->
