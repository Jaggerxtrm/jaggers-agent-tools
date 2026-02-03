# Jaggers Agent Tools

Custom skills, hooks, and commands for Claude Code. This repository contains production-ready extensions to enhance Claude's capabilities with prompt improvement, task delegation, and development workflow automation.

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

- **Invocation**: `/orchestrate [task]`
- **Purpose**: Facilitates multi-model collaboration, adversarial reviews, and deep troubleshooting.
- **Workflows**:
  - **Collaborative Design**: Proposal -> Critique -> Refinement (for features).
  - **Adversarial Review**: Proposal -> Red Team Attack -> Defense (for security).
  - **Troubleshoot Session**: Multi-agent hypothesis testing (for emergencies).
- **Hook**: None (Direct slash command)
- **Version**: 1.1.0

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

**gsd-check-update.js**
- Trigger: SessionStart
- Purpose: Check for Get Shit Done workflow updates

## Installation

### Smart Installation (Recommended)

Use the interactive Config Manager to automate installation, synchronization, and `settings.json` configuration.

```bash
# Clone the repository
git clone https://github.com/yourusername/jaggers-agent-tools.git
cd jaggers-agent-tools

# Run the manager
npx ./cli
```

The Config Manager will:
1. **Detect** your agent configuration path (`~/.claude`, `~/.gemini`, etc.).
2. **Scan** for differences between the repo and your system.
3. **Install/Update** skills and hooks using your preferred strategy (Copy or Symlink).
4. **Vault Sync (New)**: Protects your local secrets (MCP API keys, OAuth tokens) during synchronization. It performs a non-destructive merge where local secrets are preserved and new repository features are added atomically.
5. **Dry Run**: Support for `--dry-run` flag to preview changes without modifying files.
6. **Configure** `settings.json` automatically to register hooks (supports both Claude and Gemini formats).
7. **Sync Gemini Commands**: Synchronizes custom slash commands from `.gemini/commands/` to the Gemini environment.
8. **Auto-Command Generation**: Automatically transforms `SKILL.md` files into Gemini `.toml` command files during synchronization.

### Manual Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/yourusername/jaggers-agent-tools.git
   cd jaggers-agent-tools
   ```

2. Copy skills to Claude Code:
   ```bash
   cp -r skills/* ~/.claude/skills/
   ```

3. Copy hooks to Claude Code:
   ```bash
   cp hooks/* ~/.claude/hooks/
   chmod +x ~/.claude/hooks/*.sh
   ```

## Configuration

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
        "timeout": 5000  // Values in ms for Gemini, seconds for Claude
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

| Version | Date       | Highlights                             |
| ------- | ---------- | -------------------------------------- |
| 1.1.0   | 2026-02-03 | Vault Sync, Orchestrating-agents loops |
| 1.0.0   | 2026-02-03 | Initial orchestrating-agents & CLI     |
| 5.1.0   | 2026-01-30 | Renamed `p` to `prompt-improving`      |
| 5.0.0   | 2026-01-30 | Major refactoring, 90% token reduction |
| 4.2.0   | Pre-2026   | Feature-rich baseline (155KB)          |

See [CHANGELOG.md](CHANGELOG.md) for complete version history.

## Repository Structure

```
jaggers-agent-tools/
├── README.md                    # This file
├── CHANGELOG.md                 # Version history
├── ROADMAP.md                   # Future plans
├── cli/                         # Config Manager CLI
├── skills/
│   ├── prompt-improving/        # Prompt improvement skill
│   ├── delegating/              # Task delegation skill
│   ├── orchestrating-agents/    # Multi-agent collaboration skill
│   ├── using-serena-lsp/        # Serena LSP workflow
│   └── documenting/             # Serena SSOT system
└── hooks/
    ├── README.md                # Hooks documentation
    ├── skill-suggestion.py      # Skill auto-suggestion
    ├── pip-venv-guard.py        # Venv enforcement
    ├── serena-workflow-reminder.py # Serena reminder
    ├── type-safety-enforcement.py # Type safety
    ├── statusline.js            # Status line display
    └── gsd-check-update.js      # GSD updates
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