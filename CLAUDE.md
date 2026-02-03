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
- `cli/lib/sync.js`: Logic for syncing/backporting configurations.
- `cli/lib/transform-gemini.js`: Logic for transforming Claude config to Gemini.
- `skills/delegating/config.yaml`: Configuration for delegation skill.
- `hooks/*.py`: Hook implementation scripts.

## Common Commands

### CLI Development
- `cd cli && npm install` - Install dependencies
- `npx ./cli` - Run config manager (from root)
- `node cli/index.js --reset` - Reset CLI context/config

### Hook Testing
- `python3 hooks/skill-suggestion.py` - Test hook logic manually
- `cat test-input.json | python3 hooks/skill-suggestion.py` - Test with input

### Documentation
- `PYTHONPATH=/home/dawid/.gemini/skills/documenting cd /home/dawid/.gemini/skills/documenting && python3 scripts/orchestrator.py /home/dawid/projects/jaggers-agent-tools feature "desc" --scope=skills --category=docs`
- `python3 /home/dawid/.gemini/skills/documenting/scripts/generate_template.py` - Create memory

## Gemini Support
- The CLI automatically detects `~/.gemini` environments.
- `/orchestrate` command is available via `.gemini/commands/orchestrate.toml`.
- **Command Sync**: Syncs custom slash commands from `.gemini/commands/`.
- **Auto-Command Generation**: Automatically transforms `SKILL.md` into Gemini `.toml` command files during sync.
- `settings.json` is dynamically transformed for Gemini compatibility:
  - Event names mapped (UserPromptSubmit -> BeforeAgent)
  - Paths rewritten to target directory
  - Unsupported fields filtered out
