# ECC Integration Roadmap

These are features to be adapted to our workflows, and I'll work on them in the future.

## Continuous Learning v2 (Homunculus)
Description: Automated pattern extraction from session activity via PreToolUse/PostToolUse hooks. Logs tool usage to a local JSONL file for a background observer agent to extract "instincts."
Source: https://github.com/affaan-m/everything-claude-code/tree/main/skills/continuous-learning-v2
Install Method: Create `hooks/observe.sh`, configure `PostToolUse` in `settings.json`, and set up the `~/.claude/homunculus` directory.

## Specialized Subagents
Description: Domain-specific personas (planner, architect, tdd-guide, code-reviewer) for focused delegation. Reduces context bloat by narrowing the expert's scope.
Source: https://github.com/affaan-m/everything-claude-code/tree/main/agents
Install Method: Create an `agents/` directory and port individual `.md` persona files.

## Workflow Commands
Description: Slash commands for standardized procedures:
- `/plan`: Requirements analysis and risk assessment.
- `/tdd`: Red-Green-Refactor enforcement.
- `/verify`: Build, Lint, Type-check, and Test sequence.
- `/codemap`: Maintenance of a token-efficient repository map.
Source: https://github.com/affaan-m/everything-claude-code/tree/main/commands
Install Method: Implement as individual skills in `skills/` or direct commands in `cli/src/commands`.

## Modular Rules System
Description: Replacing a monolithic CLAUDE.md with granular rules (e.g., security.md, testing.md).
Source: https://github.com/affaan-m/everything-claude-code/tree/main/rules
Install Method: Create a `rules/` directory and update the config-adapter to load files dynamically based on scope.

## Advanced MCP Servers
Description:
- **GitHub**: Repository, PR, and Issue management.
- **Firecrawl**: Deep web scraping for documentation.
- **Sequential Thinking**: Structured reasoning for complex logic.
Source: https://github.com/affaan-m/everything-claude-code/blob/main/mcp-configs/mcp-servers.json
Install Method: Add definitions to `config/mcp_servers.json` and sync via CLI.

## Strategic Tools
Description:
- **mgrep**: Semantic search with a `--web` flag for instant documentation access.
- **ralph-wiggum**: Loop automation for bulk error resolution (e.g., fixing 20 tests).
Source: https://github.com/mixedbread-ai/mgrep (mgrep), https://github.com/affaan-m/everything-claude-code (ralph)
Install Method: Install `mgrep` via plugin marketplace; add `ralph` as a loop-control skill.
