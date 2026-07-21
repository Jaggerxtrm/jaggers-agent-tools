# `xt topology` — aggregated topology projection and viewer

Audit `~/dev/11.md` §P2-05 (projection) and §P2-06 (viewer).

An operator running N concurrent panes has no single answer to *"what is running
where, under which coordinator, on which worktree and branch, against which bead,
and has it landed?"*. The facts exist, but they live in six systems that share no
key — so the join gets done by hand across `xtmux dashboard`, `sp ps`, `bd list`,
`git worktree list` and `gh pr list`.

`xt topology` performs that join once and renders it.

```bash
xt topology                    # summary: source ledger + counts
xt topology --view chains      # coordinators and the jobs they own
xt topology --json             # xtrm.topology.projection.v1 snapshot
xt topology --no-github        # skip the slow, rate-limited PR query
```

## What it joins

```
tmux pane → interactive runtime → role → coordinator → specialist jobs
          → bead → worktree → branch → integration target → pull request
```

| Source | Read via | Contributes |
|---|---|---|
| xtmux | `xtmux topology --json` | host identity |
| tmux | `tmux list-panes -a -F …` | panes + `@agent_*` lineage |
| Specialists | `sp ps --json` | jobs, chains, epics, branches |
| Beads | `bd list --all --json` | bead status |
| git | `git worktree list --porcelain` | worktrees, branches, HEADs |
| GitHub | `gh pr list --json …` | PR evidence |

## Guarantees

**Read-only by construction.** `READ_ONLY_COMMANDS` in
`cli/src/core/topology-projection.ts` is the single table every argv is built
from. There is no code path that can issue a mutating command — the guarantee is
structural, not a review convention. The test suite asserts the recorded argv
against that table and pins the two dangerous prefixes: `git worktree list`
(`worktree` also has `add` / `remove` / `prune`) and `gh pr list` (`pr` also has
`create` / `merge` / `close`).

**No duplicate mutable graph.** `collectProjection()` is a pure function of the
world plus a command runner. No cache, no materialization, no module state —
there is nothing to persist into. Every invocation recomputes from live sources,
so the snapshot cannot drift from its sources.

**Completion is never inferred from terminal output.** The only completion
signals any view may read are `bead.status`, `pull_request.merged_at` / `state`,
and `job.status`. `agent.state` is a runtime lifecycle signal (idle / working)
and is never treated as done-ness. A pane whose session is literally named
`work-is-done` with an open bead renders as open.

**Pane capture never transits this command.** The
`xtrm.topology.projection.v1` contract has no `content` / `preview` / `output` /
`capture` field at any level, and every object is `additionalProperties: false`.
A producer therefore cannot smuggle terminal text through it even by accident,
so capture output can never reach the durable event journal. `--view routes`
prints the exact `xtmux pane capture` command instead.

**Sources degrade independently.** Each is queried concurrently and bounded by
its own timeout. `unavailable` (binary absent — not a bug) is kept distinct from
`error` (present but failed — a bug signal). The `sources[]` ledger is what stops
a degraded projection from reading as an empty world: without it, an absent `sp`
and "no jobs running" both produce an empty jobs array. Views announce the
degradation rather than rendering a convincing empty table.

## Views

| View | Shows |
|---|---|
| `summary` | source ledger + counts (default) |
| `topology` | every pane, its session, command and role |
| `chains` | coordinator panes and the jobs they own |
| `lineage` | chain roots and their descendants |
| `worktrees` | worktree/branch graph, including unattached worktrees |
| `collisions` | worktrees shared by more than one live pane |
| `integration` | job branch → integration target → PR state |
| `beads` | bead state per pane |
| `prs` | pull-request evidence per branch |
| `routes` | exact commands for the surfaces xtmux and git own |

Every view is a pure `(projection) => string` function, which is what keeps them
testable without a live host and stops one from quietly acquiring its own data
source.

### What the viewer deliberately does *not* implement

The audit lists live journal feed, reply obligations, monitors and wakes, pane
preview, and git diff among the operator views. These are live streams and
diagnostics that xtmux and git already own, bound and clamp. Reimplementing them
would fork the behavior — and in pane capture's case would pull terminal content
into a process that must never hold it.

`--view routes` prints the exact command for each, with real pane ids and
worktree paths filled in from the snapshot:

```
xtmux log follow --after-id <n>
xtmux obligations list --pane "$(tmux display-message -p '#{pane_id}')" --json
xtmux monitor-list --json
xtmux pane capture --pane %1656 --lines 40
git -C /repo/.xtrm/worktrees/coord diff
```

Deployment evidence beyond PR merge state is `/deploy-monitor`'s job, not this
command's.

## Known limitations

- **Beads resolve from the invoking repo's database only.** A pane sitting in a
  different project reports its bead id with status `unknown` rather than a wrong
  status — the projection will not guess across repo boundaries. The `beads` view
  annotates these as `(other repo)`.
- **Job attribution is by bead identity.** A job is attributed to a pane when
  they share a bead (directly, or via the pane's bead being the job's epic), or
  when the pane is parked inside the job's own worktree. Jobs whose coordinator
  pane has died surface under `orphans.jobs` rather than vanishing.
- **`@agent_role` / `@agent_worktree` / `@agent_branch` come from tmux directly**
  because `xtmux topology --json` does not yet publish them (tracked as
  `xtmux-71y`). When it does, the enrichment call can be dropped and the
  projection gains remote-host support for free via the xtmux bridge.

## Contract

`xtrm.topology.projection.v1`, published in `@xtrm/contracts`. The schema is the
source of truth; `TopologyProjectionV1` mirrors it and the fixture test guards
their agreement.
