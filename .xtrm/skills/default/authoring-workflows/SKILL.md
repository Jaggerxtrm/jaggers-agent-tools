---
name: authoring-workflows
description: >
  Author dynamic multi-agent workflows (the Workflow tool) that inherit specialist
  semantics without inheriting a fixed chain. Use when work needs fan-out over a
  discovered work-list, a set-computation barrier, adversarial self-correction, or
  gates whose membership is computed rather than prescribed. Covers topology
  derivation, the gate function, shape vocabulary, the upward escalation arc, and
  the harness failure modes that cost real time to rediscover. Complements
  /using-specialists (which owns sp orchestration doctrine); does not replace it.
disable-model-invocation: true
---

# Authoring dynamic workflows

`/using-specialists` owns the doctrine: gates, verdicts, bead contracts, escalation.
Read it first and do not re-derive it here. This skill owns one thing it explicitly
disclaims — *"spawn primitives"* and *"tool-specific harness bindings"* — i.e. how to
write a `Workflow` script that carries that doctrine faithfully.

## The core principle

**Gates are deterministic. Topology is dynamic.**

`sp` fixes both, because it is a job dispatcher: one bead, one chain, linear. The fixed
*gates* are a safety property and must survive. The fixed *topology* is an artifact of
the dispatcher, not a design decision — and it is the part a workflow should compute.

| Keep deterministic | Make dynamic |
|---|---|
| which gates fire | how work is decomposed |
| verdict vocabularies | what runs in parallel |
| evidence standards | where the barriers sit |
| who may overrule whom | how many iterations |
| the escalation arc | which dialectic applies |

A skill that hands you a canonical script has re-implemented `sp` in JavaScript, worse —
without keep-alive, resume, job lineage, or per-role models. If your workflow is one
bead through one fixed chain, **use `sp`**. Workflow earns its place only when the shape
is not knowable in advance.

## Choose the harness honestly

| Use `sp` when | Use `Workflow` when |
|---|---|
| one bead, one chain | fan-out over a discovered work-list |
| a fix loop may span turns/days (keep-alive, resume) | a stage needs a computation over the *whole set* |
| the reviewer should inspect the writer's tool-call timeline (`sp feed`) | gate membership is arithmetic, not a checklist |
| per-role model routing matters | you need a dialectic, not a pipeline |
| the work is genuinely linear | wall-clock matters and stages are independent |

Hybrid is normal: scout inline, `sp` the long-lived chains, `Workflow` the fan-outs.

## Derive the topology; do not pick one

Ask four questions of the work, in order. The answers *are* the script.

1. **Is the work-list known?** No → a discovery pass comes first, and its output is the
   fan-out input. Do not guess the list; you will guess it wrong and the whole run
   inherits the error.
2. **Do items interact?** Compute the overlap surface (files, tables, config, metric
   names) *before* any writer exists. Overlapping items are `MUST_SEQUENCE` or
   `MUST_CONSOLIDATE`, never parallel. This is the primary anti-regression artifact —
   two writers on one file is a merge problem you author into existence.
3. **Does any stage need the whole set?** Only then a barrier. "I need to flatten/filter
   first" is not a set-computation — do it inside a pipeline stage. Real ones: dedup
   across all findings, an overlap matrix, early-exit on zero, "compare against the
   others".
4. **Is the answer contested?** If a wrong answer is expensive and the evidence is
   arguable, use a dialectic (below), not a single pass.

Default to `pipeline`. A barrier costs you the difference between the slowest item and
the slowest stage, on every stage.

## The gate function

Gate membership is computed from properties of the work, not chosen per run:

```
gates(diff, scrutiny) =
  seconder                  always on a production diff
  test-engineer, test-runner always on a production diff
  obligations-scanner        always on a production diff; CLEAN required at critical
  security-auditor           iff diff touches auth | secrets | input handling |
                             lockfiles | migrations | agent/hook/MCP config
  second opinion             iff scrutiny == critical, and it may BLOCK
scrutiny = max(author_declared, critic_verdict, canon_floor(paths))
```

The floor only ever raises. Compute it in code so it cannot drift with your mood, and
skip `security-auditor` when the surface genuinely doesn't warrant it — running it as
ceremony teaches everyone to ignore it.

## Shape vocabulary

Not templates. Compose them.

- **Fan-out + pipeline** — N independent units, each through the same stages, no barrier.
  Item A reaches stage 3 while item B is still in stage 1.
- **Barrier for set-computation** — one stage that genuinely needs every prior result.
  Justify it in a comment or don't use it.
- **Dialectic** — `probe → adversarial challenge → binding ruling`, where the *same role*
  plays all three stances and the final turn holds both prior outputs. Use when the
  answer is contested and the cost of being wrong is high. This produces self-correction
  a single pass cannot: the ruling turn will withdraw its own earlier claims, which is
  exactly the point.
- **Loop-until-dry** — for unknown-size discovery, keep going until K rounds surface
  nothing new. Dedup against *everything seen*, not against what survived judging, or it
  never converges.
- **Fix loop** — `writer → gate → (fail? writer-with-findings → gate)`. Bound it. Two
  rounds, then escalate; a third round means the contract is wrong, not the writer.

## Inherit semantics, adapt mechanism

Read the **actual specialist definitions** before authoring — `specialists list --full`
for the live registry, then the `.specialist.json` prompt bodies and the mandatory rules.
Not the skill's summaries of them; they drift, and the registry is the source of truth.

Inherit verbatim: verdict vocabularies (`PASS/PARTIAL/FAIL`, the seconder's dual verdict,
`CLEAN/OBLIGATIONS_FOUND/BLOCKED`), the SCRUTINY tier table and its escalation floors,
evidence discipline, role boundaries (READ_ONLY means READ_ONLY).

Adapt where the harness differs, deliberately and in writing. The load-bearing example:
the reviewer prompt says *"`sp result` is opinion; `sp feed` is record."* A workflow has
no feed. The adaptation is **not** to drop the rule — it is to invert it upward:

> Trust nothing in the writer's self-report you have not confirmed against the diff and
> the live files. The report is opinion; the tree is truth.

That is stricter than the original, and it is the single highest-value line in any
workflow prompt written this way. Writer self-reports contradicted the tree in **every**
chain where it was checked.

## Give the chain an upward arc

A pipeline flows downward, so its only expression for "something is wrong" is *route back
to the writer*. That is wrong more often than it looks: a contract whose SUCCESS clause is
reachable only by violating its own NON_GOALS cannot be satisfied by any writer, and
retrying one is how you get a compliant writer shipping a dangerous change.

Give the first gate a verdict that routes to **you**:

```
scope_verdict: PASS | FAIL | UNCLEAR | CONTRACT_DEFECT
```

`CONTRACT_DEFECT` means: the diff cannot satisfy this contract because the contract
contradicts itself. Never route it to the writer. Amend the contract, then resume.

Symmetrically, at `critical` the terminal gate must not be sole authority. A reviewer can
score a central criterion "met" when it is not; an independent second opinion with an
adversarial mandate is what catches it. Let it block.

## Budget the adversary, not the writer

The naive allocation spends on the writer and cheap-checks afterward. Invert it. In a
dynamic workflow you allocate rather than pay per-role-per-bead, so buy more adversary:
a second opinion with a distinct lens, a reviewer instructed to *falsify by experiment*
rather than read the diff, a challenge turn whose only job is to break the prior turn.

Two prompts worth carrying verbatim:

- **Test theatre gate** — "for each test, state which defect it would have caught, and
  confirm it FAILS against pre-fix behaviour. A test that passes for a reason unrelated
  to its claimed defect is theatre and is a PARTIAL." Coverage that would not have caught
  the bug is the most common defect in generated tests.
- **Failure-mode inversion** — "does this trade a silent wrong value for a silent absence,
  silent loss for a silent halt, or a wrong value that *moves* for one *frozen*? A fix
  whose new failure path has no counter, log, or alertable signal is a REGRESSION
  regardless of test results." No standard gate covers this and it is where the
  expensive mistakes live.

## Harness failure modes

Each of these cost real time. They are not hypothetical.

- **Guard the filesystem you actually write to.** `df -h /` measures the root device and
  will report tens of gigabytes free while the scratchpad you are writing to is at 95%.
  Session scratchpads under `/tmp` are frequently **tmpfs — RAM**. On a host also running
  databases, a few build trees there is an OOM incident. Check `df -h "$TARGET"` *and*
  `df -h /tmp` plus `free -h`.
- **Pin build output to disk.** Set `CARGO_TARGET_DIR` (and equivalents) inside the
  worktree. Reuse one tree; do not create one per experiment.
- **Never compile inside a container for a host task.** `docker run <toolchain>` produces
  root-owned artifacts the agent cannot reclaim, and you will need operator sudo.
- **`git diff master...HEAD` lies on an uncommitted branch** and lies harder when local
  `master` is stale. Agents will scan it and return a *vacuous* CLEAN. Tell them to scan
  the working tree: `git status --short` plus `git diff` plus untracked files.
- **Forbidding commits strands the work.** If agents may not commit (correct — the
  orchestrator owns git), the deliverable sits uncommitted with untracked new files, one
  `git clean -fd` from gone. Decide who commits and when, and note that a bead-claim
  commit gate may block you until the chain closes.
- **One worktree per chain, created by you**, and pass its path to every stage. Per-agent
  isolation breaks a chain that must operate on one tree.
- **Name the out-of-scope owners in the prompt.** "`watcher.rs` is owned by bead X this
  cycle" prevents a writer helpfully fixing a neighbouring file and colliding with a
  parallel lane.

## What does not belong in a workflow

Merges and pushes (the orchestrator owns git). Destructive or irreversible operations.
Deploys and container recreates. Bead mutation — agents read `bd show`, they do not
`bd create/update/close`. Anything requiring operator authorisation. If a stage would do
one of these, it produces a *recommendation* and you act on it.

## Before you dispatch

- `specialists list --full` — the registry is authoritative and drifts between sessions.
- Contract gate: every target bead is `contract=ready`, and you can defend each field.
- Overlap matrix computed; no two parallel items share a file.
- Gate function evaluated; you can say why each gate is in or out.
- Every prompt states: working directory, scope allowlist, forbidden operations, the
  host guard, evidence discipline, and the reporting-accuracy requirement.
- Sequence the resource-heavy lane alone. Compilation lanes do not run three-up.
