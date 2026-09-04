# Causal debugging

Use for bugs, regressions, crashes, unexpected output, failing tests, integration errors,
and performance regressions.

The objective is not to find suspicious code. It is to reconstruct a causal explanation
that connects an observed failure to the change/state that produced it.

## Phase 1 — characterize the failure

Before editing:

1. Read the complete error, stack trace, failing assertion, logs, or wrong output.
2. Reproduce consistently when possible; record exact inputs/environment/version.
3. Establish the first known bad observation and, if possible, a last known good one.
4. Identify the failing boundary: function, process, request, job, service, data flow, or
   deployment.
5. If the problem is intermittent, gather timestamps/correlation IDs and enough examples
   to identify the affected subset.

If it cannot be reproduced, gather more evidence instead of guessing a fix.

## Phase 2 — reconstruct recent-change provenance

For a regression, recent history is a primary evidence source, not a final afterthought.

Inspect commits on the affected path and around the first-bad time:

```bash
git log --format=fuller --decorate --date=iso -- <affected-path>
git show --format=fuller <sha>
git log -p -- <affected-path>
git blame -L <start>,<end> <file>
```

When the regression window is bounded and a deterministic reproduction exists, consider
`git bisect` rather than manually guessing among many commits.

For each credible change, reconstruct:

```text
commit
  -> complete commit subject/body and diff
  -> authoring branch/worktree/peer when recoverable
  -> PR and its review/discussion
  -> Bead contract / dependencies / notes / close reason
  -> Specialist or agent result when that work produced the change
  -> original problem and intended success condition
```

Use `gh`, `bd`, `xt worktree list` / topology, and `sp result` or current equivalents when
those surfaces exist. Exact commands are runtime-dependent; use live help.

The commit body is valuable because XTRM agents normally record the reasoning and scope of
a change. But it is not authority: compare the stated intent with the actual diff and
current contract.

Do not simply revert the newest commit. A changed line may be correct in isolation and
only expose an older assumption elsewhere. Understand why the change existed before
undoing it.

## Phase 3 — trace code/data/control flow

Use `/gitnexus` plus targeted source reads to connect candidate changes to the symptom.

Typical sequence:

```text
query error/symptom
  -> identify process and suspect symbols
  -> inspect callers/callees and data/control flow
  -> inspect recent changes to those symbols/processes
  -> read source to confirm the actual behavior
```

For bad values, trace backwards until the value is created or corrupted. For missing
behavior, trace forward to where the expected action should occur. At component
boundaries, verify what enters and exits rather than assuming configuration/data
propagation.

Useful questions:

- Where is the first point the state becomes wrong?
- What exact input/state reaches that point?
- Which caller or upstream component supplied it?
- Did a recent commit change that assumption, ordering, schema, timeout, or default?
- Which downstream callers depend on the old/new behavior?

## Phase 4 — build one falsifiable hypothesis

State the hypothesis explicitly:

```text
I think <change/state> causes <symptom> because <observed causal mechanism>.
If true, <minimal experiment/evidence> should show <expected result>.
```

Test one variable at a time. Do not pile speculative fixes together.

When a hypothesis fails, discard it and incorporate the new evidence. Do not add another
patch on top.

## Phase 5 — compare with working behavior

Find a working comparison when useful: earlier commit, sibling code path, unaffected
request/service, previous deployment, or equivalent implementation.

List relevant differences and explain which one can produce the symptom. Avoid “that
cannot matter” assumptions until evidence rules the difference out.

## Phase 6 — fix the cause

Once the cause is confirmed:

1. create/strengthen the smallest reproduction or regression test when practical;
2. make one targeted fix;
3. preserve the valid intent of the change that introduced/exposed the regression;
4. re-run the original failing case;
5. run affected regression/integration checks;
6. inspect GitNexus blast radius for shared-symbol changes;
7. record the causal chain in the durable work item.

A useful root-cause note is concise but complete:

```text
First bad: <time/version/commit/deploy>
Introduced/exposed by: <sha/PR/bead>
Original intent: <why that change existed>
Mechanism: <how it produces this failure>
Evidence: <trace/test/log/diff>
Fix: <what changed and why it preserves intent>
Regression proof: <tests/runtime evidence>
```

## Performance regressions

Measure before optimizing. Compare the current bad state with a known-good baseline and
trace the changed hot path. Use language/runtime profilers when needed, then correlate the
hotspot with recent commits and its callers via GitNexus. A slower release with a nearby
commit is correlation until the profile/control-flow evidence explains the cost.

## Stop conditions

Stop and reconsider the architecture/assumptions when repeated fixes fail for different
reasons or reveal widening hidden coupling. Three failed “fixes” without a stable causal
model is evidence that the current hypothesis or architecture is wrong, not a reason for
a fourth speculative patch.

Never replace causal investigation with “try this and see” under time pressure. Fast
incident response benefits more, not less, from knowing which change to revert or repair.