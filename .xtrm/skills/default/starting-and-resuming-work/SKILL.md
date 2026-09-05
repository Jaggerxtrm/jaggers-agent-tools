---
name: starting-and-resuming-work
description: >
  Re-enter, resume, take over, or continue existing XTRM work without losing reality. Use
  when a fresh session inherits tracked work, the user says continue/pick up/catch up, an
  agent takes over another worker's lane, context pressure requires continuation, or a
  running lane appears stalled. Re-derive live state, recover the durable work identity,
  verify ownership/worktree/runtime state, and continue from recorded evidence. Generic
  work identity and progress-journal doctrine belong to /using-xtrm and `xt work`.
---

# Starting and Resuming Work

This skill is about **re-entry**, not the general requirement to track work.

`/using-xtrm` owns the invariant that every mutating worker has a claimed durable work
identity. `xt work` owns the worker-facing lifecycle commands. Use this skill when work
already exists and a session must recover or continue it safely.

## Re-enter reality

Do not rebuild a plan from chat history first.

1. Identify repository/worktree and current branch.
2. Recover the relevant durable work identity (`xt work status [id]`, referenced Bead,
   or explicit user/worker handoff).
3. Read the current work contract/journal and related issue/dependency state.
4. Inspect recent relevant commits/PRs/diff and validation that may have changed.
5. Inspect active XTRM workers/jobs/topology when another participant may still own work.
6. Retrieve targeted memory only when history is needed to locate a decision or trap.
7. Compare inherited summaries with live state and correct stale claims before continuing.

Use the cheapest live source that answers the question. `bd prime` is an opt-in diagnostic,
not a mandatory startup ritual.

## Resume the durable identity

When the correct work item is known:

```bash
xt work resume <id>
xt work status <id>
```

Do not create a second execution/check-in Bead merely because a new context window or
worker took over. Resume the existing identity unless ownership genuinely split into a
new independently tracked piece of work.

## Reconstruct the ownership map

Before mutation or new dispatch, know:

```text
work item -> current owner -> workspace/branch -> expected output -> blocker/reply state
```

If ownership is ambiguous, resolve it before creating another worker. Duplicate agents on
the same mutable scope are a race unless explicitly coordinated.

If the resumed worker discovers that the current item is only a lightweight check-in but
the work has become substantial, ambiguous, high-risk, or consumable by another worker,
route to `/planning` before continuing large mutation.

## Context pressure

Treat context capacity as an execution resource.

When remaining context is no longer comfortably sufficient for the next coherent phase:

```text
finish or stop at a clean boundary
  -> record meaningful progress/evidence with xt work note
  -> reconcile branch/worktree + running workers/replies
  -> make the next action explicit in durable state
  -> hand ownership to a supported continuation mechanism
  -> successor resumes the same work identity
```

Do not spend the final useful context budget writing a ceremonial handoff document that
duplicates the Bead journal, repository, commits, tests, PR, or worker results.

Create a separate checked-in report only when the report itself is a requested artifact
or carries evidence that does not belong in normal work state.

## Takeover from another worker

A successor should not need the predecessor's transcript.

Verify:

- the current contract or lightweight execution scope;
- what actually changed in the repository and where it lives;
- validation already run, including failures/skips;
- active workers/jobs and unconsumed results;
- pending replies, decisions, blockers, and dependencies;
- the next recorded action;
- deliberate non-actions or scope exclusions that still matter.

Worker summaries and old notes are leads. Re-check consequential claims against live
state before acting.

## Stalled work

Silence is not success. Distinguish:

- worker still computing;
- worker waiting for input/reply;
- continuation/wakeup was never armed;
- worker/job crashed;
- result completed but parent never consumed it;
- ownership changed and the lane is obsolete.

Use `/multiplexing` for peer/subagent coordination and `/using-specialists` for
Specialist-specific job evidence.

When the stall changes work reality, record that transition with `xt work note` rather
than preserving it only in chat.

## Close/relinquish

A session ending does not necessarily mean the work item closes.

- If the work is complete and validated, close it through `xt work done ...`.
- If another worker/context continues it, leave the work open and current, then transfer
  ownership through the supported runtime/coordination mechanism.
- If blocked, record the blocker/dependency truthfully instead of forcing a completion.

The success criterion is simple: the next participant can recover current reality quickly
from durable work state + repository/runtime evidence.