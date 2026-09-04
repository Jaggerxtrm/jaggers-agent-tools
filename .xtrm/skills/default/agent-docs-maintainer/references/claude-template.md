# CLAUDE.md compact template

```md
# <Project> — Claude Code Guide

## Project summary / Stack overview
<2-5 lines: what this repo is, main runtime/language/package, current architecture in plain terms.>

If a short summary is not enough for a fresh agent to understand the repo, add a Stack Overview before managed blocks. Use `references/stack-overview-template.md` for role, what runs here, public surface, sibling stacks, operational entry points, data flow, and what is not in this repo.

## Non-negotiable rules
- Claim a bead before edits: `bd update <id> --claim`.
- Before proceeding on non-trivial/multi-step work, use Claude Code task planning features (TaskCreate/TodoWrite-style when available) alongside normal bead operations; beads remains authoritative for ownership/closure.
- At session start, check handoff beads/recent reports/closed PRs and `bd list --status=in_progress`; run `/issue-triage` if board state is unclear.
- For specialist work, check `sp --help` and `sp list` / `specialists list` before choosing a role.
- Before editing existing functions/classes/methods, run GitNexus impact analysis.
- Close the bead and satisfy the memory gate before committing.
- Run targeted quality gates after edits.
- Do not edit generated files directly; update the source and regenerate.

## Skill routing
| Need | Load/use |
|---|---|
| xtrm workflow / beads gates | `/using-xtrm`; CLI details: `bd --help`, `xt --help` |
| Specialist orchestration | latest `/using-specialists-*`, prefer `/using-specialists` |
| GitNexus impact/debug/refactor | `/gitnexus-impact-analysis`, `/gitnexus-debugging`, `/gitnexus-refactoring` |
| Service routing and docs/project context | `/scope`, `/using-service-knowledge` when Service Knowledge is installed |
| Release/session close | `/releasing`, `/xt-end`, `/session-close-report` |
## Project map
- `<path>` — <purpose>
- `<path>` — <purpose>
- `<path>` — <purpose>

## Service Knowledge (service-hosting repos)
- Check state first: `service-knowledge status`, `service-knowledge index stats` (rebuild when stale/absent).
- Retrieve: `service-knowledge index query "<3-5 task terms>" --bundle` (or `--paths <file>`, `--service-id <id>`); read only cited evidence.
## Project map
- `<path>` — <purpose>
- `<path>` — <purpose>
- `<path>` — <purpose>

## Claude Code notes
- Route service/project context through Service Knowledge (`service-knowledge index query "<terms>" --bundle` after checking status/stats); treat stale/absent index explicitly and rebuild before relying on ranked evidence.
- Use GitNexus before changing existing symbols.
- Prefer targeted reads over full-file dumps.

## Essential commands
Keep a tiny command surface, not a full manual:
- `bd ready`, `bd list --status=in_progress`, `bd show <id>` — inspect work.
- `bd update <id> --claim` and `bd close <id> --reason="..."` — lifecycle.
- `sp list`, `sp ps`, `sp feed <job-id>`, `sp result <job-id>` — specialist basics when relevant.
- `gitnexus_impact(...)` before symbol edits; `gitnexus_detect_changes(...)` before commit.
- `<project test command>` and `<project build command>` — validation.

For full syntax, use each CLI's `--help`.

## Current gotchas
- <current gotcha, max 1-2 lines>
- <current gotcha, max 1-2 lines>

## References
- `README.md` — user-facing overview.
- `<docs path>` — detailed architecture/runbook.
```

Keep this template under 300 lines unless the project has a documented exception.
