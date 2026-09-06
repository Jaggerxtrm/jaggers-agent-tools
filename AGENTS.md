<!-- BEGIN INJECTED BLOCK -->
## Communication Style

Use controlled, precise, and direct language throughout the work session, including plans, progress updates, analysis, reviews, implementation notes, documentation, handoffs, and final reports. Prefer explicit subjects, active voice, consistent terminology, concrete statements, and logically ordered sentences. Keep the writing natural and concise. Avoid conversational filler, ornamental language, vague qualifiers, unnecessary jargon, and exaggerated certainty.

Adapt the level of rigor to the context. Use clear technical prose for analysis, architecture, debugging, design discussion, and collaboration. Use a stricter ASD-STE100-oriented style for procedures, commands, migrations, deployments, security requirements, destructive operations, rollback instructions, acceptance criteria, and operator handoffs. In these cases, state conditions before actions, identify the responsible actor, express one principal action per sentence, preserve the required sequence, and describe expected results and failure conditions explicitly.

Clearly distinguish verified facts, observations, assumptions, inferences, recommendations, and unresolved questions. Do not report an action as successful without evidence. Preserve exact names for repositories, services, contracts, routes, identifiers, configuration fields, and work items. Do not omit material ownership, dependencies, risks, preconditions, rollback requirements, or verification criteria for the sake of brevity.

## Task Tracking (two-tier)

Up to two task systems coexist in this repo. Where the runtime exposes both, use both; do not substitute one for the other. On a runtime with no task tools, beads alone is correct and complete — do not invent or call a native task API the runtime does not expose.

- **Beads (`bd`)** — top-level durable tracking, on every runtime. Authoritative for ownership, dependencies, cross-session memory, and closure. Read the rest of this file and use targeted lookup (`bd ready`, `bd search "<terms>"`, `bd show <id>`) before starting work; `bd prime` is opt-in diagnostic only. File, claim, and close work here.
- **The runtime's own task system, when the runtime has one** — this-session execution tracking. Use it to mirror the active bead and break it into smaller intermediate steps. Ephemeral; does not replace beads. Names differ per runtime; read the runtime's own tool list rather than assuming a name.

Rule: on a runtime that exposes task tools, when you pick up a bead, create native tasks that track it — reference the bead ID in each task title (e.g. `N.N summary — status (worker %NNNN)`) — and add any smaller intermediate steps as native sub-tasks. Beads own the durable record; native tasks own the in-flight breakdown.

Example native task list mirroring beads:
- ◼ N.N smoke container global surface — BLOCKS RELEASE (worker %NNNN)
- ◼ N.N status test flake under load (worker %NNNN)
- ◻ Pre-release smoke run against current main branches
- ◻ Dispatch N.N stale doc metrics + N.N Claude inbox surface
- ◻ Dispatch N.N, N.N, N.N remaining small beads
<!-- END INJECTED BLOCK -->

<!-- xtrm:start -->
# XTRM Agent Workflow

> Full reference: `/using-xtrm` skill (or `XTRM-GUIDE.md` where present).
> This is a compact managed block. Use CLI `--help` and focused skills for details.
> Shared canonical contract: `.xtrm/config/instructions/agent-contract.md`.

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

## Runtime notes

- Use the runtime's native task/subagent surfaces when they are actually available; do not invent them.
- Pi is the preferred XTRM harness, but the contract is runtime-neutral.
- Use `/multiplexing` for live peer coordination and `/using-specialists` for Specialist jobs.
<!-- xtrm:end -->

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **core**. Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/core/context` | Codebase overview, check index freshness |
| `gitnexus://repo/core/clusters` | All functional areas |
| `gitnexus://repo/core/processes` | All execution flows |
| `gitnexus://repo/core/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->

<!-- BEGIN BEADS INTEGRATION -->
## Issue Tracking with bd (beads)

**IMPORTANT**: This project uses **bd (beads)** for ALL issue tracking. Do NOT use markdown TODOs, task lists, or other tracking methods.

### Quick Start

**Check for ready work:**

```bash
bd ready --json
```

**Create new issues:**

```bash
bd create "Issue title" --description="Detailed context" -t bug|feature|task -p 0-4 --json
bd create "Issue title" --description="What this issue is about" -p 1 --deps discovered-from:bd-123 --json
```

**Claim and update:**

```bash
bd update <id> --claim --json
bd update bd-42 --priority 1 --json
```

**Complete work:**

```bash
bd close bd-42 --reason "Completed" --json
```

### Issue Types

- `bug` - Something broken
- `feature` - New functionality
- `task` - Work item (tests, docs, refactoring)
- `epic` - Large feature with subtasks
- `chore` - Maintenance (dependencies, tooling)

### Priorities

- `0` - Critical (security, data loss, broken builds)
- `1` - High (major features, important bugs)
- `2` - Medium (default, nice-to-have)
- `3` - Low (polish, optimization)
- `4` - Backlog (future ideas)

## Specialists

MCP is intentionally minimal: only `use_specialist` is exposed. Use CLI for orchestration (`run/feed/result/steer/resume/stop`).
Legacy `start_specialist` is deprecated and should be migrated to `specialists run <name> --prompt "..." --background` ahead of next-major removal.

**Core specialist commands (CLI-first in pi):**
- `specialists list`
- `specialists run <name> --bead <id>`
- `specialists run <name> --prompt "..."`
- `specialists feed -f` / `specialists feed <job-id>`
- `specialists result <job-id>`
- `specialists resume <job-id> "next task"` (for keep-alive jobs in `waiting`)
- `specialists stop <job-id>`

**Running specialists in background (recommended): use the process extension**
- Tool actions: `process start`, `list`, `output`, `logs`, `kill`, `clear`
- Example: `process start "specialists run explorer --bead unitAI-123" name="sp-explorer"`
- Useful commands: `/ps`, `/ps:pin`, `/ps:logs`, `/ps:kill`, `/ps:clear`, `/ps:dock`, `/ps:settings`
- Benefits: unified log dock, follow mode, focus mode, file-based logs, friendly names, auto-cleanup

**Canonical tracked flow**
1. Create/claim bead issue
2. Run specialist with `--bead <id>` (for long work, launch via `process start`)
3. Observe progress (`process output`/`process logs` or `specialists feed`)
4. Read final output (`specialists result <job-id>`)
5. Close/update bead with outcome

Add custom specialists to `.specialists/user/` to extend defaults.
