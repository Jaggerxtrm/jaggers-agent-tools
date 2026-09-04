<!-- BEGIN INJECTED BLOCK -->
## Communication Style

Use controlled, precise, and direct language throughout the work session, including plans, progress updates, analysis, reviews, implementation notes, documentation, handoffs, and final reports. Prefer explicit subjects, active voice, consistent terminology, concrete statements, and logically ordered sentences. Keep the writing natural and concise. Avoid conversational filler, ornamental language, vague qualifiers, unnecessary jargon, and exaggerated certainty.

Adapt the level of rigor to the context. Use clear technical prose for analysis, architecture, debugging, design discussion, and collaboration. Use a stricter ASD-STE100-oriented style for procedures, commands, migrations, deployments, security requirements, destructive operations, rollback instructions, acceptance criteria, and operator handoffs. In these cases, state conditions before actions, identify the responsible actor, express one principal action per sentence, preserve the required sequence, and describe expected results and failure conditions explicitly.

Clearly distinguish verified facts, observations, assumptions, inferences, recommendations, and unresolved questions. Do not report an action as successful without evidence. Preserve exact names for repositories, services, contracts, routes, identifiers, configuration fields, and work items. Do not omit material ownership, dependencies, risks, preconditions, rollback requirements, or verification criteria for the sake of brevity.

## Task Tracking (two-tier)

Up to two task systems coexist in this repo. Where the runtime exposes both, use both; do not substitute one for the other. On a runtime with no task tools, beads alone is correct and complete — do not invent or call a native task API the runtime does not expose.

- **Beads (`bd`)** — top-level durable tracking, on every runtime. Authoritative for ownership, dependencies, cross-session memory, and closure. Read the rest of this file and use targeted lookup (`bd ready`, `bd show <id>`) before starting work. File, claim, and close work here.
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

> Full reference: [XTRM-GUIDE.md](XTRM-GUIDE.md)
> Session start is targeted, not a bulk dump: repo identity first, then Service
> Knowledge retrieval for service context, then targeted Beads lookup for
> executable work. `bd prime` is opt-in diagnostic only — never automatic.

## Session Start (targeted)

1. Read repo identity + non-negotiable rules first (top of this file).
2. Service context (service-hosting repos): check `service-knowledge status` /
   `service-knowledge index stats` (rebuild when stale/absent), then
   `service-knowledge index query "<3-5 task terms>" --bundle` (or `--paths`,
   `--service-id`). Read only cited service SKILL/evidence.
3. Executable work: targeted Beads lookup — `bd list --status=in_progress`,
   `bd ready`, `bd search "<task terms>"`, `bd show <id>` (`bv --robot-triage`
   only when graph-aware prioritization is needed) — then
   `bd update <id> --claim` before edits. `bd memories` / `bd recall`
   only when history is relevant.

## Execution Interaction Policy

- Proceed by default on standard implementation tasks once scope is clear.
- Do **not** ask repetitive “Proceed? Yes/No” confirmations.
- Ask for confirmation only when actions are destructive, irreversible, or high-risk (e.g. `rm`, history rewrite, mass deletes, credential rotation, prod-impacting ops).
- Prefer concise clarifying questions only when requirements are genuinely ambiguous.

## Active Gates (hooks enforce these — not optional)

| Gate | Trigger | Required action |
|------|---------|-----------------|
| **Edit** | Write/Edit without active claim | `bd update <id> --claim` |
| **Commit** | `git commit` while claim is open | `bd close <id>` first, then commit |
| **Stop** | Session end with unclosed claim | `bd close <id>` |
| **Memory** | `bd close <id>` without issue ack | First run `bd remember "<insight>"` (or decide nothing novel), then `bd kv set "memory-acked:<id>" "saved:<key>"` or `"nothing novel:<reason>"`, then retry `bd close <id> --reason="..."` |

## bd Command Reference

```bash
# Work discovery
bd ready                               # Unblocked open issues
bd show <id>                           # Full detail + deps + blockers
bd list --status=in_progress           # Your active claims
bd query "status=in_progress AND assignee=me"  # Complex filter
bd search <text>                       # Full-text search across issues

# Claiming & updating
bd update <id> --claim                 # Claim (sets you as owner, status→in_progress)
bd update <id> --notes "..."           # REPLACES notes (destructive — overwrites prior)
bd update <id> --append-notes "..."    # Append to existing notes (newline-separated)
bd update <id> --status=blocked        # Mark blocked
bd update                              # Update last-touched issue (no ID needed)

# Creating
bd create --title="..." --description="..." --type=task --priority=2
# --deps "discovered-from:<parent-id>"  link follow-ups to source
# priority: 0=critical  1=high  2=medium  3=low  4=backlog
# types: task | bug | feature | epic | chore | decision

# Closing
# Memory gate: ack per issue before close
#   bd kv set "memory-acked:<id>" "saved:<key>"  OR  "nothing novel:<reason>"
bd close <id>                          # Close issue (blocked until memory-acked:<id> exists)
bd close <id> --reason="Done: ..."     # Close with context
bd close <id1> <id2> <id3>            # Batch close (each id needs its own memory ack)

# Dependencies
bd dep add <issue> <depends-on>        # issue depends on depends-on (depends-on blocks issue)
bd dep <blocker> --blocks <blocked>    # shorthand: blocker blocks blocked
bd dep relate <a> <b>                  # non-blocking "relates to" link
bd dep tree <id>                       # visualise dependency tree
bd blocked                             # show all currently blocked issues

# Persistent memory
bd remember "<insight>"                # Store across sessions (project-scoped)
bd memories <keyword>                  # Search stored memories
bd recall <key>                        # Retrieve full memory by key
bd forget <key>                        # Remove a memory

# Health & pre-flight
bd stats                               # Open/closed/blocked counts
bd preflight --check                   # Pre-PR readiness (lint, tests, beads)
bd doctor                              # Diagnose installation issues
```

## Git Workflow (strict: one branch per issue)

```bash
git checkout -b feature/<issue-id>-<slug>   # or fix/... chore/...
bd update <id> --claim                       # claim before any edit
# ... write code ...
bd close <id> --reason="..."                 # closes issue
xt end                                       # push, PR, merge, worktree cleanup
```

**Never** continue new work on a previously used branch.

## Quality Gates (automatic)

Run on every file edit via PostToolUse extension:
- **TypeScript/JS**: ESLint + tsc
- **Python**: ruff + mypy

Gate output appears as extension context. Fix failures before proceeding — do not commit with lint errors.

## bv — Graph-Aware Triage

bv is a graph-aware triage engine for the beads issue board. Use it instead of `bd ready` when you need ranked picks, dependency-aware scheduling, or project health signals.

> **CRITICAL: Use ONLY `--robot-*` flags. Bare `bv` launches an interactive TUI that blocks your session.**

```bash
bv --robot-triage             # THE entry point — ranked picks, quick wins, blockers, health
bv --robot-next               # Single top pick + claim command (minimal output)
bv --robot-triage --format toon  # Token-optimized output for lower context usage
```

**Scope boundary:** bv = *what to work on*. `bd` = creating, claiming, closing issues.

### Planning & Analysis

| Command | Returns |
|---------|---------|
| `--robot-plan` | Parallel execution tracks with unblocks lists |
| `--robot-priority` | Priority misalignment detection |
| `--robot-insights` | Full graph metrics: PageRank, betweenness, HITS, eigenvector, critical path, cycles |
| `--robot-forecast <id\|all>` | ETA predictions with dependency-aware scheduling |
| `--robot-alerts` | Stale issues, blocking cascades, priority mismatches |
| `--robot-diff --diff-since <ref>` | Changes since ref: new/closed/modified, cycles introduced/resolved |

### Scoping & Filtering

```bash
bv --robot-plan --label backend        # Scope to label's subgraph
bv --recipe actionable --robot-plan    # Pre-filter: ready to work (no blockers)
bv --recipe high-impact --robot-triage # Pre-filter: top PageRank scores
bv --robot-triage --robot-triage-by-track  # Group by parallel work streams
```

### Understanding Output

- `data_hash` — fingerprint of beads state (verify consistency across calls)
- Phase 1 (instant): degree, topo sort, density
- Phase 2 (async, 500ms): PageRank, betweenness, HITS, cycles — check `status` flags

```bash
bv --robot-triage | jq '.quick_ref'              # At-a-glance summary
bv --robot-triage | jq '.recommendations[0]'     # Top recommendation
bv --robot-plan | jq '.plan.summary.highest_impact'
bv --robot-insights | jq '.Cycles'               # Circular deps — must fix
```

## Worktree Sessions

- `xt claude` — launch Claude Code in a sandboxed worktree
- `xt pi` — launch Pi in a sandboxed worktree
- `xt end` — close session: commit / push / PR / cleanup
- `xt worktree audit-prs --json` — read-only PR drift / needs-rebase audit before merge queues
- `xt worktree branch-gc --prefix xt/ --json` — dry-run merged/closed branch cleanup; add `--apply --yes` only when deletion is intended
- `xt worktree restart-audit --json` — read-only restart/handoff hygiene audit for orphaned dirs, branch/worktree drift, and PR attention
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
