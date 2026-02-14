# Hooks

Claude Code hooks that extend agent behavior with automated checks, suggestions, and workflow enhancements.

## Overview

Hooks intercept specific events in the Claude Code lifecycle to provide:
- Proactive skill suggestions
- Safety guardrails (venv enforcement, type checking)
- Workflow reminders
- Status information

## Skill-Associated Hooks

### skill-suggestion.py

**Purpose**: Proactively suggests `/prompt-improving` or `/delegating` based on prompt analysis.

**Trigger**: UserPromptSubmit

**Skills**: 
- `prompt-improving` - Suggested for short/generic prompts
- `delegating` - Suggested for simple tasks or explicit delegation requests

**Configuration**:
```json
{
  "hooks": {
    "UserPromptSubmit": [{
      "hooks": [{
        "type": "command",
        "command": "/home/user/.claude/hooks/skill-suggestion.py",
        "timeout": 5000  // Claude: seconds (5000s), Gemini: milliseconds (5s)
      }]
    }]
  },
  "skillSuggestions": {
    "enabled": true
  }
}
```

### serena-workflow-reminder.py

**Purpose**: Enforces semantic workflow using "Using Serena LSP".

**Triggers**: 
- `SessionStart`: Injects skill context.
- `PreToolUse` (Read|Edit): Blocks inefficient usage.

**Skill**: `using-serena-lsp`

**Configuration**:
```json
{
  "hooks": {
    "SessionStart": [{
      "hooks": [{ "type": "command", "command": "/home/user/.claude/hooks/serena-workflow-reminder.py" }]
    }],
    "PreToolUse": [{
      "matcher": "Read|Edit",
      "hooks": [{ "type": "command", "command": "/home/user/.claude/hooks/serena-workflow-reminder.py" }]
    }]
  }
}
```

## Standalone Hooks

### pip-venv-guard.py

**Purpose**: Prevents accidental `pip install` outside virtual environments.

**Trigger**: PreToolUse (Bash)

**Configuration**:
```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "Bash",
      "hooks": [{
        "type": "command",
        "command": "/home/user/.claude/hooks/pip-venv-guard.py",
        "timeout": 3000  // 3 seconds in milliseconds (both Claude & Gemini)
      }]
    }]
  }
}
```

### type-safety-enforcement.py

**Purpose**: Enforces type safety checks in Python code before execution.

**Trigger**: PreToolUse (Bash, Edit, Write)

**Configuration**:
```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "Bash|Edit|Write",
      "hooks": [{
        "type": "command",
        "command": "/home/user/.claude/hooks/type-safety-enforcement.py",
        "timeout": 10000  // 10 seconds in milliseconds (both Claude & Gemini)
      }]
    }]
  }
}
```

### statusline.js

**Purpose**: Displays custom status line information.
**Trigger**: StatusLine

## Installation

1. Copy hooks to Claude Code directory:
   ```bash
   cp hooks/* ~/.claude/hooks/
   ```

2. Make scripts executable:
   ```bash
   chmod +x ~/.claude/hooks/*.py ~/.claude/hooks/*.js
   ```

3. Configure hooks in `~/.claude/settings.json`.

4. Restart Claude Code.