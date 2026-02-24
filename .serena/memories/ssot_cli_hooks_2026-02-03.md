---
title: CLI Hook System
version: 1.1.0
updated: 2026-02-23
domain: cli
tracks:
  - "hooks/**"
  - "config/settings.json"
scope: cli-hooks
category: ssot
changelog:
  - 1.0.0: Initial documentation of the CLI hook system and recent timeout fixes.
  - 1.1.0: Document skill-suggestion.py orchestration patterns and CLAUDECODE detection added in delegating skill hardening.
---

# CLI Hook System

The Jaggers Agent Tools CLI includes a hook system that intercepts agent actions (like prompt submission or tool use) to perform validation, security checks, or context injection.

## Architecture

The system bridges Claude's hook configuration (defined in `config/settings.json`) and Gemini CLI's hook requirements.

- **Source Config**: `config/settings.json` (Claude-style YAML/JSON).
- **Transformation Logic**: `cli/lib/transform-gemini.js` converts Claude hooks to Gemini `BeforeAgent` and `BeforeTool` events.
- **Hook Locations**: Custom Python/JS scripts in the `hooks/` directory.

## Implementation Details

### Timeout Management
Gemini CLI expects hook timeouts in **milliseconds**.
- **Automatic Conversion**: The `transformGeminiConfig` function handles unit mismatches. If a timeout in `settings.json` is `< 1000`, it is treated as seconds and automatically converted to milliseconds for Gemini.
- **Defaults**: Default timeout is 60,000ms (60 seconds).

### Hook Naming
To improve debuggability, hooks are assigned names during transformation:
1. **Explicit Name**: Uses the `name` field if present in `settings.json`.
2. **Derived Name**: Extracts the filename from the command string (e.g., `skill-suggestion.py`).
3. **Fallback**: `hook-${index}`.

## Critical Settings

- **`skill-suggestion.py`**: Requires ~5s timeout for regex and processing.
- **`type-safety-enforcement.py`**: Requires ~30s timeout to allow `mypy` or `pyright` checks to complete on large files.

## skill-suggestion.py — Pattern Details

Fires on every `UserPromptSubmit`. Injects `system_message` hints when task patterns are detected.

### Pattern Groups

| Group | Patterns | Action |
|-------|----------|--------|
| `CONVERSATIONAL_PATTERNS` | hello, thanks, ok, yes/no, bye | Silent pass-through |
| `EXCLUDE_PATTERNS` | architecture, `(add\|implement).*auth`, performance, migrate | Silent pass-through |
| Explicit delegation | `delegate` keyword | Hint: use /delegating |
| `CCS_PATTERNS` | typo, test, doc, format, lint, type hints, rename | Hint: /delegating (CCS or Gemini/Qwen if $CLAUDECODE set) |
| `ORCHESTRATION_PATTERNS` | code review, security audit, implement feature, debug, refactor sprint, validate commit | Hint: /delegating (Gemini+Qwen orchestration) |
| `P_PATTERNS` | analyze, implement, explain, vague short commands | Hint: /prompt-improving |

### CLAUDECODE Detection
When `$CLAUDECODE` env var is set (i.e., running inside a Claude Code session), CCS hints correctly say "Gemini or Qwen directly (CCS unavailable inside Claude Code)" instead of "CCS backend".

### Security Exclusion Nuance
`security` alone does NOT exclude — only `(add|implement|fix|patch).*(security|auth|oauth)` does. This allows security *review* tasks to route to orchestration while blocking security *implementation*.

## References
- `cli/lib/transform-gemini.js`
- `config/settings.json`
- `hooks/skill-suggestion.py`
- `hooks/README.md`
