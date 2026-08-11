---
name: spec-dispatch
description: >
  Turn a spec, PRD, or vague ambition into a runnable bd issue board with sprints,
  fan-out, cross-repo gates, and specialist orchestration — without over-engineering
  the plan itself. Ponytail-first: the plan is only as big as it has to be. Use when
  the user says "plan this", "spec-dispatch", "prd-to-plan", pastes a PRD/roadmap, links a design
  doc, or when a new audit/report/spec lands and needs decomposition across one or
  more xtrm repos. Also use when a task spans ≥2 repos, ≥3 sprints, or would benefit
  from parallel lanes but the user hasn't yet decided the shape.
priority: normal
disable-model-invocation: true
---

# /spec-dispatch — spec → runnable board

You just got a PRD, plan, audit report, roadmap, or vague ambition. Turn it into a bd board that a coordinator + 3 panes can execute — without invalidating ponytail by writing a giant plan document.

## When this fires

- `/spec-dispatch` — user typed it explicitly
- User pastes a spec / PRD / audit report / design doc
- User says "plan this", "break this down", "how do we ship this", "let's plan the X epic"
- New markdown at `docs/design/*.md` or `docs/plans/*.md` lands and user wants it decomposed
- A task obviously spans ≥2 xtrm repos (`core`, `xtmux`, `specialists`) or ≥3 sprints

## Workflow

Follow in order. Skip steps only when the input clearly doesn't require them.

### 1. Ground the input

- If user pasted inline, use it as-is
- If user gave a path, read only what you need — for docs >1000 lines use `ctx_execute_file` to extract headings + work-package IDs; don't dump bytes into context
- If the doc is unclear or contradicts recent PRs, ask **one** clarifying question before scoping (never two)

### 2. Recent-work ack (mandatory)

Before scoping anything, orient to what shipped recently in each affected repo:

```bash
gh pr list --state=merged --limit 15
git log --oneline -20
```

Note if a recent PR already did what the spec is asking. If yes → STOP and surface to user before continuing.

### 3. Understand complexity & scope

Split the input into:

- **Audit-closure vs new-feature** (Track A vs Track B) — never mix in one epic; user's earlier firewall preferences apply
- **Per-repo lanes** — which of `~/dev/core`, `~/dev/xtmux`, `~/dev/specialists` (or wherever) is touched
- **Cross-repo release gates** — any change that requires atomic multi-repo release?
- **Work-package IDs** — if the spec already has them (MSG-01, PACKAGE-A, etc.), respect them

### 4. Adversarial pre-plan audit (only for large/multi-repo)

If the plan spans ≥2 repos or has ≥10 work packages: spawn 2–3 `general-purpose` audit helpers **before** creating any beads. One per repo. Each answers, per claim:

- **still-current?** — is the claim true against HEAD, or has a recent PR fixed it?
- **implementable-as-described?** — are the proposed files/seams correct? missing coupling?
- **ponytail-verdict** — accept / simplify-how / cut. Reject new abstractions with one caller, per-caller patches when a shared guard works, "quarantine" over "delete", daemons where a periodic reconciler exists, prose complexity dressed as design

Prefer sequential dispatch (one helper at a time) unless user opts into parallel — helper reports are the base for the fan-out plan.

### 5. Decide fan-out & sprint subdivision

Write a compact epic-head at `docs/design/<slug>-epic-plan.md`:

- Track split (if applicable)
- Audit-informed deltas (helpers override the spec)
- Sprints with per-lane task lists
- Fan-out helpers per sprint (coordinator + panes + specialists)
- Cross-repo release gates
- DoD per sprint

Keep it under ~300 lines. Anything longer = ceremony creeping back.

### 6. Materialize bd board

Via `/planning` skill or direct `bd create` script:

- One umbrella epic; one child epic per sprint; tasks under sprint epics
- Group by "would-ship-together" PR boundary — 1 bead per PR, not 1 bead per file
- Fill 7-section contract (PROBLEM / SUCCESS / SCOPE / NON_GOALS / CONSTRAINTS / VALIDATION / OUTPUT) — see /planning
- Wire deps: `blocks` only for hard sequencing; `validates` / `discovered-from` / `caused-by` otherwise
- Cross-repo gates → `bd dep add <A> <B> --type blocks` between concrete task beads
- Placeholder epics for deferred programs (child of umbrella, no grandchildren)

Batch-create via a scratchpad script using `bd create --silent --stdin` — single tool call, one long script, IDs captured to `/tmp/bd-created/ids.txt`.

### 7. Cross-cutting rules

Append to the umbrella epic:

- **Help-surface parity** — CLI code changes ship with `--help` update in same PR
- **Skill drift** — any changed CLI flag with a corresponding `.xtrm/skills/default/**/SKILL.md` mention: update or file follow-up
- **Bead assignee auto-populate** — when `xt pi/claude --bead <id>` is used

Append explicit help-surface / assignee checkboxes to individual beads only when they concretely touch that surface.

### 8. Handoff

- Show board tree (`bd list --parent <umbrella>`)
- Show first claimable (`bd ready --limit 3`)
- Report specialist load per sprint (count of dispatches, not tasks)
- Note anything uncommitted (epic-head doc, source PRD) so user commits before starting

## Skill routing (what to load when)

| Situation | Load |
|---|---|
| Structured bd decomposition after this skill drafts the epic-head | `/planning` |
| Companion test/smoke/E2E issues per bead layer | `/test-planning` |
| Coordinator + ≥2 panes for parallel lanes | `/multiplexing` |
| Dispatch executor/reviewer/debugger/test-runner/security-auditor chains | `/using-specialists` |
| Any coding bead — enforce lazy solution | `/ponytail:ponytail` (auto-active if operator has it on) |
| Service/project context before scoping | `/scope` + `/using-service-skills` |
| Stress-test the plan for blind spots | `/premortem` |
| Underspec'd PRD — needs research first | `/deep-research` |
| xtrm workflow / beads gates / hooks | `/using-xtrm` |
| PR flow / session close | `/xt-end`, `/xt-merge`, `/session-close-report` |

Load skills **just before** the phase that needs them, not upfront.

## Optional: Jira mirror

If the operator uses Jira (Atlassian Rovo MCP connector active — `mcp__claude_ai_Atlassian_Rovo__*`), mirror the umbrella epic and sprint epics into Jira for operator-facing durability. bd stays the execution truth (claims, deps, memory-acks, KV state); Jira is the human-scan view.

- One Jira issue per bd epic (umbrella + sprint children). Do NOT mirror leaf tasks unless the operator asks — that's ceremony.
- Link each Jira issue to its bd id in the description; put the bd id in a Jira label (e.g. `bd:xtrm-wiy5n`).
- Dedupe first — `mcp__claude_ai_Atlassian_Rovo__searchJiraIssuesUsingJql` with `labels = "bd:<id>"`.
- On sprint close, `mcp__claude_ai_Atlassian_Rovo__addCommentToJiraIssue` with release PR link + smoke evidence.
- Never sync bead notes / KV / memory-ack into Jira — those are execution signals with no operator-scan value.

Ponytail: if the operator hasn't asked for Jira mirroring and no Rovo MCP is available, skip the section entirely. Don't create Jira debt.

## Optional: Calendar time-blocking for future work

If work is planned for future dates (release windows, sprint kickoffs, review gates, cross-repo coordination) AND a calendar connector is available (`mcp__claude_ai_Google_Calendar__*` is the reference; other providers similar), time-block the **moments**, not the beads.

Date-anchor candidates (block only these):

- Sprint kickoff once dependencies clear
- Coordinated release window
- Smoke-container review checkpoint
- Cross-repo release gate operator sign-off
- External dependency deadline (e.g. an upstream PRD ships)

Ponytail: never one calendar event per bead. Only date-anchored moments. If the operator hasn't asked and no calendar connector is available, skip.

Example (Google Calendar): `mcp__claude_ai_Google_Calendar__create_event` with title `"Sprint 3c release window — <slug>"`, description linking bd umbrella + release PRs, duration = expected wall-clock (a real block, not a 15-min "for later" placeholder).

## Ponytail rules for this skill

- The plan document is not the deliverable — the runnable board is. Keep the doc small.
- Group beads by PR boundary, not by file. 8 small fixes in one PR = one bead with 8 VALIDATION checkboxes, not 8 beads.
- Cross-repo release gate = one `blocks` edge between the two release beads. No new orchestration layer.
- Adversarial audit is not for every plan. Skip if the input is a straightforward single-repo feature and the operator hasn't asked for it.
- No new bead for tooling meta-work that fits under an existing umbrella claim.
- If the spec is under 30 lines and touches one repo, skip the epic-head doc entirely — go straight to `/planning`.
- Never invent format when a canonical one exists (`xtrm.forensic.v1`, existing `pollTimer`, existing `writeUnifiedHandoff` seam, etc.).
- Ask user question only when it's genuinely a decision they must make (audit fold-in vs new bead, sprint reshape, release-gate strictness). Never ask "should I proceed" after they said "plan this".

## Trigger patterns

| When | Do |
|---|---|
| user pastes PRD / audit / roadmap | ground input → recent-work ack → complexity split |
| doc is >1000 lines | `ctx_execute_file` for headings + work-IDs; don't read all bytes |
| plan spans ≥2 repos or has ≥10 packages | adversarial audit before beads |
| operator says "no new bead for X" | fold X's scope into an existing bead via `bd update --append-notes` |
| bead descriptions balloon past ~80 lines | you're over-planning; cut back |
| a sprint has >15 tasks | consider splitting the sprint or grouping tasks by PR boundary |

## Output pattern

Every phase reports to the user in one of these shapes:

- **Confirmation of grounding** — "Doc is X lines, ~Y is authoritative content, Z is historical" + verified state of affected repos
- **Fan-out proposal** — table of helpers/lanes/repos + one `AskUserQuestion` before spawning
- **Audit deltas** — table: `doc-proposal | helper-verdict | action`
- **Sprint pre-subdivision** — code block with sprint tree + fan-out helpers per sprint
- **Board materialized** — `bd list --parent <umbrella>` + `bd ready --limit 3` + specialist load summary + first claimable

Never wall-of-text between phases. Ask user question only at real decision points.
