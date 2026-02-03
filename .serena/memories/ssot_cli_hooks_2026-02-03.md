---
title: CLI Hook System
version: 1.0.0
updated: 2026-02-03
domain: cli
scope: cli-hooks
category: ssot
changelog:
  - 1.0.0: Initial documentation of the CLI hook system and recent timeout fixes.
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

## References
- `cli/lib/transform-gemini.js`
- `config/settings.json`
- `hooks/README.md`