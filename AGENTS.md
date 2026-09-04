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

> Full reference: `XTRM-GUIDE.md` | Session manual: `/using-xtrm` skill.
> This is a compact managed block. Use CLI `--help` and skills for details; do not paste full manuals here.
> Shared canonical contract (`.xtrm/config/instructions/agent-contract.md`); the sections between the contract markers are byte-identical in both tops. Only the trailing Runtime notes differ.

<!-- contract:start -->
## Canonical Sources
- **CLI `--help` is canonical.** Run `<tool> --help` or `<tool> <subcmd> --help` when unsure; skills own **when**, help owns **how**.
- Managed blocks (`agents-top.md`, `claude-top.md`, `/using-xtrm`) are compact routers, not replacements for `--help`.
- Managed blocks and installed skills update via `xt update --apply`; consumers see changes on the next run.
- Check runtime versions with `xt version --check-updates` (`npm outdated -g` fallback) for `xtrm-tools`, `@jaggerxtrm/xtmux`, and `@jaggerxtrm/specialists`.

## Session start (targeted — no bulk context dump)

1. Read repo identity + non-negotiable rules at the top of the root agent guide first.
2. For service/docs/project context: check Service Knowledge state (`service-knowledge status`, `service-knowledge index stats`; rebuild when stale/absent), then retrieve with targeted queries (`service-knowledge index query "<3-5 task terms>" --bundle`, `--paths <file>`, or `--service-id <id>`). Read only the cited service SKILL/evidence. Skip when the repo has no service registry.
3. For executable work: use targeted Beads lookup (`bd list --status=in_progress`, `bd ready`, `bd search "<task terms>"`, `bd show <id>`; `bv --robot-triage --format toon` only when graph-aware prioritization is needed), then `bd update <id> --claim` before edits. Use `bd memories <topic>` / `bd recall <key>` only when history is relevant.
4. Catch up on recent work: check handoff/next-session beads, latest `xt report` handoffs, and recent merged/closed PRs.
5. If board state is unclear, run `/issue-triage` or the robot triage/plan commands before editing.
6. If the runtime supports local task planning, use it before non-trivial work and keep it synchronized with the active bead.

## Operating rules

- Beads is authoritative for ownership, dependencies, memory gates, and closure.
- Runtime-local task plans are ephemeral execution tracking only; they do not replace beads.
- Close beads and satisfy memory ack before commit: `bd remember` when useful, then `bd kv set memory-acked:<id> saved:<key>` or `nothing novel:<reason>`, then `bd close <id> --reason="..."`.
- Ask before destructive, irreversible, production-impacting, or history-rewriting actions.
- Do not ask repetitive “Proceed?” confirmations for normal implementation once scope is clear.
- For reply-required xtmux messages, preserve `messageKey` and use a correlated reply (`message-reply` or successful `safe-send-pointer --reply-to`); ack and target-only sends do not fulfil the request.

## XTMUX COMMUNICATION INVARIANTS
- Coordination mutations are standalone `--json` commands.
- FYI/status/PASS use `--expects-reply=false`.
- Decision/blocker requests preserve `messageKey` and require a fresh requester-owned monitor.
- Read exact inbound content with `message-get`; ack only according to the declared receipt contract.
- Fulfil through `message-reply` or successful correlated safe-send.
- Use `agent-last` for a completed interactive turn.
- Use `sp result` / `sp resume` for managed Specialist jobs.
- Pane capture is live-state diagnosis only.
- Before waiting or closing, inspect inbox, obligations, and monitors.

## Code restraint (when implementing directly)

- YAGNI first. Lazy solution that actually works: reuse existing → stdlib → native → one line → minimum. Prefer deletion. No unrequested abstractions. Match existing project conventions; never invent a new style mid-file.
- Never simplify away: input validation at trust boundaries, error handling preventing data loss, security, accessibility, explicitly requested behavior. Never lazy about understanding the problem.
- Mark deliberate shortcuts `// SIMPLIFIED: <ceiling>. upgrade when <trigger>.` Unmarked shortcuts silently rot.

## Essential command surface

Use these as the minimal operational surface; use `--help` for full syntax.

- `bd ready`, `bd list --status=in_progress`, `bd show <id>` — inspect work (`bd prime` is opt-in full-context diagnostic only)
- `bd update <id> --claim`, `bd remember "<insight>"`, `bd close <id> --reason="..."`
- `bd set-state <id> <dim>=<val> --reason="..."`, `bd state <id> <dim>` — operational state labels (e.g. `contract=ready`, `patrol=muted`, `health=healthy`)
- `bd ready --claim` — atomic claim-on-ready; `bd ready --explain` — why an issue is ready/blocked
- `bd create --graph <plan.json> --dry-run` — issue-graph decomposition; `--waits-for <id> --waits-for-gate all-children|any-children` for fan-in/out; `--spec-id`/`--skills` to link specs/required skills
- `bv --robot-triage --format toon`, `bv --robot-next` — never bare `bv`
- `xt report list` / latest report file, `xt update --apply`, `xt end`
- `xt worktree --help` — PR/branch/restart audit primitives (`audit-prs`, `branch-gc`, `restart-audit`); pair with specialists `doctor --pr-drift` / `doctor --reap-dead-jobs`. Details: `/using-xtrm`.
- `gh pr list --state merged --limit 5` or equivalent host CLI when PR context matters
- `sp --help`, `sp list` / `specialists list`, `sp ps`, `sp feed <job-id>`, `sp result <job-id>`

## Skill routing

| Need | Use |
|---|---|
| xtrm/beads workflow | `/using-xtrm`; `bd --help`; `xt --help` |
| Specialist orchestration | **WHEN:** work is substantial enough to delegate (implementation, review, debug, test, or merge chains); use latest `/using-specialists-*`, prefer `/using-specialists`; check `sp --help` + `sp list` first |
| Multi-pane coordination | **WHEN:** coordinating ≥2 tmux sessions or dispatching to a delegated pane; use `/multiplexing`; delegated panes use `/multiplexing-team` |
| xtmux CLI (messaging, handoff, agent-state) | `xtmux --help`, `xtmux <cmd> --help` first |
| Service/docs/project context | Service Knowledge skill set: `/scope`, `/using-service-knowledge` (legacy `/using-service-skills` alias) |
| Planning/tests/docs | `/planning`, `/test-planning`, `/sync-docs` |
| Board unclear/backlog messy | `/issue-triage`; `bv --robot-triage --format toon`; `bv --robot-plan` |
| Release/session close | `/releasing`, `/xt-end`, `/session-close-report`, `/xt-merge` |

## Trigger patterns

| When | Do |
|---|---|
| user prompt has `?` | `bd memories <keywords>` before answering |
| unfamiliar area of code | `gitnexus_query({query: "concept"})` before opening files |
| about to edit a symbol | `gitnexus_impact({target, direction:"upstream"})` |
| before `git commit` | `gitnexus_detect_changes({scope:"staged"})` |
| about to `bd create` for a specialist dispatch | pass `--parent <bead-it-services>` + title `<role>: <task>` |
| about to `sp run` | check `bd state <id> contract`; promote `draft` → `ready` first |
| just capturing an idea, not working it | `bd create --labels contract:draft` with real PROBLEM + rough SCOPE |
| tmux/xtmux coordination or reply-required msg | `/multiplexing`; preserve returned `messageKey`; use `message-reply --in-reply-to` |
| reading code | `get_symbols_overview` → `find_symbol` (never whole files) |
| memory is wrong / superseded | `bd forget <key>` — beats leaving stale entries to poison future `bd memories` searches |
| stale session claim blocking commit gate | `bd kv clear "claimed:<pid>"` (note: `bd kv clear`, NOT `bd kv delete`) |
| session end | memory gate fires — evaluate `bd remember` per closed issue; ack with `bd kv set "memory-acked:<id>" "saved:<key>"` or `"nothing novel:<reason>"` |

## Rule conflict — TaskCreate / TodoWrite

`bd prime` (auto-injected at SessionStart) says *"Prohibited: Do NOT use TodoWrite, TaskCreate, or markdown files for task tracking"*. **This project overrides that line.** Runtime-local task planning (TaskCreate / TodoWrite-style features when the runtime provides them) is used *alongside* beads for non-trivial work — beads remains authoritative for ownership, dependencies, memory gates, and closure; local task plans are ephemeral execution tracking scoped to the active bead. Do not create MEMORY.md files (the bd prime rule against those still holds).

## Project intelligence — on demand (xtrm-x12p3)

xtrm-loader no longer embeds project bodies in every request. Read them when the task needs them:

- Architecture / roadmap: first of `architecture/project_roadmap.md`, `ROADMAP.md`, `architecture/index.md`.
- Project rules: `.claude/rules/**/*.md`.
- Project skills catalog: the runtime's native skill discovery; force-load a skill's body at turn 1 when the runtime supports it.
- Durable cross-session knowledge: `bd memories <topic>` / `bd recall <key>` / `bd remember "<insight>"`.
- Service/project evidence (service-hosting repos): `service-knowledge index query "<3-5 task terms>" --bundle` after checking `service-knowledge status` / `index stats`; read only cited evidence.
- Full workflow examples + prompt-shaping guidance: `/using-xtrm` on demand (no longer eager-injected on Pi).
- Auto-injected essential (small): shared bd memory doctrine (`.xtrm/config/instructions/memory-doctrine.md`) — `bd memories` retrieval leads; live code/state wins.

## Code intelligence and edits

- Before editing an existing function/class/method, run GitNexus impact analysis when GitNexus is available.
- Warn before proceeding if impact risk is HIGH or CRITICAL.
- For unfamiliar code, inspect execution flows before broad grep-heavy reads.
- Before commit or handoff, verify affected scope.
- Prefer targeted symbol/file reads and precise edits over whole-tree dumps.

## Context and output management

- Keep command/file output compact: summarize or index large outputs instead of dumping them into the conversation.
- Use normal read/edit tools only when exact file text is needed for a patch.

## Quality gates

- Run targeted tests/build/typecheck relevant to changed files.
- Fix quality failures before commit.

## Worktree sessions

- `xt` in a sandboxed worktree uses the same flags across runtimes; see `/using-xtrm` for the runtime-specific launch shape.
- `xt end` — close session: commit / push / PR / cleanup when appropriate.
<!-- contract:end -->

## Runtime notes (Pi / runtime-neutral)

- Project skills catalog: Pi's native `<available_skills>` metadata; force-load a skill's body at turn 1 via `/skill:<name>`.
- Full workflow examples + prompt-shaping guidance: `/skill:using-xtrm` (on demand — no longer eager-injected on Pi).
- Use background process tooling for long-running servers, watchers, and log tails instead of shell backgrounding.
- Worktree launch: `xt pi` — launch Pi in a sandboxed worktree; `xt pi --role <specialist>` for an interactive specialist session (e.g. `chain-coordinator`, `pr-reviewer`, `sre-triage`). Coordination and escalation live in `/multiplexing` Pattern 7 and `/using-specialists`.
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
