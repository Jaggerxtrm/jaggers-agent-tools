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

## Runtime notes (Claude Code)

- Use Claude native task/subagent/team surfaces when available, alongside—not instead of—Beads.
- Claude↔Claude coordination should prefer native messaging/team tools where available.
- Use `/multiplexing` for live peer coordination and `/using-specialists` for Specialist jobs.
<!-- xtrm:end -->

<!-- BEGIN INJECTED BLOCK -->
## Communication Style

Use controlled, precise, and direct language throughout the work session, including plans, progress updates, analysis, reviews, implementation notes, documentation, handoffs, and final reports. Prefer explicit subjects, active voice, consistent terminology, concrete statements, and logically ordered sentences. Keep the writing natural and concise. Avoid conversational filler, ornamental language, vague qualifiers, unnecessary jargon, and exaggerated certainty.

Adapt the level of rigor to the context. Use clear technical prose for analysis, architecture, debugging, design discussion, and collaboration. Use a stricter ASD-STE100-oriented style for procedures, commands, migrations, deployments, security requirements, destructive operations, rollback instructions, acceptance criteria, and operator handoffs. In these cases, state conditions before actions, identify the responsible actor, express one principal action per sentence, preserve the required sequence, and describe expected results and failure conditions explicitly.

Clearly distinguish verified facts, observations, assumptions, inferences, recommendations, and unresolved questions. Do not report an action as successful without evidence. Preserve exact names for repositories, services, contracts, routes, identifiers, configuration fields, and work items. Do not omit material ownership, dependencies, risks, preconditions, rollback requirements, or verification criteria for the sake of brevity.

## Task Tracking (two-tier)

Two task systems coexist in this repo. Use both; do not substitute one for the other.

- **Beads (`bd`)** — top-level durable tracking. Authoritative for ownership, dependencies, cross-session memory, and closure. Read the rest of this file and use targeted lookup (`bd ready`, `bd search "<terms>"`, `bd show <id>`) before starting work; `bd prime` is opt-in diagnostic only. File, claim, and close work here.
- **Native integrated task system** (`TaskCreate` / `TaskList` / `TaskGet` / `TaskUpdate` / `TaskExecute`) — this-session execution tracking. Use it to mirror the active bead and break it into smaller intermediate steps. Ephemeral; does not replace beads.

Rule: when you pick up a bead, create native tasks that track it — reference the bead ID in each task title (e.g. `N.N summary — status (worker %NNNN)`) — and add any smaller intermediate steps as native sub-tasks. Beads own the durable record; native tasks own the in-flight breakdown.

Example native task list mirroring beads:
- ◼ N.N smoke container global surface — BLOCKS RELEASE (worker %NNNN)
- ◼ N.N status test flake under load (worker %NNNN)
- ◻ Pre-release smoke run against current main branches
- ◻ Dispatch N.N stale doc metrics + N.N Claude inbox surface
- ◻ Dispatch N.N, N.N, N.N remaining small beads
<!-- END INJECTED BLOCK -->

# xtrm-tools — Claude Code Guide

This file is a compact routing guide for Claude Code sessions in `xtrm-tools`. It should stay current, short, and operational. For deep workflow details, load the referenced skills or use each CLI's `--help`; do not paste full manuals here.

## Project summary

`xtrm-tools` is the source repo for the xtrm agent tooling ecosystem: Claude Code plugin assets, Pi extension wiring, skills, hooks, MCP config, registry generation, and the `xt` CLI. It is a dual-runtime project: Claude Code and Pi are peers fed by shared xtrm policy/config sources.

## Non-negotiable rules

- Use beads as the authoritative issue tracker and normal work lifecycle. Inspect/claim/close with `bd` before and after edits.
- To proceed on any non-trivial or multi-step Claude Code work, use Claude Code task planning features (TaskCreate/TodoWrite-style when available) alongside normal bead operations. The local plan must mirror the active bead scope and never replace beads for ownership, dependencies, memory gates, or closure.
- Specialists are a normal operational surface here. Before specialist work, check `sp --help` and `sp list` / `specialists list` so you know the available roles and current CLI shape.
- For documentation, service understanding, and project/service context, use the canonical service-skills skill set (`/scope`, `/using-service-skills`) as the primary knowledge substrate.
- Never commit while a bead claim is open. Close the bead and satisfy memory ack first.
- Before editing an existing function, class, or method, run GitNexus impact analysis.
- Before committing, run `gitnexus_detect_changes()` for scope verification.
- Do not edit generated files directly unless the task is explicitly to update generated artifacts.
- `.xtrm/config/hooks.json` is generated from `policies/*.json`; edit policies and run `npm run compile-policies`.
- `.xtrm/registry.json` is generated; run `npm run gen-registry` after adding/changing managed assets.
- `cli/dist` is tracked; rebuild with `npm run build` when CLI source changes.
- Ask before destructive, irreversible, production-impacting, or history-rewriting actions.

## Session start: targeted, not reconstructive

1. `bd list --status=in_progress`, `bd ready`, `bd search "<terms>"`, `bd show <id>` — locate the relevant current work.
2. `bd memories <topic>` — retrieve relevant memory only when prior history is materially relevant.
3. `bv --robot-triage` or `bv --robot-next` — choose work when needed. Never run bare `bv`.
4. `bd update <id> --claim` — claim before edits.

`bd prime` is opt-in diagnostic only; invoke it explicitly when a full-context run helps.

For full xtrm/beads workflow details, load `/using-xtrm` and use `bd --help`, `bd <cmd> --help`, `xt --help`.

## Skill routing

| Need | Load/use |
|---|---|
| xtrm workflow, beads gates, session behavior | `/using-xtrm`; `bd --help`; `xt --help` |
| Specialist orchestration | latest `/using-specialists-*`, prefer `/using-specialists`; `sp --help` / `specialists --help` |
| Planning feature/epic work | `/planning` plus `/test-planning` |
| Tests and quality workflow | `/using-quality-gates`, `/using-tdd`, `/test-planning` |
| Docs sync | `/sync-docs`; use the canonical service-skills skill set for project/service context |
| Release | `/releasing` |
| Session close / PR flow | `/xt-end`, `/session-close-report`, `/xt-merge` |
| Skill creation/update | `/skill-creator` |
| Hook work | `/hook-development` |
| Service routing | `/scope`, `/using-service-skills` when service territories exist |
| GitNexus exploration/debug/refactor | matching `/gitnexus-*` skill |
| Pi long-running commands | `/pi-processes`; use the `process` tool |

## Project map

- `cli/src/commands/` — `xt` command implementations.
- `cli/src/core/` — install/update/runtime sync logic, registry scaffolding, Pi runtime, skills materialization.
- `cli/src/utils/` — worktree/session helpers and shared CLI utilities.
- `cli/src/tests/` and `cli/test/` — CLI and integration tests.
- `policies/` — source of hook/policy wiring; compile to `.xtrm/config/hooks.json`.
- `.xtrm/config/` — generated/runtime config payload installed into consumer projects.
- `.xtrm/hooks/` — hook payloads copied to projects.
- `.xtrm/skills/default/` — legacy per-repo path; canonical now at `~/.xtrm/skills/default/` (global SSOT).
- `.xtrm/skills/optional/` — legacy per-repo path; canonical now at `~/.xtrm/skills/optional/` (global SSOT).
- `.xtrm/ext-src/` and `packages/pi-extensions/extensions/` — Pi extension sources and packaged extension workspace.
- `skills/` — legacy/source skill mirror used by some checks and docs.
- `scripts/` — registry, packaging, policy, hygiene, and release helper scripts.
- `docs/` — architecture, release, ownership, cleanup, and user docs.
- `.wolf/` — OpenWolf project memory/anatomy/buglog state.

## Essential command surface

Keep only the commands an agent needs without another manual. Use `--help` for full syntax.

### Beads / xtrm workflow

- `bd prime` — opt-in diagnostic full-context load. Not a session-start step.
- `bd ready` — list unblocked open issues.
- `bd list --status=in_progress` — see active claims.
- `bd show <id>` — inspect detail, deps, blockers, notes.
- `bd update <id> --claim` — claim before edits.
- `bd memories <topic>` / `bd recall <key>` — retrieve durable context.
- `bd remember "<insight>"` — save durable context.
- `bd kv set memory-acked:<id> saved:<key>` or `nothing novel:<reason>` — satisfy close-time memory gate.
- `bd close <id> --reason="..."` — close before commit.
- `bv --robot-triage --format toon` / `bv --robot-next` — ranked work selection; never run bare `bv`.
- `xt update --apply` — refresh xtrm-managed assets in a repo.
- `xt end` — close worktree session / PR flow when appropriate.
- `xt worktree audit-prs --json`, `branch-gc --json`, `restart-audit --json` — PR drift, safe branch-GC dry run, and restart/handoff hygiene.

### Specialists

- `sp list` / `specialists list` — discover available specialists.
- `sp ps` — inspect running specialist jobs.
- `sp feed <job-id>` — monitor job progress.
- `sp result <job-id>` — read final output.
- For orchestration policy, load latest `/using-specialists-*`, preferring `/using-specialists`.

### GitNexus safety

- `gitnexus_impact({ target: "symbolName", direction: "upstream", repo: "xtrm-tools" })` — required before changing existing symbols.
- `gitnexus_detect_changes({ scope: "all", repo: "xtrm-tools" })` — required before commit / handoff verification.
- `gitnexus_query({ query: "concept", repo: "xtrm-tools" })` — explore unfamiliar flows before grep-heavy reads.
- `gitnexus_context({ name: "symbolName", repo: "xtrm-tools" })` — inspect callers/callees/processes.

### Local validation

- `npm run gen-registry` — after managed asset or skill changes.
- `npm run compile-policies` — after policy changes.
- `npm run build` — after CLI source changes; `cli/dist` is tracked.
- `npm test --workspace cli` — CLI test suite; prefer targeted tests during iteration.
- `npm run check:registry-pack-parity` and `npm run check:payload-hygiene` — package/registry hygiene.

## Claude Code notes

- For non-trivial or multi-step Claude Code work, create and maintain a small internal task plan before proceeding; keep it synchronized with the active bead and clear/complete it as work progresses.
- For service/documentation context, route through `/scope` and the canonical service-skills skill set first.
- Use GitNexus for unfamiliar code execution flows before grepping large trees.
- Use `structured_return` for tests, builds, lint, typecheck, and other quality commands.
- Use `process` for long-running servers/watchers/log tails.
- Do not create markdown TODO lists for work tracking; use `bd` issues.

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

## OpenWolf rules

- Before reading project files, check `.wolf/anatomy.md`.
- Before generating code, check `.wolf/cerebrum.md` Do-Not-Repeat entries.
- Before fixing bugs/errors, read `.wolf/buglog.json` for known fixes.
- After editing files, update `.wolf/anatomy.md` and append a concise note to `.wolf/memory.md`.
- After fixing a bug, failed test, failed build, or user-reported problem, log it in `.wolf/buglog.json` with root cause and fix.
- If a user correction reveals a durable preference or mistake, update `.wolf/cerebrum.md` immediately.

## Current gotchas

- `xt` has no `install` subcommand; fresh bootstrap is `xt init -y`, ongoing refresh is `xt update --apply`.
- Runtime skills view is flat `.xtrm/skills/active` (composed) and `~/.xtrm/skills/active` (global); legacy `active/claude` or `active/pi` paths are stale.
- New skills go under `~/.xtrm/skills/default/<name>/` (global SSOT); run `npm run gen-registry` and validate pack/registry parity.
- Specialist-owned skills must be edited in the specialists repo first, then vendored into xtrm-tools and shipped to `~/.xtrm/skills/default/`.
- Pi npm-provided skills (for example GitNexus skills) may need exclusion from Pi runtime views to avoid collisions.
- Worktrees do not carry ignored dependencies (`node_modules`, `.venv`); run the repo bootstrap inside the worktree when needed.
- `.xtrm/reports/` is gitignored; use `git add -f` only when a report should be committed.
- Per-repo `default/` and `optional/` are deprecated; migrate with `xt migrate skills --apply`.
- `pr-review-gate` GitHub Actions workflow is a required check on `main`/`master` across the 16 xtrm/mercuryintelligence/Jaggerxtrm-managed repos with real PR flow. Canonical template lives at `skills/security-pipeline/templates/.github/workflows/pr-review-gate.yml`; installed per-repo via `security-bootstrap.sh` and NOT auto-synced by `xt update --apply` — template changes require a manual fanout (see wave-1 `xtrm-7cjkv` + wave-2 `xtrm-54zwl.7` bead notes for the batch pattern).

## Quality gates

Run targeted validation relevant to the files changed. Common checks:

- Skill/asset changes: `npm run gen-registry`, `npm run check:registry-pack-parity`, `npm run check:skills-symlinks`.
- Policy/hook wiring: `npm run compile-policies`, then targeted policy tests.
- CLI source: `npm run build`, targeted `npm test --workspace cli -- <test>` or full `npm test --workspace cli` when appropriate.
- Package/release hygiene: `npm run check:payload-hygiene`, `npm run check:specialists-vendor`, `npm run check:skills-ownership`.

## References

- `README.md` — user-facing overview.
- `XTRM-GUIDE.md` — full workflow reference.
- `docs/release.md` — release/operator playbook.
- `docs/skills-ownership.json` and `docs/skills-ownership.md` — skill ownership and vendoring rules.
- `docs/plans/global-skills-migration.md` — global skills migration architecture and operator workflow.
- `~/.xtrm/skills/default/using-xtrm/SKILL.md` — current xtrm workflow behavior (global SSOT).
- `~/.xtrm/skills/default/agent-docs-maintainer/SKILL.md` — how to keep this file compact.
