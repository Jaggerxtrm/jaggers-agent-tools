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
| **C** `suite-c-coordinator-lineage.mjs` | 2-5, 7-11 | **BLOCKED** (by design) | Subordinate coordinator launch (P0-05) + mandatory worktrees (P1-02) + branch ancestry (P1-03) all land in **xtrm-3xgs5**, which owns `cli/src/utils/worktree-session.ts` (forbidden to touch, mid-refactor). Probes for the launch contract and reports BLOCKED until it lands. |

Result: **15 of 20 steps run today**; the coordinator-lineage arc is a
bead-linked, capability-probing stub that graduates into a live (non-hermetic)
lane the moment `xt --subordinate` ships.

### Faithful, not green-washed

- **Step 6** asserts the installed Specialists artifact *exposes* the
  `xtrm.runtime-origin.v1` contract (shape-level). Live capture needs a
  dispatched specialist under a coordinator → Suite C.
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
