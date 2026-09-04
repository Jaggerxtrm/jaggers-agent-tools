---
name: find-skills
description: >
  Discover additional Agent Skills and decide whether to import them into XTRM. Use when
  the user asks for a skill/capability that is not already present, wants to browse the
  skills ecosystem, or wants to adopt a third-party skill. Search is allowed; installation
  into managed XTRM state is governed. Audit instructions, scripts, dependencies,
  provenance, trigger overlap, and placement before enabling anything.
---

# Find Skills

First check what XTRM already provides:

```bash
xt skills list --global
xt skills list --local
```

If an existing default or enabled pack covers the task, use it instead of importing an
overlapping third-party skill.

## Discover

Use current public skill registries/search tools when useful. `npx skills find <query>`
may be used as discovery if installed, but its install command is not the XTRM governance
path.

For each candidate record:

- source repository/publisher and license;
- exact skill directory/version/commit when possible;
- description and trigger overlap with XTRM skills;
- bundled scripts/assets/dependencies;
- network/credential/file-write behavior;
- whether the value is procedure, live connectivity, or deterministic code.

## Audit before import

Read the full `SKILL.md` and executable files. Reject or isolate skills that surprise the
stated purpose, request broad credentials/permissions without need, install opaque code,
or duplicate an existing XTRM authority.

A skill from the public ecosystem is closer to a dependency than to a harmless README.

## Place through XTRM

For accepted content, create or use an appropriate user/optional pack via the current
`xt skills` lifecycle. Preserve provenance/version information in the pack or adjacent
metadata. Enable it explicitly for the runtimes/scope that need it.

Do **not** run unattended global install commands such as `npx skills add ... -g -y` into
XTRM-managed locations. They bypass XTRM's source of truth and review boundary.

## Prefer the right primitive

- Stable procedure/judgment -> skill.
- Deterministic repeated mechanics -> script/tool inside a governed skill or package.
- Live data/authenticated system access -> MCP/tool/service plus a skill that teaches the
  workflow when needed.

If no trustworthy skill exists, use `/skill-creator` to build the smallest local skill
from the actual recurring gap rather than importing a broad collection.