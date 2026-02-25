# Claude Code Guide for Jaggers Agent Tools

## Architecture
- **Skills**: stored in `skills/`. Each skill has `SKILL.md` and optional `README.md`.
- **Hooks**: stored in `hooks/`. Python scripts (`.py`) for lifecycle events.
- **Config**: stored in `config/`. `settings.json` template.
- **CLI**: stored in `cli/`. Node.js tool for installation and sync.
- **Documentation**: stored in `docs/` and `.serena/memories/` (SSOT).

## CI/CD
- **GitHub Actions**: Workflows in `.github/workflows/ci.yml`.
- **Validation**:
  - `npm run lint`: Lint Node.js (Eslint) and Python (Ruff).
  - `npm test`: Run global test suite.
  - `pytest skills/documenting/tests`: Run documenting skill tests.

## Development Environment
- **Runtime**: Node.js (CLI), Python 3.8+ (Hooks/Scripts)
- **Dependencies**:
  - CLI: `npm install` in `cli/`
  - Python: Standard library only (no external deps for hooks)

## Key Files & Directories
- `cli/lib/sync.js`: Logic for syncing/backporting configurations. Includes dynamic path resolution for hardcoded repo paths.
- `cli/lib/transform-gemini.js`: Logic for transforming Claude config to Gemini.
- `skills/orchestrating-agents/`: Multi-agent orchestration skill with parameter support.
  - `SKILL.md`: Skill definition with `gemini-args` for workflow type selection.
  - `references/handover-protocol.md`: CLI resume flags (Gemini: `-r latest`, Qwen: `-c`).
  - `references/workflows.md`: Multi-turn workflow protocols (Collaborative, Adversarial, Troubleshoot).

## Gemini Support
- The CLI automatically detects `~/.gemini` environments.
- **Slash Commands**: Specialized commands available: `/orchestrate`, `/delegate`, `/document`, `/prompt`.
  - `/orchestrate` supports workflow parameters: `/orchestrate [collaborative|adversarial|troubleshoot|handshake] "task"`
- **Command Sync**: Syncs custom slash commands from `.gemini/commands/`.
- **Auto-Command Generation**: Automatically transforms `SKILL.md` into Gemini `.toml` command files during sync.
  - Supports `gemini-args` for parameterized commands with choice/string types.
- **Path Resolution**: Fixes hardcoded paths in `settings.json` templates by dynamically resolving them to the user's target installation directory.
- `settings.json` is dynamically transformed for Gemini compatibility:
  - Event names mapped (UserPromptSubmit -> BeforeAgent)
  - Paths rewritten to target directory
  - Unsupported fields filtered out

### Multi-Agent CLI Flags
- **Gemini**: Use `-r latest` or `-r <index>` to resume sessions (not `--resume`)
- **Qwen**: Use `-c` or `--continue` to resume most recent session

### Documentation
- `export PYTHONPATH=$PYTHONPATH:$(pwd)/skills/documenting && python3 skills/documenting/scripts/orchestrator.py . feature "desc" --scope=skills --category=docs`
- `python3 skills/documenting/scripts/generate_template.py` - Create memory

<!-- gitnexus:start -->
# GitNexus MCP

This project is indexed by GitNexus as **jaggers-agent-tools** (1900 symbols, 4715 relationships, 135 execution flows).

GitNexus provides a knowledge graph over this codebase — call chains, blast radius, execution flows, and semantic search.

## Always Start Here

For any task involving code understanding, debugging, impact analysis, or refactoring, you must:

1. **Read `gitnexus://repo/{name}/context`** — codebase overview + check index freshness
2. **Match your task to a skill below** and **read that skill file**
3. **Follow the skill's workflow and checklist**

> If step 1 warns the index is stale, run `npx gitnexus analyze` in the terminal first.

## Skills

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/refactoring/SKILL.md` |

## Tools Reference

| Tool | What it gives you |
|------|-------------------|
| `query` | Process-grouped code intelligence — execution flows related to a concept |
| `context` | 360-degree symbol view — categorized refs, processes it participates in |
| `impact` | Symbol blast radius — what breaks at depth 1/2/3 with confidence |
| `detect_changes` | Git-diff impact — what do your current changes affect |
| `rename` | Multi-file coordinated rename with confidence-tagged edits |
| `cypher` | Raw graph queries (read `gitnexus://repo/{name}/schema` first) |
| `list_repos` | Discover indexed repos |

## Resources Reference

Lightweight reads (~100-500 tokens) for navigation:

| Resource | Content |
|----------|---------|
| `gitnexus://repo/{name}/context` | Stats, staleness check |
| `gitnexus://repo/{name}/clusters` | All functional areas with cohesion scores |
| `gitnexus://repo/{name}/cluster/{clusterName}` | Area members |
| `gitnexus://repo/{name}/processes` | All execution flows |
| `gitnexus://repo/{name}/process/{processName}` | Step-by-step trace |
| `gitnexus://repo/{name}/schema` | Graph schema for Cypher |

## Graph Schema

**Nodes:** File, Function, Class, Interface, Method, Community, Process
**Edges (via CodeRelation.type):** CALLS, IMPORTS, EXTENDS, IMPLEMENTS, DEFINES, MEMBER_OF, STEP_IN_PROCESS

```cypher
MATCH (caller)-[:CodeRelation {type: 'CALLS'}]->(f:Function {name: "myFunc"})
RETURN caller.name, caller.filePath
```

<!-- gitnexus:end -->
