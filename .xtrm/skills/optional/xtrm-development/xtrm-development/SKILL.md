---
name: xtrm-development
description: >
  Optional maintainer/developer skill for changing XTRM hooks/extensions, runtime
  integrations, deterministic workflow machinery, and XTRM CLI/coordination internals.
  Use when implementing XTRM itself; ordinary product work should use the core system
  skills instead.
---

# XTRM Development

Read current architecture/source and tests before editing runtime machinery. Prefer a
runtime primitive or extension over teaching agents a fragile manual workaround.

Route to:
- `references/hooks-and-extensions.md`
- `references/workflows.md`
- `references/runtime-debugging.md`

When changing an enforced behavior, update its implementation, tests, operator docs, and
any skill statement that describes the boundary. Do not make a skill responsible for a
safety invariant that should be deterministic runtime code.