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

- **Invocation**: `/prompt-improving "raw prompt"`
- **Purpose**: Applies semantic XML structure, multishot examples, and chain-of-thought patterns
- **Hook**: `skill-suggestion.sh`
- **Version**: 5.1.0

### ccs-delegation

Delegates deterministic tasks to cost-optimized models via CCS CLI.

- **Invocation**: `/ccs [task]` or `use ccs [task]`
- **Purpose**: Execute simple tasks (tests, refactors, typos, docs) on cheaper models
- **Hook**: `skill-suggestion.sh`
- **Version**: 5.0.0

### serena-lsp-workflow

Master workflow combining Serena MCP semantic tools with LSP plugins for efficient code editing.

- **Invocation**: Auto-suggested via hooks
- **Purpose**: Surgical code editing with 75-80% token savings
- **Hook**: `serena-workflow-reminder.sh`
- **Origin**: Serena MCP

### serena-ssot-documentation

Maintains Single Source of Truth documentation system for projects.

- **Invocation**: Skill commands for memory management
- **Purpose**: Create, update, validate SSOT documentation
- **Hook**: None
- **Origin**: Serena MCP

## Hooks

### Skill-Associated Hooks

**skill-suggestion.sh**
- Skills: `prompt-improving`, `ccs-delegation`
- Trigger: UserPromptSubmit
- Purpose: Proactive skill suggestions based on prompt analysis
- Config: `settings.json` → `skillSuggestions.enabled: true`

**serena-workflow-reminder.sh**
- Skill: `serena-lsp-workflow`
- Trigger: PreToolUse (Read|Edit|Grep)
- Purpose: Remind to use Serena semantic tools

### Standalone Hooks

**pip-venv-guard.sh**
- Trigger: PreToolUse (Bash)
- Purpose: Prevent `pip install` outside virtual environments

**type-safety-enforcement.sh**
- Trigger: PreToolUse (Bash)
- Purpose: Enforce type safety in Python code

**statusline.js**
- Trigger: StatusLine
- Purpose: Display custom status line information

**gsd-check-update.js**
- Trigger: SessionStart
- Purpose: Check for Get Shit Done workflow updates

## Installation

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

4. Configure hooks in `~/.claude/settings.json`:
   ```json
   {
     "hooks": {
       "UserPromptSubmit": [{
         "hooks": [{
           "type": "command",
           "command": "/home/user/.claude/hooks/skill-suggestion.sh",
           "timeout": 1
         }]
       }],
       "PreToolUse": [{
         "matcher": "Bash",
         "hooks": [{
           "type": "command",
           "command": "/bin/bash /home/user/.claude/hooks/pip-venv-guard.sh",
           "timeout": 3
         }]
       }]
     },
     "skillSuggestions": {
       "enabled": true
     }
   }
   ```

### Symlink Installation (Recommended)

Maintain live connection to repository for easy updates:

```bash
# Skills
ln -s /path/to/jaggers-agent-tools/skills/prompt-improving ~/.claude/skills/
ln -s /path/to/jaggers-agent-tools/skills/ccs-delegation ~/.claude/skills/

# Hooks
for hook in /path/to/jaggers-agent-tools/hooks/*; do
  ln -s "$hook" ~/.claude/hooks/
done
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
        "timeout": 1  // Increase if hooks timeout frequently
      }]
    }]
  }
}
```

## Documentation

- [CHANGELOG.md](CHANGELOG.md) - Version history and breaking changes
- [ROADMAP.md](ROADMAP.md) - Future enhancements and planned features
- [skills/prompt-improving/README.md](skills/prompt-improving/README.md) - Detailed skill documentation
- [skills/ccs-delegation/README.md](skills/ccs-delegation/README.md) - Delegation workflow guide
- [hooks/README.md](hooks/README.md) - Complete hooks reference

## Version History

| Version | Date       | Highlights                             |
| ------- | ---------- | -------------------------------------- |
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
├── skills/
│   ├── prompt-improving/        # Prompt improvement skill
│   ├── ccs-delegation/          # Task delegation skill
│   ├── serena-lsp-workflow/     # Serena LSP workflow
│   └── serena-ssot-documentation/ # Serena SSOT system
└── hooks/
    ├── README.md                # Hooks documentation
    ├── skill-suggestion.sh      # Skill auto-suggestion
    ├── pip-venv-guard.sh        # Venv enforcement
    ├── serena-workflow-reminder.sh # Serena reminder
    ├── type-safety-enforcement.sh # Type safety
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
