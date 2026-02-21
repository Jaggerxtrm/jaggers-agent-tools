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

## Hooks

### Skill-Associated Hooks

**skill-suggestion.py**
- Skills: `prompt-improving`, `delegating`
- Trigger: UserPromptSubmit
- Purpose: Proactive skill suggestions based on prompt analysis
- Config: `settings.json` → `skillSuggestions.enabled: true`

**serena-workflow-reminder.py**
- Skill: `serena-lsp-workflow`
- Trigger: PreToolUse (Read|Edit|Grep)
- Purpose: Remind to use Serena semantic tools

### Standalone Hooks

**pip-venv-guard.py**
- Trigger: PreToolUse (Bash)
- Purpose: Prevent `pip install` outside virtual environments

**type-safety-enforcement.py**
- Trigger: PreToolUse (Bash)
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

**What it syncs per target environment:**

| Item            | Claude               | Gemini               | Qwen               |
| --------------- | -------------------- | -------------------- | ------------------ |
| `skills/`       | ✅ copy/symlink       | ✅ copy/symlink       | ✅ copy/symlink     |
| `hooks/`        | ✅ copy/symlink       | ✅ copy/symlink       | ✅ copy/symlink     |
| `settings.json` | ✅ safe merge         | ✅ safe merge         | ✅ safe merge       |
| MCP servers     | via `claude mcp add` | via `gemini mcp add` | via `qwen mcp add` |
| Slash commands  | auto-generated       | `.toml` files        | `.toml` files      |

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

Read-only diff view — no files written:

```bash
jaggers-config status
```

Shows the same `missing / outdated / drifted` breakdown as `sync`, but stops there.

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

### MCP Servers

MCP servers are configured from canonical sources with format adaptation for each agent.

**Core Servers** (installed by default):
- **serena**: Code analysis (requires `uvx`)
- **context7**: Documentation lookup (requires API key)
- **github-grep**: Code search across GitHub
- **deepwiki**: Technical documentation

**Optional Servers** (user choice during sync):
- **unitAI**: Multi-agent workflow orchestration
- **omni-search-engine**: Local search engine (requires running service)

**Configuration Files**:
- Core: [`config/mcp_servers.json`](config/mcp_servers.json)
- Optional: [`config/mcp_servers_optional.json`](config/mcp_servers_optional.json)
- Environment: [`config/.env.example`](config/.env.example)

**Environment Variables**:
- **Location:** `~/.config/jaggers-agent-tools/.env` (created automatically)
- **Required:** `CONTEXT7_API_KEY` for context7 server
- The CLI will create the `.env` file on first sync
- Edit `~/.config/jaggers-agent-tools/.env` to add your API keys
- Re-run sync after adding keys

**Supported Agents**:
- Claude Code (`~/.claude.json` - user-level MCP servers)
- Gemini (`gemini mcp` CLI)
- Qwen (`qwen mcp` CLI)
- Antigravity (`~/.gemini/antigravity/mcp_config.json`)

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

## Documentation

- [CHANGELOG.md](CHANGELOG.md) - Version history and breaking changes
- [ROADMAP.md](ROADMAP.md) - Future enhancements and planned features
- [skills/prompt-improving/README.md](skills/prompt-improving/README.md) - Detailed skill documentation
- [skills/delegating/SKILL.md](skills/delegating/SKILL.md) - Delegation workflow guide
- [hooks/README.md](hooks/README.md) - Complete hooks reference

## Version History

| Version | Date       | Highlights                                         |
| ------- | ---------- | -------------------------------------------------- |
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
├── cli/                         # Config Manager CLI (TypeScript)
│   ├── src/
│   │   ├── index.ts             # Entry point (Commander program)
│   │   ├── commands/            # sync.ts, status.ts, reset.ts
│   │   ├── adapters/            # base, claude, gemini, qwen, registry
│   │   ├── core/                # context, diff, sync-executor, manifest, rollback
│   │   ├── utils/               # hash, atomic-config, config-adapter, env-manager…
│   │   └── types/               # Zod schemas (config.ts) + shared interfaces (models.ts)
│   ├── dist/                    # Compiled output (generated by `npm run build`)
│   ├── tsconfig.json
│   ├── tsup.config.ts
│   └── package.json
├── skills/
│   ├── prompt-improving/        # Prompt improvement skill
│   ├── delegating/              # Task delegation skill
│   ├── orchestrating-agents/    # Multi-agent collaboration skill
│   ├── using-serena-lsp/        # Serena LSP workflow
│   └── documenting/             # Serena SSOT system
├── hooks/
│   ├── README.md                # Hooks documentation
│   ├── skill-suggestion.py      # Skill auto-suggestion
│   ├── pip-venv-guard.py        # Venv enforcement
│   ├── serena-workflow-reminder.py # Serena reminder
│   ├── type-safety-enforcement.py # Type safety
│   └── statusline.js            # Status line display
├── config/
│   ├── mcp_servers.json         # Canonical core MCP servers
│   ├── mcp_servers_optional.json
│   └── settings.json            # Base settings template
└── docs/
    ├── mcp-servers-config.md    # MCP setup guide
    └── plans/                   # Implementation & deferred plans
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