# `xt spec` Upstream Dependencies

> **Why this doc:** `xt spec apply` depends on capabilities owned by the Specialists/XTRM chain stack. Those capabilities ship through reviewed planner/chain contracts and managed skills; readiness must name a concrete upstream dependency when a check fails.

## Edge type

We do **not** use `bd dep add --type blocks` to wire this cross-repository documentation dependency. A blocks edge would freeze local work behind a repository we do not control. Use prose pointers here plus the readiness probe as the runtime gate.

If a future Beads federation path provides a stable non-blocking cross-workspace relation, use that typed relation rather than inventing a local mirror.

## Capability ↔ upstream

| Capability key (matrix) | Upstream decision | Notes |
|---|---|---|
| `planning_uses_bd_swarm` | Specialists/XTRM planning and Beads reuse decisions | Planning may reuse native graph validation/materialization where the installed Beads contract supports it; do not duplicate graph authority. |
| `planning_uses_bd_mol_pour` | Specialists chain-template compatibility catalog + XTRM ChainSource canon | Formula pour remains a compatibility materialization/source mechanism. The generic target is ChainSource → ChainDefinition → ResolvedChain, not formula=molecule as the ontology. |
| `planning_emits_xml_contracts` | Specialists execution/contract design | Preserve rich machine-readable root/step contracts where current schema supports them; current canonical field names must be read from the live contract schema. |
| `planning_recommends_template` | XTRM ADR-001 + Specialists formula catalog | Planner may recommend one of **15** formula/template compatibility ChainSources or an ad-hoc/user-authored ChainSource; selection never makes templates the only authoring path. |
| `planning_typed_edge_fluency` | XTRM chain authoring + Beads authority | Use typed work relationships where semantically appropriate; readiness dependencies remain distinct from descriptive/causal relationships. |
| `planning_scrutiny_enforcement` | XTRM/ Specialists chain policy | SCRUTINY/policy is resolved before freeze and cannot be silently lowered by an execution participant. |
| `testplanning_uses_bd_gate` | Beads reuse + current Specialists test-planning policy | Use native deterministic gate primitives where they satisfy the contract; semantic evaluation remains in the owning runtime/eval layer. |
| `testplanning_layer_classification` | Current test-planning skill | Preserve core/boundary/shell and critical-path/risk classification; chain materialization must not erase testing obligations. |

## Catalog truth

The Specialists source catalog currently contains **15** `.formula.json` assets. They are compatibility `ChainSource` assets. The integrated generic ontology is defined in `xtrm-dev/xtrm:docs/runtime/` and the production-diff template doctrine remains in `xtrm-dev/xtrm:docs/substrate/chain_templates.md`.

Do not hard-code the count into runtime selection logic; validate the installed catalog when a command needs the concrete available set.

## Locating current upstream work

Architecture/requirements live in current XTRM runtime docs and Specialists roadmap/PRD. Implementation state lives in repository-local Beads and Git. Search the current board by semantic outcome or stable `WP-*` identifier rather than relying on historical Dxx/Opp numbers from older roadmap revisions.

## Refresh discipline

Review this index:

- whenever the `xt spec` readiness capability matrix changes;
- when XTRM ChainSource/materialization policy changes;
- when planning/test-planning skill contracts change;
- when the packaged formula catalog changes materially.

If a capability is added to the readiness matrix, a matching row must land here or in the current generated upstream-dependency registry in the same change.