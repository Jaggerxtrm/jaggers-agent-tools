---
name: skill-creator
description: >
  Create, consolidate, evaluate, or improve XTRM Agent Skills. Use when adding a new
  capability, reducing overlapping skills, improving trigger descriptions, adding
  references/scripts, or measuring whether a skill actually improves real tasks. Follows
  the portable Agent Skills structure and XTRM pack/trust rules; evaluation and runtime
  truth come before prose volume.
disable-model-invocation: true
---

# Skill Creator

Treat a skill like production code: it needs a real gap, a clear trigger boundary,
versioned content, tests/evals where useful, and a defined trust surface.

## Start from the failure/gap

Before authoring, identify representative tasks where the current agent fails, wastes
context, repeats a procedure, or lacks domain guidance. Do not create a skill merely
because a topic exists.

Prefer consolidating into an existing umbrella when a human would struggle to choose
between two skill descriptions.

## Portable shape

```text
skill-name/
├── SKILL.md
├── references/   # detailed guidance loaded only when needed
├── scripts/      # deterministic helpers, executed rather than pasted into context
└── assets/       # templates/static resources
```

`SKILL.md` should be a concise router/procedure. Keep references one level deep and name
exactly when to read each one. Put deterministic formatting, validation, extraction, or
repetitive mechanics in scripts rather than asking the model to regenerate them.

The frontmatter `description` is the discovery contract: say what the skill does, when to
use it, and important negative routing when nearby skills overlap.

## XTRM placement

- `default`: only capabilities required to operate correctly as an XTRM agent.
- optional pack: domain/method capability that should be enabled intentionally.
- user/project pack: local or organization-specific capability.

Use `xt skills` for the current pack lifecycle. Do not install a public skill directly
into the managed default tree.

## Executable skills

Current portable XTRM skills may bundle executable scripts. Review scripts as code and
state dependencies explicitly.

Pi also provides a persistent Python kernel in the current XTRM extension stack, but
Prime-Agent-style automatic `pyproject.toml` skill package installation is **not yet an
XTRM loader contract**. Do not claim it is. A future package-backed skill layer should
freeze package/version/hash and keep privileged lifecycle/capability authority in the
host runtime.

## MCP-delivered skills

Treat remote skill instructions as remote code-like input. Skills-over-MCP is useful for
distribution but still evolving. Until XTRM has a governed SkillSource adapter, do not
make a remote server an ambient source of executable skill scripts. Remote executable
content requires explicit review/import/pinning.

## Evaluation loop

For a meaningful skill:

1. Write realistic should-trigger and should-not-trigger prompts.
2. Run representative tasks with the candidate skill.
3. Compare against baseline/no-skill or the previous version.
4. Use deterministic assertions/scripts for objective outputs.
5. Review qualitative judgment where the task is subjective.
6. Record correctness, trigger accuracy, token/context cost, time, and common failure
   trajectories when available.
7. Remove instructions that do not change behavior; strengthen missing decision points.
8. Re-run after consolidation to catch routing regressions.

A skill that only works when force-loaded but cannot be selected reliably has a discovery
problem, not a documentation problem.

## Promotion test

Before making a skill default, require evidence that:

- it is broadly needed by XTRM agents;
- its description does not conflict with neighboring defaults;
- the body is current against the actual runtime;
- deterministic behavior is scripted/enforced when possible;
- critical workflows have verification/failure handling;
- third-party/executable content has a clear trust boundary.

Default is a cognition budget, not a showcase.