---
name: xtrm-maintenance
description: >
  Optional maintainer stack for XTRM documentation/agent-doc audits, dependency and asset
  updates, releases, PR/session finalization, and maintenance of managed repositories.
  Use when maintaining XTRM itself rather than merely using XTRM to implement product
  work.
---

# XTRM Maintenance

Use live `xt --help` and repository release/update scripts as authority. Maintenance
skills historically became stale by copying command manuals; this umbrella stores only
the stable decision rules.

Route to:
- `references/docs.md` — docs and agent-instruction drift.
- `references/update.md` — managed assets/dependencies and fleet updates.
- `references/release.md` — release preparation/publication evidence.
- `references/finalize.md` — session/PR integration and handoff.

The bundled `scripts/agent-docs/` tree retains the deterministic agent-document audit
helper from the old skill.