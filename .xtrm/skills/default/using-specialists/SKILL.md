---
name: using-specialists
description: >
  Canonical specialist orchestration skill. Use proactively for substantial work
  that should be delegated, tracked, reviewed, fixed, tested, or merged through
  specialists: code review, debugging, implementation, planning, doc sync,
  security checks, multi-step chains, integration-phase reconciliation,
  debugger-restitch on conflicting chains, pre-dispatch conflict-cluster
  mapping, test-failure-map epics, and questions about specialist workflow.
version: 3.9
---

# Using Specialists

You are the orchestrator. Turn user intent into a strong bead contract, choose the right specialist from live registry, launch chain, monitor, consume results, drive fixes, publish through specialist merge path.

This root is a **router**. Phase-specific policy lives in on-demand references — read one when you reach its phase, not before.

> **MANDATORY on skill load and before every new substantial task or epic:** `specialists list --full`, plus `sp --help` / `xt --help` / `xtmux --help` (and the relevant `<cmd> <sub> --help`) whenever exact command/flag surface matters. Registry + CLI `--help` are the source of truth for shape; this skill covers policy and gating. Do not rely on remembered roles, models, or permissions.

## Authority boundary

- **Own**: bead contract quality, specialist selection, chain sequencing, fix-loop iteration, review-gate enforcement, merge via manual git.
- **Do not own**: code edits (specialists only, rule #13), destructive git ops (rule #10), `sp merge` / `sp epic merge` (rule #9 — known broken).

## Routing — read the reference for the phase you are in

| You are about to… | Read |
|---|---|
| Write or promote a bead so it is dispatchable | [references/bead-contracts.md](references/bead-contracts.md) |
| Pick a specialist, or run a chain (QA gates, single-chain, epic, review/fix loop) | [references/chain-recipes.md](references/chain-recipes.md) |
| Dispatch a chain that depends on prior chain output | [references/dispatch-preconditions.md](references/dispatch-preconditions.md) |
| Wait on a running job, steer it, rebut it, escalate | [references/monitoring.md](references/monitoring.md) |
| Merge, integrate, restitch, smoke, recover a failed chain | [references/merge-and-integration.md](references/merge-and-integration.md) |
| Find where a specialist lives, or which `sp` / `xt` commands exist | [references/registry-and-locations.md](references/registry-and-locations.md) |

**Typical order for one tracked task:** bead-contracts → chain-recipes (choose + dispatch) → monitoring (wait, consume, fix loop) → merge-and-integration (publish). Epics add dispatch-preconditions before every dependent wave.

## The five gates

1. **Contract gate** — no dispatch against `contract:draft` (rule #15), and no dispatch you cannot defend field-by-field. → [bead-contracts.md](references/bead-contracts.md)
2. **Git State Precondition** — clean tree, HEAD contains prior chain commits, no orphaned worktrees. → [dispatch-preconditions.md](references/dispatch-preconditions.md)
3. **QA + Iron pipeline** — writer → seconder → test-engineer → test-runner → security-auditor (sensitive surfaces) → obligations-scanner → reviewer. Mandatory on production diffs. → [chain-recipes.md](references/chain-recipes.md)
4. **Review gate** — reviewer `PASS` is the only publish gate; `PARTIAL` / `FINDINGS` are mandatory fix loops. → [monitoring.md](references/monitoring.md)
5. **Merge gate** — manual git only (rule #9). → [merge-and-integration.md](references/merge-and-integration.md)

## Non-negotiable rules

1. `--bead` is the prompt for tracked work.
2. Do not dispatch until the bead is a usable task contract.
3. Never `--prompt` to supplement tracked work — update the bead instead.
4. Choose by task shape, not habit. Re-check `specialists list --full` when roles may have changed.
5. Explorer/debugger answer uncertainty before executor writes code.
6. Executor starts only when scope, constraints, and validation are clear.
7. Reviewer uses its own bead and the executor workspace via `--job <exec-job>`.
8. Keep executor/debugger jobs alive through review so they can be resumed.
9. Merge specialist-owned work via manual git (Cherry-Pick Playbook / FF / `git merge --no-ff`). **NEVER** `sp merge` or `sp epic merge` — both known broken; ignore if `sp help` shows them.
10. Specialists must not perform destructive or irreversible operations.
11. Treat tests as evidence: classify failures as in-scope, pre-existing, or infrastructure before starting the fix loop.
12. Drive routine stages autonomously once the task is clear. Escalate only for human judgment, destructive actions, repeated crashes, or reviewer `FAIL`.
13. The orchestrator **NEVER** edits code directly. Conflict resolution goes through debugger/executor; manual conflict resolution always escalates to the operator. (Exception: epics explicitly restructuring the specialists themselves — must say so up-front.)
14. Before dispatching any chain whose work depends on prior chain output, verify Git State Precondition per [references/dispatch-preconditions.md](references/dispatch-preconditions.md). Stale-base dispatch guarantees debugger-restitch loops.
15. Never dispatch a specialist against a bead tagged `contract:draft`. Promote first: explore + rewrite full 7-section contract + `bd set-state <id> contract=ready --reason "..."`.

## Choosing the specialist — quick table

| Need | Specialist |
|---|---|
| Architecture/code mapping | `explorer` (READ_ONLY) |
| Root-cause analysis | `debugger` |
| Planning/decomposition | `planner` |
| Design/tradeoffs | `overthinker` |
| Implementation | `executor` |
| Compliance/code review | `reviewer` |
| Seconder gate (mandatory on production diff) | `seconder` |
| Obligations gate (mandatory on production diff) | `obligations-scanner` |
| Security/dep audit | `security-auditor` (auth/secrets/input/lockfiles/migrations/agent-config) |
| Test execution | `test-runner` |
| Docs audit/sync | `sync-docs` |
| External/live research | `researcher` — **dispatch BEFORE answering any library/API question from training data** |
| Specialist config | `specialists-creator` |
| Release publication | `changelog-keeper` |

Full selection rules and role interactions live in [references/chain-recipes.md](references/chain-recipes.md). `parallel-review` is deprecated — use `overthinker` or a second `reviewer` turn.

## Bead title convention

Every bead dispatched to a specialist gets `<specialist-role>: <concise task>` (e.g. `executor: implement token refresh retry`, `reviewer: verify token refresh retry`). Root task/epic beads that are not themselves dispatched to a single specialist are exempt (`Epic: auth refresh hardening`). Rationale + full rules: [references/bead-contracts.md](references/bead-contracts.md).

## Draft beads (rule #15 promotion gate)

Tag `contract:draft` at creation for captured backlog ideas:

```bash
bd create --title "..." --labels contract:draft --type task --priority 3 \
  --description "PROBLEM: <2+ real sentences>
SCOPE: <rough guess>
SUCCESS: TBD — needs exploration
NON_GOALS: TBD — needs exploration
CONSTRAINTS: TBD — needs exploration
VALIDATION: TBD — needs exploration
OUTPUT: TBD — needs exploration"
```

**No one-liners, ever.** Every section present; every unknown says `TBD — needs exploration` explicitly.

Before dispatch: check `bd state <id> contract`. If `draft` or nothing, stop, explore per [references/bead-contracts.md](references/bead-contracts.md), rewrite in place, then `bd set-state <id> contract=ready --reason "..."`. Hard refuse — not a warning.

## SCRUTINY (chain-property, not quality tier)

Every substantive bead declares `SCRUTINY: none | low | medium | high | critical` at creation. It modulates chain structure only; quality stays invariant. Author sets minimum; dispatcher/reviewer can raise on sensitive surfaces, never lower. Full table + when-to-use: [references/chain-recipes.md](references/chain-recipes.md).

## Escalation quick-check

Escalate to operator on: manual conflict resolution, force push, branch delete, `sp merge` / `sp epic merge` attempted, skipping `seconder` / `security-auditor` on production or sensitive-surface diffs, dispatch on stale base, dispatch against `contract:draft`, `npm publish`, dependency major/minor bump, schema-changing config edit. Full matrix: [references/monitoring.md](references/monitoring.md).

Interactive coordinator escalations go via beaded reply-required `xtmux message-send`; orchestrator preserves the SQLite `messageKey`, `message-ack` acknowledges receipt, `message-reply --in-reply-to` fulfils — or `safe-send-pointer --reply-to` when pane injection is also required.

## Retrieval hierarchy

Prefer durable sources over live scraping:

- `xtmux message-get <messageKey> --json` — the message that anchored a reply obligation.
- `xtmux agent-last <pane_id> --json` — last completed turn on a pane.
- `sp result <job-id> --json` — final specialist output.
- `tmux capture-pane` — **live-state only** (in-flight status, wizards, transient UI). Never as final-result protocol.

## At session end — mandatory handoff

1. Run `/session-close-report`.
2. Fill every `<!-- FILL -->` marker in the skeleton.
3. Sync `CHANGELOG.md` for user-facing changes (the report drives this).
4. Cleanup: `sp ps`, `git worktree list`, `ps -ef` for stale serena/gitnexus, `tmux ls` for `sp-*`.
5. Commit the report (and CHANGELOG) before push.

## When NOT to use this skill

- Memory synthesis → `/documenting`.
- xt-merge wrapper internals → `/xt-merge`.
- Session-close skeleton and CHANGELOG sync → `/session-close-report`.
- Release version bump / tag / npm publish → `/releasing`.
- Multi-pane coordination without specialist chains → `/multiplexing`.
- Small deterministic edits with obvious scope — do them directly, do not fabricate a chain for ceremony.
