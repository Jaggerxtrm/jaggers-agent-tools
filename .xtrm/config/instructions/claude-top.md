# XTRM Agent Workflow

> Full reference: `/using-xtrm` skill (or `XTRM-GUIDE.md` where present).
> This is a compact managed block. Use CLI `--help` and skills for details; do not paste full manuals here.
> Shared canonical contract (`.xtrm/config/instructions/agent-contract.md`); the sections between the contract markers are byte-identical in both tops. Only the trailing Runtime notes differ.

<!-- contract:start -->

## Canonical Sources
- CLI `--help` is canonical for syntax; skills own **when**. Managed blocks are routers, not manuals.
- Managed blocks and installed skills update via `xt update --apply`; check versions with `xt version --check-updates`.

## Session start (targeted — no bulk context dump)

1. Read repo identity + non-negotiables at the top of the root agent guide first.
2. Service/docs/project context: check `service-knowledge status` / `index stats` (rebuild when stale/absent), then `service-knowledge index query "<3-5 task terms>" --bundle`; read only the cited evidence. Skip repos without a service registry.
3. Executable work: targeted Beads lookup (`bd ready`, `bd list --status=in_progress`, `bd search "<terms>"`, `bd show <id>`), then `bd update <id> --claim` before edits. `bd memories <topic>` / `bd recall <key>` only when history is relevant.
4. Catch up: handoff/next-session beads, latest `xt report` handoffs, recent merged/closed PRs; `/issue-triage` if the board is unclear.
5. If the runtime supports local task planning, use it for non-trivial work, synchronized with the active bead.

## Operating rules

- Beads is authoritative for ownership, dependencies, memory gates, and closure; runtime-local task plans are ephemeral execution tracking.
- Memory gate at close: `bd remember` when useful, then `bd kv set memory-acked:<id> saved:<key>` or `nothing novel:<reason>`, then `bd close <id> --reason="..."`.
- Before editing existing symbols run GitNexus impact (`gitnexus_impact`) when available; before commit, run `gitnexus_detect_changes`.
- Ask before destructive, irreversible, production-impacting, or history-rewriting actions; skip repetitive "Proceed?" confirmations once scope is clear.
- Run targeted tests/build/typecheck for changed files; fix quality failures before commit.

## Skill routing (on demand)

- Full workflow + command surface: `/using-xtrm`; syntax per CLI: `bd --help`, `bv --robot-triage --format toon`, `xt --help`, `xtmux --help`, `sp --help`.
- Delegation: `/using-specialists`; multi-pane coordination: `/multiplexing`; service context: `/scope`, `/using-service-knowledge`.
- Planning/tests/board: `/planning`, `/test-planning`, `/issue-triage`; release/close: `/xt-end`, `/xt-merge`.

## Rule conflict — TaskCreate / TodoWrite

If a `bd prime` full-context run (opt-in diagnostic) reports *"Prohibited: Do NOT use TodoWrite, TaskCreate, or markdown files for task tracking"*, **this project overrides that line.** Runtime-local task planning coexists with beads — beads is the durable authority; local plans are ephemeral execution tracking. Do not create MEMORY.md files.

<!-- contract:end -->

## Runtime notes (Claude Code)

- Project skills catalog: Claude's native skill discovery (`~/.claude/skills/`); force-load a skill's body at turn 1 via `/skill-<name>`.
- Full workflow examples + prompt-shaping guidance: `/using-xtrm` on demand for both runtimes.
- Hook/skill work: `/hook-development`, `/skill-creator`.
- Worktree launch: `xt claude` — launch Claude Code in a sandboxed worktree; `xt claude --role <specialist>` for an interactive specialist session (e.g. `chain-coordinator`, `pr-reviewer`, `sre-triage`). Coordination and escalation live in `/multiplexing` Pattern 7 and `/using-specialists`.
- Claude Code notes: use GitNexus before changing existing symbols; prefer targeted reads over full-file dumps. Mandatory GitNexus calls: `gitnexus_impact(...)` before symbol edits, `gitnexus_detect_changes()` before commit.
