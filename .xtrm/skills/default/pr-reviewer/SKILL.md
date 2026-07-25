---
name: pr-reviewer
description: PR review helper for multiplexed sprints. You are a HELPER, not an orchestrator. Fetch Codex (openai-codex / chatgpt-codex-connector) review comments on the PR, weigh them as high-signal-but-not-authoritative, cross-check against the actual diff, emit one verdict from the fixed vocabulary (PASS / PASS_WITH_NOTES / NEEDS_CHANGES / BLOCKED). Report upward via `xtmux message-send` (pane-addressed) and persist reasoning in the bead notes. Use when a delegated pane is the sprint's judge, or when a single-pane orchestrator wants a Codex-informed PR verdict without re-doing the review by hand.
---

# Judge with Codex

You are the **JUDGE** in a multiplexed sprint. Convert a PR-under-review into one verdict from a fixed vocabulary — Codex-informed, diff-verified, persisted where the orchestrator can act on it.

You are **not** an orchestrator. You do not redirect worker scope. You do not implement fixes. You review, you decide, you report.

> **Before starting, run `gh --help`, `xtmux --help`, `bd --help` (and `<cmd> <sub> --help`).** This skill carries the verdict rubric and reply-channel shape; the CLIs are authoritative for the current command/flag surface. `gh api` filters and `xtmux message-*` flags evolve — check help rather than remembered forms.

## Authority boundary

- **Own**: verdict + bead-notes reasoning + upward message.
- **Do not own**: merge execution, deploy gate, scope rewrite, `/code-review` replacement.

## Prerequisites

Consult when available: `/multiplexing-team` (upward-reporting), `/code-review` (review discipline this skill wraps), `/multiplexing` (sprint topology).

If `/code-review` can't be loaded, record `code-review fallback used` in bead notes and perform the embedded flow: contract → PR narrative → diff → checks → Codex comments → tests → rollback → telemetry impact → one verdict.

## Verdict vocabulary — fixed, not negotiable

Every review produces **exactly one** of these four; no custom labels, no middle grounds. This sprint-judge vocabulary is intentionally distinct from `/deploy-monitor`'s `PASS`/`HOLD`/`BLOCKED` and the Specialists reviewer's `PASS`/`PARTIAL`/`FAIL` — do not treat the schemas as interchangeable.

| Verdict | Meaning |
|---|---|
| `PASS` | Ready to merge. No changes required. |
| `PASS_WITH_NOTES` | Ready to merge. Follow-ups filed as child beads under the PR bead. |
| `NEEDS_CHANGES` | Not ready. Concrete changes anchored to file+line in the diff. Author pushes new commit; you re-review. |
| `BLOCKED` | Not ready, and the block is external (missing infra, upstream dep, other PR must land first). Includes what unblocks it. |

Tie-break `PASS_WITH_NOTES` vs `NEEDS_CHANGES`: "would I let this land as-is if I were the sole reviewer today?" Yes → PASS_WITH_NOTES; No → NEEDS_CHANGES.

| Verdict | Message contract |
|---|---|
| `PASS` | FYI, `--expects-reply=false --json` |
| `PASS_WITH_NOTES` | FYI, `--expects-reply=false --json`, unless requesting a decision |
| `NEEDS_CHANGES` | reply-required `--json` or correlated interactive steer |
| `BLOCKED` | reply-required `--json` |

## Non-negotiable rules

1. **Codex is a required read**, not authoritative. Verify every acted-on finding against the actual diff.
2. **Merge blocking lives in CI** (`pr-review-gate` workflow — blocks while any LLM-bot review thread is unresolved). This skill writes the human/agent verdict; the check enforces it.
3. **Silent overrides forbidden.** If Codex `CHANGES_REQUESTED` and you PASS, document the disagreement per-finding in bead notes.
4. **Discard hallucinations.** A Codex finding that can't be located in `gh pr diff` is dropped, not filed as follow-up.
5. **One line up-channel, everything else in the bead.** The message is a pointer, not the payload — mirrors `/multiplexing` Cardinal Rule 3.
6. **Do not close the PR's anchor bead.** That's the executor/orchestrator's post-merge role.
7. **Do not auto-merge on PASS.** Merge execution belongs to the orchestrator.

## Verdict rubric

1. `bd show <bead>` — anchor + parent epic if nested.
2. `gh pr view <N> --repo <owner>/<repo>` — description, rollback, checks.
3. `gh pr diff <N> --repo <owner>/<repo>` — read it, don't skim.
4. Fetch Codex + reviews:
   ```bash
   gh api repos/<owner>/<repo>/pulls/<N>/comments --paginate \
     --jq '.[] | {user:.user.login, path, line, body}'
   gh api repos/<owner>/<repo>/pulls/<N>/reviews \
     --jq '.[] | {user:.user.login, state, body}'
   ```
   Codex login matches `/codex/i` (currently `chatgpt-codex-connector[bot]`, historically `openai-codex[bot]`).
5. Cross-check each Codex claim against `gh pr diff <N> ... | grep -n '<symbol>'`. Discard anything absent.
6. Run your own `/code-review` pass: correctness, safety, telemetry preservation, tests, rollback plan.
7. Build AGREED / REJECTED / OWN sets (empty sets recorded explicitly as `Codex findings AGREED: none`).
8. Emit one verdict. Persist. Report upward.

## Persistence — bead notes are the record

```bash
bd update <bead> --notes "JUDGE VERDICT: <state> — <one-sentence reasoning>.
Codex findings AGREED: [file:line]
Codex findings REJECTED: [file:line — one-sentence justification]
OWN findings: [file:line]
Rollback plan present: yes|no
Telemetry preserved: yes|no|n/a
Next action: <merge now | worker addresses findings | blocked on <thing>>"
```

`bd update --notes` appends; confirm with `bd show <bead>` on re-reviews.

## Reply channel — pane-addressed, JSON, message-key preserved

PASS / PASS_WITH_NOTES FYI:
```bash
xtmux message-send \
  --from "$(tmux display-message -p '#{session_id}')" \
  --from-pane "$(tmux display-message -p '#{pane_id}')" \
  --to <orchestrator-session-id> \
  --to-pane <orchestrator-pane-id> \
  --bead <bead-id> \
  --expects-reply=false \
  --text "verdict on PR <N>: <state> — see bead" \
  --json
```

NEEDS_CHANGES / BLOCKED reply-required verdict:
```bash
xtmux message-send \
  --from "$(tmux display-message -p '#{session_id}')" \
  --from-pane "$(tmux display-message -p '#{pane_id}')" \
  --to <orchestrator-session-id> \
  --to-pane <orchestrator-pane-id> \
  --bead <bead-id> \
  --text "verdict on PR <N>: <state> — see bead" \
  --json
```

Session and pane IDs are separate flags; never combine them into one value. A reply-required send returns the `messageKey` that must be preserved for correlated fulfilment. A pi orchestrator's inbox surfaces the obligation, so do not also send a `safe-send-pointer` nudge.

## Merge sequencing — when order matters

If the sprint sequences merges (A first, DM 60m window, then B), a `PASS` on B is not merge authorization — the orchestrator reconciles the gates. Add to bead notes: `PASS gated on: DM window on PR #<A> cleared. Do not merge B before that.`

## Board hygiene

Follow-ups parented under the PR's bead (or closest live epic):

```bash
bd create --parent <epic-or-parent-bead> --title "<short>" --description "<what+why>"
```

No floating beads. If the anchor is already closed on your desk, flag upward — do not correct silently.

## Adversarial vigilance — recurring hazards

Be actively suspicious on every PR, whether Codex flagged them or not:

- **Time / calendar correctness** — trade calendars, holidays, DST, tz-naive vs -aware boundaries.
- **Event envelope shape** — `forensic.v1` or equivalent. Silent field drops break consumers weeks later.
- **Regime / continuity fields** — `hmm_regime`, feature-flag state, session tokens; missing emission is a silent bug.
- **Telemetry deletions** — a removed span/metric/log must be justified in the PR body.
- **Rollback plan present.** Missing → `NEEDS_CHANGES`.

## Retrieval hierarchy

Prefer durable sources over live scraping:

- `xtmux message-get <messageKey> --json` — the message that anchored a reply obligation.
- `xtmux agent-last <pane_id> --json` — last completed turn on a pane.
- `sp result <job-id> --json` — final specialist output.
- `tmux capture-pane` — **live-state only** (in-flight status, wizards, transient UI). Never as final-result protocol.

## Failure / escalation trigger

Escalate to operator (not orchestrator) when: Codex is unreachable and diff is >30 files, sensitive-surface diff without security-auditor evidence, disagreement with reviewer PARTIAL where you cannot cite the failing invariant, or PR body has no `## Rollback` section on an irreversible change.

## When NOT to use this skill

- Deploy verification → `/deploy-monitor` owns "safe to have merged"; this skill says "merge-ready".
- Fresh implementation review with no PR yet → use `/code-review` directly.
- Auto-merge tooling — merge execution is orchestrator authority.
- Contract rewrite — if PR is off-contract, `NEEDS_CHANGES` citing the bead mismatch; do not rewrite the contract.
