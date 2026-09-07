---
name: updating-dependencies
description: >
  Evidence-first dependency bump, advisory, and supply-chain review workflow. Use for
  Dependabot/Renovate/manual bumps, lockfile changes, vulnerable dependencies, GitHub
  Actions updates, or dependency sweeps that need a reproducible risk verdict rather than
  ad-hoc scanner triage. Preserve deterministic case/schema evidence, source tiers,
  cooldown/security rules, upgrade dossier, merge gates, and post-deploy watch handoff.
disable-model-invocation: true
---

# Updating Dependencies

A dependency update is a compatibility and supply-chain decision. Compute what can be
computed first, research the uncertain parts second, then emit an evidence-backed verdict.

The XTRM programme-level policy/spec lives in the current `xtrm` repository under:

```text
docs/devops/dependency-bump-policy.md
docs/devops/dependencies-updating.md
```

Use the current versions of those documents when available; this skill carries the
portable execution contract and deterministic assets.

## Deterministic case first

Start from manifests/lockfiles, registry metadata, advisory feeds, SBOM/dependency graph,
usage evidence, CI results, and deployment/service ownership when available. Materialize
the case against the bundled:

```text
schemas/dependency_update_case.schema.json
```

Unknown fields stay `unknown`/null according to the schema. Do not fabricate whether a
dependency is direct/transitive, reachable, deployed, vulnerable, or covered by tests.

## Research source tiers

Classify evidence before using it in a verdict:

| Tier | Examples | Decision weight |
|---|---|---|
| 1 — authoritative machine-readable | OSV, GHSA, CVE/NVD, CISA KEV, registry advisories/metadata, lockfile, SBOM, provenance | primary security/release evidence |
| 2 — official migration semantics | maintainer release notes, changelog, migration/API docs, official tags/diffs | compatibility evidence |
| 3 — threat/research intelligence | OpenSSF and credible security research/vendors | caution/escalation evidence |
| 4 — community early warning | issues/discussions, HN/Reddit, public maintainer/researcher discussion | radar only; never blocks alone |

Current web/research tools may improve discovery, but cite the underlying authoritative or
official source when that source exists.

## Required analysis

For the requested from/to version, establish as far as evidence permits:

```text
identity + ecosystem
from -> to
release age / yanked status
runtime/dev/build/test scope
transitive path
advisories and fixed versions
reachability / public exposure
breaking or deprecated behavior
local imports/call sites/workflows/images/actions
CI/test evidence
service/deploy blast radius
provenance / maintainer / install-script concerns
```

GitHub Actions are build-infrastructure dependencies. Require full-SHA pinning where
project policy requires it, inspect permissions/triggers/OIDC/secrets exposure, and do not
treat a moving action tag like an ordinary library version.

## Cooldown and security urgency

Use the current XTRM dependency-bump policy as authority. The preserved baseline is a
7-day cooldown for ordinary fresh releases, bypassed only for defined security urgency.
Extend rather than shorten caution when provenance or install behavior is suspicious.
Community signals alone do not create a blocking verdict.

## Outputs

Preserve the deterministic and operator-readable artifacts shipped with this skill:

```text
dependency_update_case.json
schemas/dependency_update_case.schema.json
schemas/upgrade_dossier.schema.json
templates/research-matrix.md
templates/upgrade-dossier.md
templates/pr-comment.md
templates/post-deploy-watch-spec.md
```

The dossier/verdict must distinguish observed facts, inferences, missing evidence, required
merge gates, and post-deploy watch/rollback conditions.

## Delivery boundary

This skill evaluates/prepares the dependency update. It may propose code/config/test
changes and produce PR/work-item evidence, but it does not silently deploy or rollback.
Implementation uses the owning XTRM worker/Specialist; deployment and post-deploy
observation use the current delivery/SRE workflows.

When a dependency change is deployed with a watch requirement, hand the explicit watch
contract to `/sre-ops` or the project's deploy-monitoring workflow rather than keeping an
update agent polling indefinitely.

## Completion standard

Do not call an update safe because a scanner is green or because tests passed once. A
usable result identifies the exact update, evidence sources, local/runtime exposure,
compatibility findings, security/provenance findings, required tests/gates, verdict,
rollback boundary, and any post-deploy watch.
