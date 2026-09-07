---
name: multiplexing
description: >
  Canonical XTRM multi-agent coordination doctrine. Use whenever two or more live agents,
  native subagents, or xt pi/claude/codex sessions collaborate, delegate, exchange
  decisions, wait on each other, or need continuation. Prefer each harness/runtime's
  native SDK, agent, messaging, reply, and wakeup facilities; use XTRM/Beads for durable
  contracts and identity, and xtmux/tmux as observability or compatibility transport only
  where the active runtime still needs it. Replaces the older tmux-centric multiplexing
  protocol and the experimental multiplexing-native-test direction.
---

# Multiplexing

XTRM is a multi-agent system. `multiplexing` is how participants coordinate without
turning terminal panes or chat transcripts into the source of truth.

## Native first

Use the strongest coordination primitive provided by the active harness/runtime.

```text
same harness, native subagent/session API available
  -> use native agent lifecycle + native messaging/reply/wakeup

separate long-lived XTRM peer required
  -> launch through xt pi|claude|codex and use its XTRM/native communication adapter

Specialist role/job required
  -> /using-specialists

native communication unavailable for a tmux-hosted compatibility lane
  -> xtmux/tmux compatibility path
```

Do not route native-capable agents through simulated terminal typing merely because old
multiplexing versions did so.

## Durable work is separate from transport

Every delegated lane gets a durable XTRM contract. The communication mechanism carries
coordination around that contract; it does not replace it.

```text
bead/contract  = what the worker owns and how success is proven
message        = status, pointer, decision, question, correction
worker result  = evidence/claim to consume
runtime state  = whether the worker is alive/waiting/done
```

Long payloads belong in the bead, a durable artifact, or the worker result. Messages
should point to them.

## Coordinator responsibilities

Before dispatch:

- understand the work-list and overlap surface;
- make every worker contract ready;
- choose boundaries that can actually be owned independently;
- state merge/integration ownership;
- state whether a reply/decision is required;
- avoid parallel writers on the same mutable surface unless ordering is explicit.

After dispatch:

- remain reachable;
- consume incoming decision requests;
- observe by event/transition where supported instead of busy-polling;
- verify terminal results before advancing dependent work;
- stop obsolete lanes when the plan changes;
- hand off coordinator state before context pressure becomes unsafe.

Read `references/worker.md` when this agent is a delegated worker rather than the
coordinator.

## Messaging semantics

Prefer typed/native messages with explicit sender, recipient, correlation/reply identity,
and delivery state when the runtime supports them.

A required reply is an obligation, not an FYI. Preserve the correlation identity through
the reply path. Receipt/acknowledgement does not automatically mean the requested answer
or decision was delivered.

If the active compatibility transport uses xtmux, inspect current `xtmux ... --help` and
its durable message/obligation surfaces rather than copying old flag recipes. The same
semantic rules apply regardless of transport.

See `references/messaging-and-continuation.md`.

## Wakeup and continuation

A worker that asks a question and then loses its wakeup path is effectively dead.
Whenever progress depends on a future event:

1. identify the event/condition;
2. register the runtime-supported continuation/wakeup/monitor;
3. verify registration succeeded;
4. preserve enough durable state that a restart can recover;
5. stop the mechanism when the dependency is resolved.

Do not treat periodic polling as the default if the harness offers event-driven
completion or messages.

## Native subagents vs xt peers

Use a native subagent when the work is bounded and the parent harness can own its
lifecycle/result directly. Use an `xt` peer when the worker needs a durable independent
session, worktree, long lifetime, different harness/model, or direct operator access.

Both still receive XTRM-quality contracts.

## Results

Prefer durable/native result APIs over scraping terminal output. A result tells you what
the worker claims; re-check load-bearing conclusions against live state before merging,
deleting, deploying, or declaring completion.

`tmux capture-pane` is a live UI diagnostic, not a final-result protocol.

## Cross-runtime details

Read `references/harnesses.md` only for the runtimes participating in the current task.
The root skill intentionally avoids hardcoding SDK method names that change independently
of XTRM's semantic contract.

## Failure rules

Stop and reconcile when:

- two workers unexpectedly own the same mutable surface;
- a required reply has no viable route back to the requester;
- a worker is terminal but its result cannot be recovered;
- a dependent lane was dispatched from stale base state;
- native and compatibility transports disagree about identity/ownership;
- the coordinator is near context failure without a durable handoff.

The fix is to restore one durable ownership/evidence model, not to add another ad-hoc
message channel.