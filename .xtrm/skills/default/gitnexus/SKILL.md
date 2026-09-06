---
name: gitnexus
description: >
  Use GitNexus code-graph evidence to explore unfamiliar code, trace failures, measure
  blast radius, plan safe refactors, inspect change impact, review PRs, or manage the
  repository index. This is the single XTRM GitNexus router; load the relevant reference
  instead of selecting among separate exploring/debugging/impact/refactoring/CLI skills.
---

# GitNexus

GitNexus is XTRM's code-graph evidence layer. Use it to answer structural questions before
reading or changing large parts of a repository.

## Route by question

| Question | Reference |
|---|---|
| How does this area/flow work? | `references/exploring.md` |
| Why is this failing? | `references/debugging.md` |
| What breaks if this changes? / refactor? | `references/impact-and-refactoring.md` |
| What does this PR/diff affect? | `references/pr-review.md` |
| Index/status/analyze/wiki/schema mechanics | `references/cli.md` |

## General rules

- Check repository/index identity and freshness when results look incomplete.
- Query by concept/flow first, then inspect specific symbols.
- Use graph results to narrow targeted source reads; the graph is evidence, not a
  replacement for the source.
- Before changing a shared symbol, inspect upstream dependants/blast radius.
- Before declaring a diff safe, compare graph impact with actual changed files/tests.
- If MCP tools are unavailable, use the current GitNexus CLI. Check live help instead of
  guessing subcommands.
- XTRM's GitNexus hook may already enrich reads/tool output. Do not repeat expensive graph
  calls when the needed evidence is already present and fresh.