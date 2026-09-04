---
name: code-quality
description: >
  Optional engineering-quality stack for code review, debugging discipline, test design,
  verification-before-completion, TDD where appropriate, and evidence-backed complexity
  reduction. Enable when a project wants these methods as explicit agent guidance beyond
  XTRM's automatic lint/typecheck hooks.
---

# Code Quality

Automatic XTRM hooks may run language quality checks; this skill does not duplicate those
gates. It teaches judgment that cannot be enforced mechanically.

Route to:

- `references/review.md` — correctness/risk review of a diff or PR.
- `references/debugging.md` — hypothesis-driven debugging.
- `references/testing.md` — TDD/test choice and behavioral evidence.
- `references/verification.md` — completion evidence and anti-theatre checks.
- `references/reduction.md` — Ponytail-style evidence-backed complexity/performance cuts.

Use repository-native lint/test/typecheck commands and current hook output as evidence.
Do not install a second formatter/linter simply because an old XTRM skill mentioned it.