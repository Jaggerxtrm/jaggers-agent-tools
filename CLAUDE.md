# Claude Code Guide for Jaggers Agent Tools

## Architecture
- **Skills**: stored in `skills/`. Each skill has `SKILL.md` and optional `README.md`.
- **Hooks**: stored in `hooks/`. Python scripts (`.py`) for lifecycle events.
- **Config**: stored in `config/`. `settings.json` template.
- **CLI**: stored in `cli/`. Node.js tool for installation and sync.
- **Documentation**: stored in `docs/` and `.serena/memories/` (SSOT).

## Development Environment
- **Runtime**: Node.js (CLI), Python 3.8+ (Hooks/Scripts)
- **Dependencies**:
  - CLI: `npm install` in `cli/`
  - Python: Standard library only (no external deps for hooks)

## Key Files & Directories
- `cli/lib/sync.js`: Logic for syncing/backporting configurations. Includes dynamic path resolution for hardcoded repo paths.
- `cli/lib/transform-gemini.js`: Logic for transforming Claude config to Gemini.

## Gemini Support
- The CLI automatically detects `~/.gemini` environments.
- **Slash Commands**: Specialized commands available: `/orchestrate`, `/delegate`, `/document`, `/prompt`.
- **Command Sync**: Syncs custom slash commands from `.gemini/commands/`.
- **Auto-Command Generation**: Automatically transforms `SKILL.md` into Gemini `.toml` command files during sync.
- **Path Resolution**: Fixes hardcoded paths in `settings.json` templates by dynamically resolving them to the user's target installation directory.
- `settings.json` is dynamically transformed for Gemini compatibility:
  - Event names mapped (UserPromptSubmit -> BeforeAgent)
  - Paths rewritten to target directory
  - Unsupported fields filtered out

### Documentation
- `export PYTHONPATH=$PYTHONPATH:$(pwd)/skills/documenting && python3 skills/documenting/scripts/orchestrator.py . feature "desc" --scope=skills --category=docs`
- `python3 skills/documenting/scripts/generate_template.py` - Create memory
