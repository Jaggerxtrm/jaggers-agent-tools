# Hooks

Claude Code hooks that extend agent behavior with automated checks, suggestions, and workflow enhancements.

## Overview

Hooks intercept specific events in the Claude Code lifecycle to provide:
- Proactive skill suggestions
- Safety guardrails (venv enforcement, type checking)
- Workflow reminders
- Status information

## Skill-Associated Hooks

### skill-suggestion.sh

**Purpose**: Proactively suggests `/prompt-improving` or `/ccs` delegation based on prompt analysis.

**Trigger**: UserPromptSubmit

**Skills**: 
- `prompt-improving` - Suggested for short/generic prompts
- `ccs-delegation` - Suggested for simple, delegatable tasks

**Configuration**:
```json
{
  "hooks": {
    "UserPromptSubmit": [{
      "hooks": [{
        "type": "command",
        "command": "/home/user/.claude/hooks/skill-suggestion.sh",
        "timeout": 1
      }]
    }]
  },
  "skillSuggestions": {
    "enabled": true
  }
}
```

**Pattern Matching**:
- Bilingual support (Italian + English)
- Flexible synonyms (e.g., `correggi|fix|sistema|repair`)
- Wildcard matching for partial words

**Performance**: Sub-100ms execution, no LLM calls

### serena-workflow-reminder.sh

**Purpose**: Reminds to use Serena MCP semantic tools for code exploration.

**Trigger**: PreToolUse (Read|Edit|Grep)

**Skill**: `serena-lsp-workflow`

**Configuration**:
```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "Read|Edit|Grep",
      "hooks": [{
        "type": "command",
        "command": "/home/user/.claude/hooks/serena-workflow-reminder.sh",
        "timeout": 5
      }]
    }]
  }
}
```

**Benefits**: 75-80% token savings through semantic symbol-level access

## Standalone Hooks

### pip-venv-guard.sh

**Purpose**: Prevents accidental `pip install` outside virtual environments.

**Trigger**: PreToolUse (Bash)

**Behavior**:
- Checks for `pip install` or `pip3 install` commands
- Verifies `VIRTUAL_ENV` environment variable
- Searches for common venv directory names (`.venv`, `venv`, `env`)
- Blocks execution if no venv detected
- Allows install if venv is active

**Configuration**:
```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "Bash",
      "hooks": [{
        "type": "command",
        "command": "/bin/bash /home/user/.claude/hooks/pip-venv-guard.sh",
        "timeout": 3
      }]
    }]
  }
}
```

**Example Output**:
```
WARNING: Attempting pip install outside virtual environment

Found virtual environment at: .venv
Activate it first:
  source .venv/bin/activate

Then run your pip install command again.
```

### type-safety-enforcement.sh

**Purpose**: Enforces type safety checks in Python code before execution.

**Trigger**: PreToolUse (Bash)

**Checks**:
- Runs `mypy` or `pyright` on modified Python files
- Validates type annotations
- Reports type errors before code execution

**Configuration**:
```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "Bash",
      "hooks": [{
        "type": "command",
        "command": "/home/user/.claude/hooks/type-safety-enforcement.sh",
        "timeout": 5
      }]
    }]
  }
}
```

### statusline.js

**Purpose**: Displays custom status line information in Claude Code.

**Trigger**: StatusLine

**Information Displayed**:
- Current Git branch
- Workspace status
- Active virtual environment
- Custom project metadata

**Configuration**:
```json
{
  "statusLine": {
    "type": "command",
    "command": "node \"/home/user/.claude/hooks/statusline.js\""
  }
}
```

### gsd-check-update.js

**Purpose**: Checks for Get Shit Done workflow updates at session start.

**Trigger**: SessionStart

**Behavior**:
- Queries GSD update server
- Notifies if new workflow versions available
- Displays changelog summary

**Configuration**:
```json
{
  "hooks": {
    "SessionStart": [{
      "hooks": [{
        "type": "command",
        "command": "node \"$HOME/.claude/hooks/gsd-check-update.js\""
      }]
    }]
  }
}
```

## Hook Types Reference

### UserPromptSubmit
Triggered when user submits a prompt, before Claude processes it.

**Use cases**:
- Prompt analysis and suggestions
- Input validation
- Automated prompt improvements

### PreToolUse
Triggered before a tool is used by Claude.

**Use cases**:
- Safety checks (venv, type safety)
- Workflow reminders
- Tool usage validation

**Matcher patterns**: Regex matching tool names (e.g., `Bash|Python`, `Read|Edit`)

### SessionStart
Triggered at the beginning of each Claude Code session.

**Use cases**:
- Update checks
- Environment validation
- Session initialization

### StatusLine
Triggered when rendering the status line.

**Use cases**:
- Display custom information
- Show project metadata
- Git/environment status

## Installation

1. Copy hooks to Claude Code directory:
   ```bash
   cp hooks/* ~/.claude/hooks/
   ```

2. Make shell scripts executable:
   ```bash
   chmod +x ~/.claude/hooks/*.sh
   ```

3. Configure hooks in `~/.claude/settings.json` (see individual hook sections above)

4. Restart Claude Code to activate hooks

## Troubleshooting

**Hook not executing**
- Check hook is executable: `ls -l ~/.claude/hooks/`
- Verify path in `settings.json` matches actual file location
- Check hook timeout is sufficient
- Review Claude Code console for errors

**Hook timing out**
- Increase timeout value in `settings.json`
- Optimize hook script for faster execution
- Check for network calls or heavy processing

**Suggestions not appearing**
- Verify `skillSuggestions.enabled: true` in settings
- Check hook is registered for correct trigger
- Test hook manually: `bash ~/.claude/hooks/skill-suggestion.sh`

**False positives**
- Adjust pattern matching in hook scripts
- Customize exclusion patterns
- Disable specific hooks if not needed

## Related Documentation

- [Main README](../README.md)
- [Skills Documentation](../skills/)
- [CHANGELOG](../CHANGELOG.md)
- [Claude Code Hooks Reference](https://docs.anthropic.com/hooks)
