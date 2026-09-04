# XTRM-Tools

**xtrm** (`xt`) is a durable agentic workflow system for Claude Code, Pi, Codex, and Specialists. It combines Beads-backed work contracts, worktree/session lifecycle, deterministic hooks/extensions, composable skills, code-graph context, and multi-agent coordination so work can move between agents without depending on one chat transcript.

## What XTRM provides

### Beads — durable work contracts

[Beads](https://github.com/Jaggerxtrm/beads) is the durable work/state layer. Agents claim work before editing, keep requirements and evidence on the work item, and leave handoffs that another session or worker can resume.

Useful commands:

```bash
bd ready
bd show <id>
bd update <id> --claim
bd close <id> --reason "Done"
bd memories <topic>
```

A dispatchable XTRM work item is a contract, not only a title. The v4 planning doctrine expects clear `PROBLEM`, `SUCCESS`, `SCOPE`, `NON_GOALS`, `CONSTRAINTS`, `VALIDATION`, and `OUTPUT` sections when work is ready for another agent.

### Hooks and extensions — deterministic enforcement

Policies in `policies/` compile into the runtime-specific hook/extension layer. Deterministic lifecycle rules belong here rather than in prompts that agents must remember manually.

Current enforcement includes Beads edit/commit/stop behavior, worktree boundaries, quality checks, project-memory injection, compact/session restoration, Specialist agent guards, GitNexus enrichment, worktree reap checks, debug logging, and inbox/continuation reminders where the runtime supports them.

See [docs/hooks.md](docs/hooks.md) and [docs/policies.md](docs/policies.md).

### Skills v4 — small universal surface, opt-in domain stacks

XTRM v4 deliberately keeps the always-active skill surface small. The universal defaults are:

| Skill | Purpose |
|---|---|
| `using-xtrm` | XTRM operating doctrine, work contracts, evidence, multi-agent expectations, minimal engineering |
| `starting-and-resuming-work` | cold start, takeover, continuation, handoff, context-pressure recovery |
| `multiplexing` | native-first peer/subagent coordination, replies, wakeups, continuation |
| `planning` | durable contracts, decomposition, board triage, test strategy, premortem |
| `engineering-quality` | causal debugging, review, testing, verification, evidence-backed reduction |
| `using-specialists` | Specialists execution backend plus advanced Specialist references/assets |
| `gitnexus` | code-graph exploration, impact, debugging, refactoring, review support |
| `skill-creator` | skill authoring, progressive disclosure, scripts, evals and promotion discipline |
| `find-skills` | governed discovery/import of additional skills |

The main design rule is that **XTRM agents work as participants in a durable multi-agent system, not as isolated sessions**. The same contract-quality and evidence rules apply whether work stays in the current agent, moves to an `xt pi` / `xt claude` / `xt codex` peer, uses a native subagent, or dispatches a Specialist.

Domain and maintainer capabilities live in optional packs:

| Pack | Purpose |
|---|---|
| `architecture-design` | architecture and design methods |
| `data-engineering` | data, SQL and storage engineering |
| `personal-tools` | personal opt-in tooling such as `vaultctl` |
| `research-methods` | documentation/code/recent/deep research and fact checking |
| `security-ops` | security investigation and repository security bootstrap |
| `sre-ops` | live SRE/observability, causal production debugging, deploy/capacity workflows |
| `xt-optional` | specialized XTRM/operator helpers that should not be universal |
| `xtrm-development` | XTRM hooks/extensions/workflow/runtime development |
| `xtrm-maintenance` | releases, dependency updates, docs sync, Specialists updates and maintenance |

The full current catalog and v3→v4 disposition are documented in [docs/skills.md](docs/skills.md) and [docs/skills-v4-preservation-matrix.md](docs/skills-v4-preservation-matrix.md).

### Specialists

`sp` (`@jaggerxtrm/specialists`) is XTRM's governed role/job execution backend. Core vendors the `using-specialists` runtime doctrine from an exact pinned Specialists commit. `update-specialists` remains a separate maintenance workflow inside the `xtrm-maintenance` pack.

Advanced Specialist surfaces no longer consume separate active skill roots. KPI analysis, NodeSupervisor, script-class execution, and Specialist-definition authoring live under `using-specialists` as references and deterministic assets:

```text
using-specialists/
├── SKILL.md
├── references/
│   ├── kpi.md
│   ├── nodes.md
│   ├── script-class.md
│   └── specialist-definitions.md
└── scripts/specialist-definitions/
```

Use the live registry/CLI when exact roles or flags matter:

```bash
specialists list --full
sp help
```

See [docs/skills-ownership.md](docs/skills-ownership.md) for vendor/source invariants.

### Engineering quality and causal debugging

`engineering-quality` is universal because debugging, review, testing and completion evidence are normal engineering work. Regression debugging is explicitly causal:

```text
symptom
  -> first bad observation
  -> failing code/data/control path
  -> candidate change
  -> commit body + diff
  -> PR / Bead / worker intent
  -> causal mechanism
  -> smallest corrective change
  -> regression proof
```

The bundled provenance helper can collect repetitive Git evidence while the agent remains responsible for causal judgment.

### SRE Ops and low-context observability

Enable `sre-ops` for infrastructure/production environments. XTRM prefers `mcpq` as the low-context CLI for querying MCP observability servers instead of dumping every Grafana/Prometheus/Tempo/OpenTelemetry tool schema into the agent context.

The progressive discovery flow is:

```bash
mcpq servers
mcpq <server> list-tools
mcpq <server> describe <tool>
mcpq <server> call <tool> ... --json
```

SRE causal reconstruction correlates metrics, Grafana panels/queries, traces, logs, service topology, deploy/change identity, commits, PRs, Beads and worker intent. Service-specific runbook freshness belongs to the `service-knowledge` subsystem rather than being duplicated inside generic SRE guidance.

### Board audit

Current board publication uses the gen-2 permanent export mechanism. Beads/Dolt remains authority; `board-audit checkpoint` publishes only board-audit transport artifacts into the permanent orphan branch:

```text
board-audit-export-do-not-cancel
```

The old on-demand `issue-triage` exporter is retired. See the v4 preservation matrix and board-audit package documentation for the exact transport/reconcile distinction.

---

**Version 0.12.0** | [Complete Guide](XTRM-GUIDE.md) | [Changelog](CHANGELOG.md)

---

## Documentation

| Doc | Contents |
|---|---|
| [XTRM-GUIDE.md](XTRM-GUIDE.md) | Full architecture, concepts and workflow reference |
| [docs/skills.md](docs/skills.md) | Current skills-v4 tiers, defaults, optional packs and runtime composition |
| [docs/skills-v4-preservation-matrix.md](docs/skills-v4-preservation-matrix.md) | Normative v3→v4 capability disposition |
| [docs/skills-ownership.md](docs/skills-ownership.md) | Core/Specialists skill ownership and publish contract |
| [docs/skills-tier-architecture.md](docs/skills-tier-architecture.md) | Deeper skill tier/runtime implementation |
| [docs/hooks.md](docs/hooks.md) | Current hook wiring, gate logic and ownership |
| [docs/policies.md](docs/policies.md) | Policy compiler/schema and runtime parity |
| [docs/pi-extensions.md](docs/pi-extensions.md) | Pi extension integration and managed sync |
| [docs/worktrees.md](docs/worktrees.md) | `xt` worktrees, attach/end/reap and isolation |
| [docs/xt-pi-role.md](docs/xt-pi-role.md) | `xt pi --role` / `xt claude --role` specialist launch behavior |
| [docs/mcp-servers.md](docs/mcp-servers.md) | MCP server configuration |
| [docs/bash-tools.md](docs/bash-tools.md) | Bash/CLI helpers and when to prefer them over MCP schema loading |
| [docs/cli-architecture.md](docs/cli-architecture.md) | CLI internals, install/update and composition |
| [docs/docs-commands.md](docs/docs-commands.md) | Documentation inspection/cross-check commands |
| [docs/project-skills.md](docs/project-skills.md) | Project/user skill migration notes |
| [docs/testing.md](docs/testing.md) | Integration and runtime validation checklist |
| [docs/release.md](docs/release.md) | Release/publish contract |
| [CHANGELOG.md](CHANGELOG.md) | Full version history |

---

## Quick Start

```bash
npm install -g xtrm-tools @jaggerxtrm/specialists

# Bootstrap global managed skills/runtime state.
xt bootstrap

# Initialize the current repository.
xtrm init

# Verify the installation.
xt --version
sp --version
xt doctor
```

One-line project bootstrap:

```bash
npx -y github:xtrm-dev/core init
```

### Typical workflow

```bash
# Start a sandboxed peer session in a worktree.
xt claude my-feature
# or
xt pi my-feature

# Launch with a Specialist role/work contract.
xt pi --role planner --bead <id>
xt claude --role reviewer --bead <id> --prompt 'review the auth changes'

# Re-attach to durable work.
xt attach

# Publish/close one worktree session.
xt end

# Refresh durable project memory from Beads/current state.
xt memory update

# Drain the xt/* PR queue when appropriate.
xt merge
```

`xt merge` is an XTRM CLI workflow backed by the canonical `xt-merge` Specialist; it is not a separate default Agent Skill.

### Skills and packs

Managed skills are composed from:

```text
~/.xtrm/skills/
├── default/        # package-managed universal skills
├── optional/       # package-managed opt-in packs
├── <user-pack>/    # user-managed global packs
└── active/         # generated global runtime view

<repo>/.xtrm/skills/
├── <user-pack>/    # project-local user packs
├── active/         # generated project runtime view
└── state.json
```

Create user packs as flat siblings, outside managed `default/` and `optional/`:

```bash
xt skills create-pack <name> --global
xt skills create-pack <name> --local
```

Inspect and enable managed packs:

```bash
xt skills list --global --json
xt skills list --local --json

xt skills enable sre-ops --global
xt skills enable research-methods --global
xt skills enable xtrm-development --local
xt skills disable sre-ops --global
```

Use `xt skills --help` for flags supported by the installed release.

To verify universal skill composition after bootstrap/update:

```bash
ls ~/.xtrm/skills/default/using-xtrm/SKILL.md
ls -l ~/.xtrm/skills/active/using-xtrm
ls -l .xtrm/skills/active/using-xtrm
ls -l .claude/skills/using-xtrm
```

### Keeping XTRM and Specialists updated

Update installed packages first because `xt update` reconciles package-owned assets from the installed release:

```bash
npm install -g xtrm-tools@latest @jaggerxtrm/specialists@latest
xt --version
sp --version
```

Preview and apply managed-asset drift:

```bash
xt update --repo .
xt update --root ~/dev
xt update --all-repos

xt update --apply --repo .
xt update --apply --root ~/dev
xt update --apply --all-repos
```

Specialists runtime drift and XTRM-managed asset drift remain separate ownership tracks. Use current `sp doctor --help`, `xt doctor --help`, and `xt update --help` instead of relying on frozen command recipes.

---

## What's Included

### Core enforcement and context

| Component | Runtime | Purpose |
|---|---|---|
| **Beads gates** | Claude + Pi integrations | claim/edit/commit/stop lifecycle and durable work state |
| **Session flow** | runtime-specific adapters | claim sync, compact/session state, continuation/handoff reminders |
| **Quality gates** | Claude + Pi integrations | deterministic lint/typecheck checks on relevant edits |
| **Worktree boundary/reap** | supported runtime hooks | prevent unsafe cross-worktree edits and detect stale worktrees |
| **GitNexus** | supported runtime integrations | code-graph context and impact evidence |
| **Specialists agent guard** | supported runtime hooks | protect Specialist-owned execution boundaries |
| **Project memory** | supported runtime hooks | inject project memory doctrine without eagerly loading full `using-xtrm` content |

### Privacy and telemetry

**xtrm-tools does not send source code or usage analytics to an XTRM-owned telemetry service.** External tools/providers used by the operator retain their own data policies. XTRM runtime state, Beads data, hooks, skills and local observability/logging remain operator-controlled.

---

## Policy System

Policies in `policies/` are the source definitions compiled into managed runtime hook configuration and adapters.

Current policy files include:

| Policy | Purpose |
|---|---|
| `beads.json` | Beads lifecycle gates |
| `session-flow.json` | session/claim/stop flow |
| `quality-gates.json` | language quality checks |
| `quality-gates-env.json` | startup environment checks for quality tooling |
| `gitnexus.json` | code-graph enrichment |
| `using-xtrm.json` | project-memory/system doctrine injection boundary |
| `worktree-boundary.json` | block unsafe edits outside the active worktree |
| `worktree-reap.json` | stale worktree sweep/reap integration |
| `specialists-agent-guard.json` | Specialist execution boundary |
| `inbox-reminder.json` | pending coordination/reply reminder |
| `xtrm-debug-logger.json` | XTRM lifecycle/tool debug logging |

```bash
node scripts/compile-policies.mjs
node scripts/compile-policies.mjs --check
```

See [docs/policies.md](docs/policies.md) and [docs/hooks.md](docs/hooks.md).

---

## CLI Commands

```text
xtrm <command> [options]
```

| Command | Description |
|---|---|
| `claude` | launch Claude Code in an XTRM worktree/session |
| `pi` | launch Pi in an XTRM worktree/session |
| `init` | bootstrap XTRM machine/runtime/project state |
| `status` | read-only XTRM/project status |
| `reset` | reset XTRM-managed state according to current CLI contract |
| `end` | close/publish one worktree session |
| `worktree` | worktree list/clean/reap operations |
| `attach` | re-attach to an existing worktree/session |
| `docs` | documentation inspection and drift checks |
| `memory` | durable memory synthesis/update |
| `merge` | queue/integration workflow using the canonical `xt-merge` Specialist |
| `debug` | inspect XTRM hook/Beads lifecycle events |
| `report` | session/workflow reporting |
| `skills` | list/enable/disable/create managed or user skill packs |
| `claude-sync` | reconcile Claude-specific managed state |
| `doctor` | health/drift/runtime checks |
| `update` | preview/apply XTRM-managed asset updates |
| `migrate` | migrate older per-repo managed layouts |
| `version` | print package/build identity |
| `spec` | specification/intention surfaces that feed durable planning |
| `release` | release helpers where supported by the installed CLI |
| `help` | command help |

Use live `xt <command> --help` as the authority for exact flags and behavior.

---

## MCP and CLI research surfaces

Configured MCP servers/tools vary by installation. XTRM favors progressive discovery and narrow requests rather than eagerly loading large remote schemas.

Common code/documentation surfaces include GitNexus, GitHub code search, documentation providers and operator-enabled plugins. For observability, `mcpq` is the preferred low-context CLI interface when the environment exposes Grafana/Prometheus/Tempo/OpenTelemetry through MCP.

See [docs/mcp-servers.md](docs/mcp-servers.md) and [docs/bash-tools.md](docs/bash-tools.md).

---

## Issue Tracking

```bash
bd ready
bd show <id>
bd update <id> --claim
bd close <id> --reason "Done"
```

See [XTRM-GUIDE.md](XTRM-GUIDE.md) and the current `bd --help` output for the full contract.

---

## Version History

| Version | Date | Highlights |
|---|---|---|
| 0.12.0 | 2026-09-04 | Skills-v4 consolidation, universal multi-agent/contract doctrine, causal engineering quality, SRE/mcpq guidance, current service-knowledge and board-audit ownership |
| 0.11.6 | 2026-08-20 | PATH-based Pi lookup fix |
| 0.11.5 | 2026-08-20 | launch hardening, Pi rendering polish, worktree reap, Codex runtime experiments, Python-kernel work |
| 0.11.0 | 2026-07-16 | launcher, role-model isolation, verified audits and release metadata |

See [CHANGELOG.md](CHANGELOG.md) for full history.

---

MIT License
