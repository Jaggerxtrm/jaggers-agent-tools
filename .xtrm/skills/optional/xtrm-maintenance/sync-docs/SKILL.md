---
name: sync-docs
description: >
  Synchronize exactly one documentation file against recent implementation evidence while
  keeping source reads bounded. Use when one named doc is stale after code/config/runtime
  changes. Preserve the single-document invariant; multi-document updates are separate
  work items or parallel sync-docs runs.
disable-model-invocation: true
---

# Sync Docs

One invocation updates at most one documentation file.

## Scope invariant

The durable work contract must name exactly one documentation path. If it names zero docs,
multiple docs, a directory, or a source-code path, stop with `BLOCKED: scope-violation`.
Do not turn a single-doc sync into an unbounded documentation audit.

## Evidence boundary

Prefer bounded change evidence over rereading the implementation tree:

1. the target document itself;
2. recent commit subjects/timestamps and the work contract;
3. this skill's deterministic drift/context helpers;
4. targeted `git show <sha> -- <relevant-paths>` for unclear changes;
5. only the minimum live source/runtime evidence needed to resolve a disputed claim.

Do not use broad range diffs or whole-tree exploratory reads as the default sync method.
If the doc cannot be reconciled from bounded evidence, return `BLOCKED` and state what
additional scope/evidence is required.

## Deterministic helpers

Resolve this skill's installed directory, then use the bundled tools under `scripts/`.
The preserved helpers include:

```text
scripts/context_gatherer.py
scripts/drift_detector.py
scripts/doc_structure_analyzer.py
scripts/validate_doc.py
scripts/validate_metadata.py
```

The exact flags are defined by the current scripts; inspect `--help` before relying on an
old invocation. References under `references/` define the document frontmatter/structure
contract.

## Workflow

```text
verify exactly one doc in scope
  -> collect drift/recent-change evidence for that doc
  -> inspect at most the unclear commits/paths
  -> edit only the target doc
  -> update its sync/version metadata when its schema requires it
  -> run doc/metadata/drift validation
  -> report updated / no-change / blocked
```

Do not edit source code, another doc, README, or CHANGELOG unless that exact file is the
single target.

## Output

Persist a concise result:

```text
DOC: <path>
VERDICT: UPDATED | NO_CHANGE_NEEDED | BLOCKED
COMMITS_REVIEWED: <sha...>
EDITS: <summary or none>
DRIFT_BEFORE: stale | clean | unknown
DRIFT_AFTER: clean | n/a | unknown
FOLLOWUPS: <other docs that need separate work, if any>
```

Follow-ups are names/contracts only; do not edit them in the same run.

## Relationship to other maintenance

Use `xtrm-maintenance` for broad maintenance/finalization routing. Use this skill when the
unit of work is specifically one stale document. Agent/runbook/service-specific knowledge
may have its own owner (for example XTRM `service-knowledge`); do not duplicate those
reconciliation systems into generic docs sync.
