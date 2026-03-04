# Jaggers Agent Tools

Custom skills, hooks, and commands for Claude Code. This repository contains production-ready extensions to enhance Claude's capabilities with prompt improvement, task delegation, and development workflow automation.
A smart CLI configuration and update mechanism makes it easy to copy skills, commands and hooks across different agentic IDEs or CLIs. You can clone the repo and reuse the install/update method for your very own purposes.

## Table of Contents

- [Skills](#skills)
- [Hooks](#hooks)
- [Installation](#installation)
- [Configuration](#configuration)
- [Documentation](#documentation)
- [Version History](#version-history)
- [License](#license)

## Skills

### prompt-improving

Automatically improves user prompts using Claude's XML best practices before execution.

- **Invocation**: `/prompt [prompt]` or `/prompt-improving [prompt]`
- **Purpose**: Applies semantic XML structure, multishot examples, and chain-of-thought patterns
- **Hook**: `skill-suggestion.py`
- **Version**: 5.1.0

### delegating

Unified task delegation system supporting both CCS (cost-optimized) and unitAI (multi-agent workflows).

- **Invocation**: `/delegate [task]` or `/delegating [task]`
- **Purpose**: Auto-selects optimal backend for task execution
  - **CCS**: Simple tasks (tests, typos, docs) → GLM/Gemini/Qwen
  - **unitAI**: Complex tasks (code review, feature dev, debugging) → Multi-agent workflows
- **Hook**: `skill-suggestion.sh` (triggers on "delegate" keyword)
- **Config**: `skills/delegation/config.yaml` (user-customizable patterns)
- **Version**: 6.0.0

**Key Features**:
- Configuration-driven pattern matching
- Autonomous workflow selection for unitAI
- Interactive 2-step menu (Delegate? → Backend?)
- Auto-focus detection (security/performance/quality)
- Override flags (`--glm`, `--unitai`, etc.)

**Deprecates**: `/ccs-delegation` (v5.0.0) - use `/delegation` instead

### orchestrating-agents

Orchestrates task handoff and deep multi-turn "handshaking" sessions between Gemini and Qwen CLI agents.

- **Invocation**: `/orchestrate [workflow-type] [task]` (workflow-type optional)
- **Purpose**: Facilitates multi-model collaboration, adversarial reviews, and deep troubleshooting.
- **Workflows**:
  - **Collaborative Design** (`collaborative`): Proposal -> Critique -> Refinement (for features).
  - **Adversarial Review** (`adversarial`): Proposal -> Red Team Attack -> Defense (for security).
  - **Troubleshoot Session** (`troubleshoot`): Multi-agent hypothesis testing (for emergencies).
  - **Single Handshake** (`handshake`): Quick one-turn second opinion.
- **Examples**:
  - `/orchestrate adversarial "Review payment security"`
  - `/orchestrate "Design auth system"` (interactive workflow selection)
- **Hook**: None (Direct slash command)
- **Version**: 1.2.0

**Key Features**:
- Parameter-based workflow selection for direct invocation
- Interactive fallback when no workflow specified
- Corrected resume flags for multi-turn sessions (Gemini: `-r latest`, Qwen: `-c`)

### using-serena-lsp

Master workflow combining Serena MCP semantic tools with LSP plugins for efficient code editing.

- **Invocation**: Auto-suggested via hooks
- **Purpose**: Surgical code editing with 75-80% token savings
- **Hook**: `serena-workflow-reminder.py`
- **Origin**: Serena MCP

### documenting

Maintains Single Source of Truth (SSOT) documentation system for projects.

- **Invocation**: `/document [task]` or skill commands
- **Purpose**: Create, update, validate SSOT documentation
- **Hook**: None
- **Origin**: Serena MCP
- **Version**: 2.0.0 (with drift detection and INDEX blocks)

**Key Features**:
- `tracks:` frontmatter field for automatic drift detection
- Auto-generated INDEX tables for navigation without full reads
- Stop hook fires at session end to detect stale memories
- Decision table for when to update SSOT vs changelog only

### obsidian-cli

Interact with Obsidian vaults using the Obsidian CLI.

- **Invocation**: Auto-loaded when working with Obsidian tasks
- **Purpose**: Read, create, search, and manage notes, tasks, properties
- **Hook**: None
- **Version**: 1.0.0

**Key Features**:
- Full CLI command reference (create, read, search, daily notes, tasks)
- Plugin development workflow (reload, error capture, screenshots, DOM inspection)
- Vault targeting with `vault=<name>` parameter
- File targeting with `file=` (wikilink-style) or `path=` (exact path)

### gitnexus (4 skills)

Knowledge graph-powered code intelligence skills.

- **Invocation**: Auto-suggested via hooks for code operations
- **Purpose**: Semantic code understanding with 75-80% token savings
- **Hook**: `gitnexus-hook.cjs` (PreToolUse for Grep|Glob|Bash)
- **Version**: 1.0.0

**Skills**:
- `gitnexus/exploring` — Architecture understanding ("How does X work?")
- `gitnexus/debugging` — Bug tracing ("Why is X failing?")
- `gitnexus/impact-analysis` — Blast radius ("What breaks if I change X?")
- `gitnexus/refactoring` — Surgical refactors (rename, extract, split)

**Tools**:
- `query` — Process-grouped execution flows
- `context` — 360-degree symbol view
- `impact` — Blast radius analysis (depth 1/2/3)
- `detect_changes` — Git-diff impact analysis
- `rename` — Multi-file coordinated rename
- `cypher` — Raw graph queries

### scoping-service-skills (Trinity)

Task intake and service routing for Docker service projects.

- **Invocation**: `/scope "task description"`
- **Purpose**: Detect intent, map to expert service skills, emit structured scope plan
- **Hook**: None (invoked before investigation/feature/refactor tasks)
- **Version**: 1.0.0

**Intent Taxonomy**:
- `investigation` — Errors, failures, issues (default when ambiguous)
- `feature` — New functionality
- `refactor` — Restructuring, cleanup
- `config-change` — Configuration updates
- `exploration` — Understanding, explanations

**Workflow**:
1. Read service registry
2. Detect intent from keywords
3. Map to registered services
4. Emit XML scope block with diagnosis → fix → regression-test phases

## Hooks

### Skill-Associated Hooks

**skill-suggestion.py**
- Skills: `prompt-improving`, `delegating`
- Trigger: UserPromptSubmit
- Purpose: Proactive skill suggestions based on prompt analysis
- Config: `settings.json` → `skillSuggestions.enabled: true`

**skill-discovery.py**
- Skills: All `skills/` directory skills
- Trigger: SessionStart
- Purpose: Injects summarized skill catalog at session start
- Config: Auto-wired in `settings.json`

**serena-workflow-reminder.py**
- Skill: `using-serena-lsp`
- Trigger: SessionStart, PreToolUse (Read|Edit)
- Purpose: Enforces semantic Serena LSP workflow

**gitnexus-hook.cjs**
- Skills: `gitnexus/*` (4 skills)
- Trigger: PreToolUse (Grep|Glob|Bash)
- Purpose: Enriches tool calls with knowledge graph context via `gitnexus augment`
- Config: Auto-wired in `settings.json`

### Standalone Hooks

**pip-venv-guard.py**
- Trigger: PreToolUse (Bash)
- Purpose: Prevent `pip install` outside virtual environments

**type-safety-enforcement.py**
- Trigger: PreToolUse (Bash|Edit|Write)
- Purpose: Enforce type safety in Python code

**statusline.js**
- Trigger: StatusLine
- Purpose: Display custom status line information

**NOTE** certain skills are third-party utilities, i believe they can be useful.

## Installation

### 🚀 Zero-Cloning Installation (Recommended)

The fastest way to install or update on any machine — no cloning required:

```bash
npx -y github:Jaggerxtrm/jaggers-agent-tools
```

This auto-detects your agent environments, shows a diff, and syncs everything in one step.

---

### 🛠️ Local Installation (after cloning)

```bash
git clone https://github.com/Jaggerxtrm/jaggers-agent-tools.git
cd jaggers-agent-tools/cli
npm install       # also runs `prepare` which builds the TypeScript
npm link          # registers `jaggers-config` globally
```

You can now run `jaggers-config` from anywhere.

---

## CLI User Guide

### Synopsis

```
jaggers-config <command> [options]
```

| Command  | Description                       |
| -------- | --------------------------------- |
| `sync`   | Sync tools to target environments |
| `status` | Show diff without making changes  |
| `reset`  | Clear saved preferences           |

---

### `jaggers-config sync`

The main command. Detects your agent environments, calculates what's changed, and applies updates.

```bash
jaggers-config sync                # interactive — prompts for targets and confirmation
jaggers-config sync --dry-run      # preview what WOULD change, write nothing
jaggers-config sync -y             # skip confirmation prompts (CI-friendly)
jaggers-config sync --prune        # also remove system items no longer in the repo
jaggers-config sync --backport     # reverse direction: copy drifted local edits → repo
```

**UX Features (v1.6.0+)**:
- **Listr2 concurrent diff phase**: Parallel environment checks with per-target change counts
- **cli-table3 plan table**: Formatted table showing Target / + New / ↑ Update / ! Drift / Total
- **boxen summary card**: Completion summary with green/yellow border based on drift
- **Themed output**: Semantic colors (success, error, warning, muted, accent) via `theme.ts`
- **Interactive consent**: Multiselect for MCP servers (space to toggle, all pre-selected)
- **Auto-detection**: Scans `~/.claude`, `~/.gemini`, `~/.qwen`, `~/.agents/skills` automatically
- **Inline sync**: `status` command offers to apply sync immediately after showing changes
- **Single confirmation**: See full plan across all targets, confirm once
- **Safety guards**: Prune mode aborts on read failures; clean errors (no stack traces)
- **Startup banner**: Professional branding on CLI launch (skip with `--help`/`--version`)
- **`--json` flag**: Machine-readable output for CI/CD pipelines

**What it syncs per target environment:**

| Item            | Claude               | Gemini               | Qwen               | Agents (skills-only) |
| --------------- | -------------------- | -------------------- | ------------------ | -------------------- |
| `skills/`       | ✅ copy/symlink       | ✅ copy/symlink       | ✅ copy/symlink     | ✅ direct copy        |
| `hooks/`        | ✅ copy/symlink       | ✅ copy/symlink       | ✅ copy/symlink     | ❌ skipped            |
| `settings.json` | ✅ safe merge         | ✅ safe merge         | ✅ safe merge       | ❌ skipped            |
| MCP servers     | `mcp add` CLI        | `mcp add` CLI        | `mcp add` CLI      | ❌ skipped            |
| Slash commands  | auto-generated       | `.toml` files        | `.toml` files      | ❌ skipped            |

**New in v1.7.0**: `~/.agents/skills` is now a first-class sync target for skills-only sync (no hooks/config/MCP).

**Diff categories shown before sync:**

- `+ missing` — item exists in repo but not in your system (will be added)
- `↑ outdated` — repo is newer than your system (will be updated)
- `✗ drifted` — your local copy is newer than the repo (skipped unless `--backport`)

**Safe merge behaviour for `settings.json`:**  
Protected keys (your local MCP servers, permissions, auth tokens, model preferences) are **never overwritten**. New keys from the repo are merged in non-destructively.

**Sync modes** (saved between runs, prompted on first sync):
- `copy` — default; plain file copy
- `symlink` — live symlinks so edits to `skills/` immediately reflect system-wide *(Linux/macOS only; Windows falls back to copy automatically)*

---

### `jaggers-config status`

Read-only diff view with enhanced feedback — no files written:

```bash
jaggers-config status       # auto-detects all environments
jaggers-config status --json # machine-readable output
```

**Output includes (v1.7.0+)**:
- Auto-detected environments: `~/.claude`, `~/.gemini`, `~/.qwen`, `~/.agents/skills`
- cli-table3 formatted table with per-target change breakdown
- Last synced time (relative: "3 hours ago")
- Item counts from manifest (skills, hooks, config)
- Per-target health: ✓ Up-to-date / ⚠ Pending changes
- **Inline sync prompt**: "Apply sync now?" with multiselect target choice (Esc to skip)
- No second diff pass needed — executes directly using pre-computed changeSets

---

### `jaggers-config reset`

Clears saved preferences (sync mode, etc.):

```bash
jaggers-config reset
```

---

### Manual Installation (without CLI)

1. Clone this repository:
   ```bash
   git clone https://github.com/Jaggerxtrm/jaggers-agent-tools.git
   cd jaggers-agent-tools
   ```

2. Copy skills to Claude Code:
   ```bash
   cp -r skills/* ~/.claude/skills/
   ```

3. Copy hooks:
   ```bash
   cp hooks/* ~/.claude/hooks/
   ```

## Configuration

### MCP Servers (v1.7.0 Unified System)

MCP servers are configured from canonical sources with automatic format adaptation for each agent.

**Core Servers** (installed by default):
- **serena**: Code analysis (requires `uvx`, auto project detection)
- **context7**: Documentation lookup (requires API key)
- **github-grep**: Code search across GitHub
- **deepwiki**: Technical documentation

**Optional Servers** (multiselect during sync):
- **unitAI**: Multi-agent workflow orchestration (requires `npx`)
- **omni-search-engine**: Local search engine (requires running service on port 8765)
- **gitnexus**: Knowledge graph code intelligence (requires `npm install -g gitnexus` + `npx gitnexus analyze` per project)

**Configuration Files**:
- Core: [`config/mcp_servers.json`](config/mcp_servers.json)
- Optional: [`config/mcp_servers_optional.json`](config/mcp_servers_optional.json)
- Environment: [`~/.config/jaggers-agent-tools/.env`](~/.config/jaggers-agent-tools/.env) (auto-created)

**Environment Variables**:
- **Location:** `~/.config/jaggers-agent-tools/.env` (created automatically on first sync)
- **Required:** `CONTEXT7_API_KEY` for context7 server
- **Validation:** Interactive prompts for missing API keys during sync
- **Persistence:** Values preserved across syncs; never overwritten
- Edit `~/.config/jaggers-agent-tools/.env` to add your API keys manually

**Unified MCP CLI Sync (v1.7.0)**:
- Uses official `mcp add`/`mcp remove`/`mcp list` commands for all agents
- **Idempotent:** Re-running is always safe — skips already-installed servers
- **Deduplication:** Prevents same server from syncing N times when multiple dirs selected
- **Interactive consent:** Multiselect prompt (space to toggle, all pre-selected)
- **Prerequisite auto-install:** Runs `npm install -g gitnexus` automatically when selected
- **Post-install guidance:** Shows required next steps (e.g., `npx gitnexus analyze`)
- **Timeout protection:** 10s timeout on CLI calls to prevent hangs
- **Clean errors:** User-friendly messages (no stack traces)

**Supported Agents**:
- Claude Code (`~/.claude.json` via `mcp add` CLI)
- Gemini (`gemini mcp` CLI)
- Qwen (`qwen mcp` CLI)
- Antigravity (`~/.gemini/antigravity/mcp_config.json` via `mcp add` CLI)

**Deprecated (v1.7.0)**:
- JSON file sync for Claude/Gemini/Qwen MCP — superseded by official `mcp` CLI method
- Repo `.env` files — use centralized `~/.config/jaggers-agent-tools/.env`

**Documentation**: See [docs/mcp-servers-config.md](docs/mcp-servers-config.md) for complete setup guide.

### Skill Suggestions

Enable/disable proactive skill suggestions:

```json
// ~/.claude/settings.json
{
  "skillSuggestions": {
    "enabled": true  // Set to false to disable
  }
}
```

### Hook Timeouts

Adjust hook execution timeouts in `settings.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [{
      "hooks": [{
        "timeout": 5000  // Timeout in milliseconds (5000ms = 5 seconds) for both Claude and Gemini
      }]
    }]
  }
}
```

### Service Skills Set (Trinity) — v1.5.0

Project-specific operational knowledge system for Docker service projects. Gives Claude persistent, service-specific expertise without re-explaining architecture every session.

**Three Workflow Skills (Trinity)**:

| Skill | Role | Invocation |
|---|---|---|
| `creating-service-skills` | Builds new skill packages via 3-phase workflow | `/creating-service-skills` |
| `using-service-skills` | Discovers and activates expert personas | Auto (SessionStart hook) |
| `updating-service-skills` | Detects drift when code changes | Auto (PostToolUse hook) |

**Five Hooks**:

| Hook | Type | Trigger | Effect |
|---|---|---|---|
| `SessionStart` | Claude Code | Session opens | Injects ~150-token service catalog |
| `PreToolUse` | Claude Code | Read/Write/Edit/Grep/Glob/Bash | Checks territory; injects skill load reminder |
| `PostToolUse` | Claude Code | Write/Edit | Detects drift; notifies to sync docs |
| `pre-commit` | Git | `git commit` | Warns if source changed without SSOT update (non-blocking) |
| `pre-push` | Git | `git push` | Warns if service skills are stale (non-blocking) |

**Generated Skill Package Structure**:

```
.claude/skills/<service-name>/
├── SKILL.md                  — architecture, failure modes, common operations
├── scripts/
│   ├── health_probe.py       — container status + table freshness
│   ├── log_hunter.py         — service-specific log analysis
│   ├── data_explorer.py      — read-only DB inspection
│   └── <specialist>.py       — service-type-specific inspector
└── references/
    ├── deep_dive.md          — Phase 2 research notes
    └── architecture_ssot.md  — link to project SSOT
```

**Installation** (run from inside target project):

```bash
cd ~/projects/my-project
python3 /path/to/jaggers-agent-tools/project-skills/service-skills-set/install-service-skills.py
```

- Idempotent — safe to re-run after updates
- Installs Trinity skills into `.claude/skills/`
- Wires `settings.json` hooks (SessionStart, PreToolUse, PostToolUse)
- Activates git hooks (`pre-commit`, `pre-push`)

**Creating a Service Skill** (`/creating-service-skills`):

**Phase 1 — Automated Skeleton**:
```bash
python3 scaffolder.py create <service-id> <territory-path> "<description>"
```
- Reads `docker-compose*.yml`, `Dockerfile`, dependency files
- Produces `SKILL.md` with `[PENDING RESEARCH]` markers
- Generates script stubs in `scripts/`
- Auto-detects official docs from image tags and package files
- Creates entry in `.claude/skills/service-registry.json`

**Phase 2 — Agentic Deep Dive**:
- Uses Serena LSP tools (not raw file reads) for 75-80% token savings
- Fills every `[PENDING RESEARCH]` marker with actual codebase knowledge
- Sources troubleshooting tables from real failure modes
- All scripts support `--json` output

**Phase 3 — Hook Registration**:
- Verifies `PreToolUse` hook in `.claude/settings.json`
- Confirms service territory globs in registry
- Informs user: skill now auto-activates on territory file access and service-name commands

**Auto-activation**:
Once registered, skills activate automatically when Claude:
- Operates on files matching territory globs (e.g., `src/auth/**/*.py`)
- Runs Bash commands mentioning service/container name

**Documentation**: See [project-skills/service-skills-set/service-skills-readme.md](project-skills/service-skills-set/service-skills-readme.md) for complete guide.

## Documentation

### Core Documentation
- [CHANGELOG.md](CHANGELOG.md) - Version history and breaking changes
- [ROADMAP.md](ROADMAP.md) - Future enhancements and planned features
- [AGENTS.md](AGENTS.md) - GitNexus quick reference for this project
- [CLAUDE.md](CLAUDE.md) - Claude Code development guide

### Skill Documentation
- [skills/prompt-improving/README.md](skills/prompt-improving/README.md) - Prompt improvement skill
- [skills/delegating/SKILL.md](skills/delegating/SKILL.md) - Delegation workflow guide
- [skills/obsidian-cli/SKILL.md](skills/obsidian-cli/SKILL.md) - Obsidian CLI reference
- [hooks/README.md](hooks/README.md) - Complete hooks reference
- [project-skills/service-skills-set/service-skills-readme.md](project-skills/service-skills-set/service-skills-readme.md) - Service Skills Set (Trinity) guide

### MCP Configuration
- [docs/mcp-servers-config.md](docs/mcp-servers-config.md) - MCP servers setup guide
- [config/mcp_servers.json](config/mcp_servers.json) - Core MCP servers (canonical source)
- [config/mcp_servers_optional.json](config/mcp_servers_optional.json) - Optional MCP servers

### Implementation Plans
- [docs/plans/](docs/plans/) - Design documents and implementation plans
- [docs/plans/complete/](docs/plans/complete/) - Completed implementation plans

## Version History

| Version | Date       | Highlights                                         |
| ------- | ---------- | -------------------------------------------------- |
| 1.7.0   | 2026-02-25 | GitNexus integration, unified 3-phase sync, MCP CLI sync, env management |
| 1.6.0   | 2026-02-24 | Documenting skill hardening (drift detection, INDEX blocks) |
| 1.5.0   | 2026-02-23 | Service Skills Set (Trinity), git hooks, auto-activation |
| 1.4.0   | 2026-02-23 | Delegating skill hardening, skill-suggestion hook enhancements |
| 1.3.0   | 2026-02-22 | CLI UX improvements (spinners, safety, feedback)   |
| 1.2.0   | 2026-02-21 | CLI rewritten in TypeScript, Commander.js sub-cmds |
| 1.1.1   | 2026-02-03 | Dynamic path resolution in Sync logic              |
| 1.1.0   | 2026-02-03 | Vault Sync, Orchestrating-agents loops             |
| 5.1.0   | 2026-01-30 | Renamed `p` to `prompt-improving`                  |
| 5.0.0   | 2026-01-30 | Major refactoring, 90% token reduction             |
| 4.2.0   | Pre-2026   | Feature-rich baseline (155KB)                      |

See [CHANGELOG.md](CHANGELOG.md) for complete version history.

## Repository Structure

```
jaggers-agent-tools/
├── README.md                    # This file
├── CHANGELOG.md                 # Version history
├── ROADMAP.md                   # Future plans
├── AGENTS.md                    # GitNexus quick reference
├── CLAUDE.md                    # Claude Code development guide
│
├── cli/                         # Config Manager CLI (TypeScript)
│   ├── src/
│   │   ├── index.ts             # Entry point (Commander program)
│   │   ├── commands/            # sync.ts, status.ts, reset.ts
│   │   ├── adapters/            # base, claude, gemini, qwen, registry
│   │   ├── core/                # context, diff, sync-executor, manifest, rollback
│   │   ├── utils/               # hash, atomic-config, config-adapter, env-manager, theme…
│   │   └── types/               # Zod schemas (config.ts) + shared interfaces (models.ts)
│   ├── dist/                    # Compiled output (generated by `npm run build`)
│   ├── tsconfig.json
│   ├── tsup.config.ts
│   └── package.json
│
├── skills/                      # Core agent skills
│   ├── prompt-improving/        # Prompt improvement skill
│   ├── delegating/              # Task delegation skill (CCS + unitAI)
│   ├── orchestrating-agents/    # Multi-agent collaboration skill
│   ├── using-serena-lsp/        # Serena LSP workflow
│   ├── documenting/             # Serena SSOT system (with drift detection)
│   ├── obsidian-cli/            # Obsidian CLI skill
│   ├── gitnexus/                # GitNexus knowledge graph skills (4 skills)
│   │   ├── exploring/           # Architecture understanding
│   │   ├── debugging/           # Bug tracing
│   │   ├── impact-analysis/     # Blast radius analysis
│   │   └── refactoring/         # Surgical refactors
│   ├── clean-code/              # Clean code principles
│   ├── docker-expert/           # Docker containerization expert
│   ├── python-testing/          # Python testing strategies
│   ├── python-type-safety/      # Python type safety
│   ├── senior-backend/          # Backend development expert
│   ├── senior-data-scientist/   # Data science expert
│   ├── senior-devops/           # DevOps expert
│   ├── senior-security/         # Security engineering expert
│   ├── skill-creator/           # Skill creation guide
│   └── find-skills/             # Skill discovery helper
│
├── hooks/                       # Claude Code hooks
│   ├── README.md                # Hooks documentation
│   ├── skill-suggestion.py      # Skill auto-suggestion
│   ├── skill-discovery.py       # SessionStart skill catalog injection
│   ├── serena-workflow-reminder.py # Serena reminder
│   ├── type-safety-enforcement.py # Type safety
│   ├── gitnexus/
│   │   └── gitnexus-hook.cjs    # PreToolUse knowledge graph enrichment
│   └── statusline.js            # Status line display
│
├── config/                      # Canonical configuration
│   ├── mcp_servers.json         # Core MCP servers
│   ├── mcp_servers_optional.json # Optional MCP servers (gitnexus, unitAI, omni-search)
│   └── settings.json            # Base settings template
│
├── project-skills/              # Project-specific service skills
│   └── service-skills-set/      # Trinity system for Docker service projects
│       ├── install-service-skills.py  # Installer script
│       ├── service-skills-readme.md   # Complete guide
│       └── .claude/
│           ├── settings.json    # Settings template with hooks
│           ├── creating-service-skills/
│           ├── using-service-skills/
│           ├── updating-service-skills/
│           ├── scoping-service-skills/
│           └── git-hooks/
│
├── docs/                        # Documentation
│   ├── mcp-servers-config.md    # MCP setup guide
│   ├── todo.md                  # TODO list
│   └── plans/                   # Implementation plans
│       ├── complete/            # Completed plans
│       └── *.md                 # Active design documents
│
└── .github/
    └── workflows/
        └── ci.yml               # CI/CD pipeline (lint, test, build)
```

## Contributing

Contributions are welcome. Please:

1. Follow existing code style
2. Update documentation for any changes
3. Test skills and hooks before submitting
4. Update CHANGELOG.md for all changes

## License

MIT License - See LICENSE file for details.

## Credits

- Developed by Dawid Jaggers
- Serena skills and hooks courtesy of Serena MCP project
- Built for Claude Code by Anthropic