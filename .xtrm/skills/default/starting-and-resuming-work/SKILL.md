---
name: starting-and-resuming-work
description: How to start, sustain, and hand off work in an xtrm-equipped session — orienting on a live board, choosing whether to work solo or delegate, arming continuity so long work survives session death, coordinating panes and specialists, and writing a handoff a successor can actually use. Use this whenever a session begins or resumes ("what's the state?", "pick up where we left off", "continue the epic", "you're the new coordinator"), whenever work will outlast one context window, whenever you're about to delegate to panes/specialists/workflows, whenever you're taking over someone else's in-flight work, and whenever you're near a context ceiling and need to hand off. Also use when work has stalled, when lanes are running but nothing is progressing, or when deciding between doing it yourself and orchestrating it.
---

# Starting and resuming work

This skill is about the part of the job that isn't the task: knowing where things
actually stand, choosing a shape of work that fits, and making sure progress survives
you. It does not prescribe a sequence. You are better at reading a situation than any
fixed procedure is, so what follows is what tends to be true and why — the judgment
stays yours.

The recurring failure in this environment is not bad code. It is **work that stops
existing**: a session dies with its plan only in context, a delegated pane waits forever
on a reply nobody read, a successor inherits a confident summary that was already false.
Everything below is aimed at that.

## The one thing that is genuinely non-negotiable

**If work will outlast this turn, arm continuity before you do the work — and then
confirm it armed.**

A harness gives you a few ways to get woken up again. Which exist varies, so check
rather than assume:

- **`/loop`** — re-invokes you on an interval, or self-paced if you give no interval.
  In self-paced mode you call `ScheduleWakeup` at the end of each turn, and the loop
  ends the moment you don't.
- **`Monitor`** — a background script whose stdout lines become notifications. This is
  how you coordinate *by exception* instead of polling. Filter it to the lines you would
  act on, including failure signals — a monitor that greps only for success is silent
  through a crash, and silence reads exactly like "still running".
- **`/goal`** — a built-in command that holds a standing objective across turns, with a
  status chip and an evaluator that fires when the turn's background shells and delegated
  subagents finish. Because it re-evaluates on *work completing* rather than on a clock,
  it fits goal-directed work better than a timer does — it is the natural choice for
  "drive this to completion", with `/loop` as the alternative when you want an interval
  or explicit self-pacing.
- **`ScheduleWakeup` / `CronCreate`** — scheduled re-invocation.
- **`/schedule`** — durable cloud runs that survive the session closing entirely.

Note that `/goal` and `/loop` are **built-in commands, not skills**, so they will not
appear in a skills listing and searching a skills directory for them finds nothing. Do
not conclude from that absence that they are unavailable — a session that talks itself
out of arming continuity is precisely how long work dies quietly. Check by running the
thing, not by hunting for a file.

**Verify the arming by observing it, not by having issued it.** An instruction inside a
launch prompt is not evidence the prompt took — freshly launched agents routinely come up
idle with the prompt discarded. Read the pane. Look for the actual scheduled-wakeup line,
the running monitor, or the agent's own statement of its mechanism. This applies to you
and to anything you launch.

## Orienting: find out what is true now

Whether you're starting fresh or taking over, the first question is what state the world
is actually in — not what the last summary said it was.

The board is usually the fastest answer. `bd prime` loads workflow context; `bd ready`,
`bd blocked`, and `bd show <id>` give specifics; `bv --robot-triage` adds graph-aware
ranking, unblock targets, and health (use only `--robot-*` flags — bare `bv` opens a TUI
that blocks the session). `xt topology` joins panes, roles, specialist jobs, beads,
worktrees, branches and PRs into one read-only projection, which is often the single most
useful call when resuming into unfamiliar activity.

If other agents are running, `xtmux dashboard sessions-only` inventories them, and
`xtmux audit` / `worktree-collisions` surface hygiene problems like two agents sharing
one checkout.

### Inherited state is a lead, not a verdict

This is the lesson that costs the most when ignored. A handoff document, a predecessor's
summary, a subagent's final report, a bead marked closed — each is a *claim*, made at a
moment that has passed. Re-derive anything you're about to act on, especially anything
expensive or irreversible to get wrong.

Concretely: check the live state of the thing itself before merging, deleting, declaring
done, or telling someone else it's done. A cheap verification query beats a confident
paragraph. When a claim and the system disagree, the system is right.

Two traps worth naming, because both look like completion:

- **A pane showing a bare input prompt is not idle.** Agents mid-turn often render that
  way, and dashboards can report a live session as `done` between turns. Read the pane
  body, not its last line.
- **An idle agent is not a finished agent.** It may have summarised at a moment when its
  work looked complete and been overtaken seconds later by a new review finding, a failed
  check, or a dependency moving underneath it. Re-derive the completion criteria yourself
  rather than trusting the count it reported.

## Choosing the shape of the work

The honest default is: **do it yourself.** Delegation buys parallelism and pays for it in
coordination, context, and machine load. Reach for a bigger shape only when the work
genuinely has that shape.

- **Solo** — most things. One coherent change, one reviewer, one context.
- **Specialists (`sp`)** — when work benefits from a distinct role and a tracked
  contract: review, debugging, implementation, doc sync, security passes, chains.
  `sp help` is the surface; **`/using-specialists` is the doctrine** and owns bead
  contracts, dispatch rules, and escalation. Load it before orchestrating specialists
  rather than improvising the protocol.
- **Panes (`xt claude` / `xt pi` / `xt codex` + `xtmux`)** — when work needs long-lived
  peers with their own worktrees, especially where file contention means tasks cannot
  safely fan out. **`/multiplexing`** covers coordinating several concurrent sessions;
  **`/multiplexing-team`** is the counterpart for being a delegated pane rather than the
  one delegating.
- **Workflows (`Workflow`)** — when control flow should be deterministic rather than
  model-driven: fan-out over a discovered work-list, barriers, adversarial verification,
  computed gates. **`/authoring-workflows`** teaches the topology and the failure modes.
  This one needs explicit user opt-in; it can spawn many agents and spend heavily.

A useful hybrid: scout inline first to discover the actual work-list, *then* pick the
shape. You rarely know the right topology before you know the work.

**Treat concurrency as a cost with a ceiling.** Runners, databases, and the agents
themselves usually share one machine. Past a point, more lanes produce slower merges and
infrastructure failures that look like test failures — and the natural reaction, adding
capacity to catch up, makes it worse. Check load before adding a lane, and be willing to
conclude the answer is fewer.

## Coordinating without stalling anyone

When work is delegated, the coordination channel is a real system with real failure modes.

**Durability order matters.** Put the contract where it survives: a bead is durable and
inspectable; a `/tmp` file is ephemeral and dies with the machine; a `send-keys` pointer
is a one-line nudge, never a payload. `xtmux mux-help` documents this contract and the
safe primitives (`handoff`, `safe-send-pointer`, `wait-agent`, `monitor-agent`). Note
`wait-agent` blocks while `monitor-agent` registers asynchronously and returns
immediately — mistaking the second for a completion is a common way to believe work
finished when it hasn't.

**Read your inbox every cycle.** `xtmux message-list --unacked --expects-reply`. A worker
that sent a message expecting a reply is *blocked on you*. Dispatching lanes and never
reading back builds a one-way channel and stalls the work you delegated. Recipient
filters match literally — if an inbox looks empty, try the bare name, the prefixed
session name, and the pane id before believing it.

**An empty inbox is not proof nothing was sent.** Some panes lose their coordination
tooling entirely and say so in their status line; their messages silently go nowhere. If
a lane can't reach you, reach it by file plus pointer, then re-read its pane to confirm
the instruction landed — check the input line cleared, because text already sitting in a
pane's input box will silently corrupt what you send.

**Prefer waking on events over polling.** A monitor that emits only on change, and
deliberately excludes your own panes, keeps you responsive without burning turns. If a
scheduled wakeup keeps firing with nothing to do, the monitor is misconfigured — fix the
signal rather than raising the frequency.

## Rulings and reviews: state the constraint, not the mechanism

When you direct another agent, describe the invariant to satisfy and the failure to
avoid, then let it choose and justify the implementation. Prescribing a mechanism makes
you responsible for defects you can't see from where you're standing — a ruling that
names an implementation is a reliable way to introduce the next bug.

Relatedly: **a fix is not done until the fix itself has been reviewed.** Remediation
under time pressure introduces new defects at a surprisingly high rate. When someone
reports a fix, look at the fix, not the report.

When a reviewer — human or bot — disagrees with you, read the finding properly before
defending. Weigh it against the actual code, and let severity be decided by consequence
in your context rather than by the label attached to it: something rated minor can be
critical if it can corrupt or permanently hide data.

## Handing off

Long work outlives context windows. Plan the handoff as part of the work rather than as
an emergency, and start it while you still have room to do it properly — finishing "one
more thing" past your ceiling is how a successor inherits a half-finished merge.

What makes a handoff useful is rarely a status table. It's:

- **The next single action**, concrete enough to execute without re-deriving it.
- **Verified facts a successor would otherwise re-discover** — and, just as valuable,
  **corrections to what the record currently gets wrong**, with the evidence.
- **What you deliberately did *not* do, and why.** Holds without reasons get "unblocked"
  by the next person.
- **Live state that is genuinely live** — re-derived at handoff time, never copied
  forward from the previous handoff.

Put it where it survives: checked into the repo, exported to durable storage, pushed. If
a sequence must be ordered — export, then verify, then commit, then push — let each step
finish and check it before starting the next. Backgrounding a chain to save time is how a
stale or half-written file gets pushed while reporting success.

Then confirm your successor is alive and armed before you stop.

## Reporting

Say what happened. If checks failed, say so with the output. If a step was skipped, say
that. If nothing merged, say nothing merged — a clean report of "held four things, here's
why" is a better outcome than an optimistic one, and when the person who could catch an
error is absent, an unverified claim becomes everyone's false premise afterwards.

Prefer binary, checkable milestones over percentages. Percentages hide non-progress.

## Where to go next

| Need | Surface |
|---|---|
| Specialist orchestration doctrine | `/using-specialists`, `sp help` |
| Several concurrent sessions | `/multiplexing`, `xtmux mux-help`, `xtmux help` |
| Being a delegated pane | `/multiplexing-team` |
| Deterministic fan-out / gates | `/authoring-workflows`, `Workflow` |
| Board triage and planning | `bd prime`, `bv --robot-triage`, `/planning`, `/issue-triage` |
| Joined view of everything running | `xt topology` |
| Session bootstrap / close | `/init-session`, `/xt-end`, `/session-close-report` |

`references/surfaces.md` holds command-level detail — read it when you need exact flags
rather than orientation.

The environment is larger than this file. When something here doesn't match what you're
looking at, trust what you observe and go find the real surface — `--help`, `mux-help`,
`bd prime`, `/find-skills`. Documentation drifts; running systems don't.
