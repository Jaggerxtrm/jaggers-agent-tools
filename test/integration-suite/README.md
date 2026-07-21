# Cross-repository installed-artifact integration suite (audit §P2-01)

One conformance suite that exercises the **installed** Core + Specialists + xtmux
release-candidate artifacts — not the source trees — across the audit's 20-step
scenario. Big-brother of `scripts/install-update-ux-smoke.mjs`.

## Run it

```bash
# Local: packs the three RCs from sibling dev checkouts (~/dev/{specialists,xtmux})
node test/integration-suite/run-all.mjs

# Against explicit tarballs (CI): set all three, packing is skipped
P201_CORE_TARBALL=/tmp/xtrm-tools.tgz \
P201_SPECIALISTS_TARBALL=/tmp/specialists.tgz \
P201_XTMUX_TARBALL=/tmp/xtmux.tgz \
  node test/integration-suite/run-all.mjs
```

Each runner is a dependency-free `node` script using `node:assert` — deliberately
**not** part of the `cli` vitest project, so a heavy install/tmux suite never
slows the unit path. Every child runs under an isolated `HOME` **and**
`XDG_STATE_HOME`; the operator's real `~` and 300 MB `observability.db` are never
touched. No fixture secret is allowed to appear in any captured output.

## The split (defended)

The audit itself flags steps 2-11 as coordinator-dependent. The 20 steps divide
by what is buildable against today's shipped surface:

| Suite | Steps | Status | Why |
|---|---|---|---|
| **A** `suite-a-installed-artifact.mjs` | 1, 6, 19, 20 | **RUNNABLE** (hermetic) | Install all three RCs; version-conformance vs `docs/runtime-compatibility.json`; `xt update --apply` on stale Pi state; user-owned assets preserved. No tmux. |
| **B** `suite-b-coordination.mjs` | 12-18 | **RUNNABLE** (capability-gated) | Full reply-obligation → ack → correlated-reply → consume-once → restart-no-dup lifecycle + read-only bridge / mutation-refused, against a **private** `tmux -L` server and isolated state. Skips cleanly where tmux/xtmux are absent. |
| **C** `suite-c-coordinator-lineage.mjs` | 2-5, 11 (7-10 live-only) | **RUNNABLE** (capability-gated) | Launches a **real subordinate chain coordinator** through the packed Core artifact (`xt claude … --subordinate`) against a private `tmux -L` server and a throwaway git repo, then asserts the lineage invariants: distinct worktree + branch, `@agent_parent_session`/`@agent_role`/`@agent_bead`/`@agent_worktree`/`@agent_branch`, the single-line `session:pane` stdout contract, and main left untouched. Skips cleanly where tmux/git are absent. |

Result: **20 of 20 steps are now addressed** — 16 run, and steps 7-10 are
explicitly deferred to a live-agent lane rather than reported as blocked.

Suite C graduated in **xtrm-6hey0** (audit P0-05 `--subordinate` + P1-02 lineage
metadata), which is what unblocked it. It became **gating** in `run-all.mjs` at
the same time: it exits 0 when its capability gate closes, so a runner without
tmux or git stays green, but a genuine lineage regression now fails the run.

### Faithful, not green-washed

- **Step 6** asserts the installed Specialists artifact *exposes* the
  `xtrm.runtime-origin.v1` contract (shape-level). Live capture needs a
  dispatched specialist under a coordinator → Suite C step 9, which is
  live-agent-only.
- **Suite C shims `sp` and the runtime binary, and says so in its header.** Core
  is the real packed artifact under test; Suite C's subject is *Core's* lineage
  contract, not Specialists' task rendering (Suite A covers that at contract
  level) nor a real LLM turn. A real `sp render-task` needs a beads database and
  a real agent needs credentials — shimming both is what makes steps 2-5 and 11
  assertable at all.
- **Suite C steps 7-10 are `[SKIP]`, not `[PASS]`.** They dispatch an actual
  specialist chain and inspect the branches it creates — Specialists-side
  behavior requiring live agents. Core only *publishes* the base branch via
  `@agent_branch` (audit P1-03); it does not create `sp/*` branches, so faking
  them here would assert nothing about Core.
- **Step 20** asserts hooks + extensions are preserved (both code-backed
  foreign-preserved surfaces). A bare, unmarked user *skill* dropped into a
  managed skills projection is **repaired away** by `update --apply`; that is
  surfaced as an `[OBSERVE]` finding (managed tree is repaired from package
  payload) and tracked as a follow-up, not asserted as a pass.

## Packaging choice

Co-located in `test/integration-suite/` (option **a**). "Cross-repository" is
satisfied by *consuming packed RC tarballs* of all three, not by a separate repo.
Reuses Core CI (the `fresh-machine-smoke` workflow already packs Specialists and
provides Bun), ships in one PR, and adds no independent release cadence.

Parent tracker: `xtrm-kvsrd.2` · epic `xtrm-kvsrd` · blocker `xtrm-3xgs5`.
