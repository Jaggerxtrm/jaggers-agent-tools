---
title: MCP Servers Configuration and Sync
version: 3.1.0
updated: 2026-02-21
domain: cli
tracks:
  - "config/mcp_servers*.json"
  - "cli/src/**/*mcp*"
type: ssot
tags: [mcp, config, sync, claude, gemini, qwen, env]
changelog:
  - version: 3.1.0
    date: 2026-02-21
    description: Added centralized env file management at ~/.config/jaggers-agent-tools/.env. CLI auto-creates and validates required env vars.
  - version: 3.0.0
    date: 2026-02-21
    description: Unified MCP CLI sync for Claude, Gemini, and Qwen. All three agents now use official CLI commands.
  - version: 2.0.0
    date: 2026-02-21
    description: Split MCP config into core and optional servers. Added format adaptation for all 4 agents.
  - version: 1.0.0
    date: 2026-02-19
    description: Initial MCP servers configuration in Universal Hub.
---

# MCP Servers Configuration and Sync

## Overview

The MCP Servers Configuration provides a **canonical source** for MCP server definitions that syncs across all supported AI agents using their official CLI commands.

**Supported Agents:**

| Agent | Config Method | Command |
|-------|---------------|---------|
| **Claude Code** | Official CLI | `claude mcp add/remove/list` |
| **Gemini** | Official CLI | `gemini mcp add/remove/list` |
| **Qwen** | Official CLI | `qwen mcp add/remove/list` |
| **Antigravity** | JSON file sync | `~/.gemini/antigravity/mcp_config.json` |

---

## Configuration Files

### Core MCP Servers (`config/mcp_servers.json`)

**Installed by default** - essential servers for all users:

| Server | Type | Description | Prerequisites |
|--------|------|-------------|---------------|
| `serena` | stdio | Code analysis and LSP integration | `uvx` (uv package manager) |
| `context7` | http | Documentation lookup | API key required |
| `github-grep` | http | Code search across GitHub | None |
| `deepwiki` | http | Technical documentation | None |

### Optional MCP Servers (`config/mcp_servers_optional.json`)

**User choice** - prompted during sync (not yet implemented):

| Server | Type | Description | Prerequisites | Repository |
|--------|------|-------------|---------------|------------|
| `unitAI` | stdio | Multi-agent workflow orchestration | `npx` (Node.js) | https://github.com/Jaggerxtrm/unitAI |
| `omni-search-engine` | sse | Local search engine | Running service on port 8765 | https://github.com/Jaggerxtrm/omni-search-engine |

---

## Official MCP CLI Sync

**Implementation:** `cli/lib/sync-mcp-cli.js`

The sync system uses the official MCP CLI commands for Claude, Gemini, and Qwen:

### Claude Code Commands

```bash
# Add stdio server
claude mcp add -s local serena -- uvx --from git+https://github.com/oraios/serena \
  serena start-mcp-server --context ide-assistant

# Add HTTP server with headers
claude mcp add -s local --transport http context7 https://mcp.context7.com/mcp \
  --header "CONTEXT7_API_KEY: ${CONTEXT7_API_KEY}"

# List servers
claude mcp list -s local

# Remove server
claude mcp remove -s local <name>
```

### Gemini Commands

```bash
# Add stdio server with env vars
gemini mcp add serena uvx --from git+... serena start-mcp-server --context ide-assistant \
  --env KEY=value

# Add HTTP server with headers
gemini mcp add context7 https://mcp.context7.com/mcp \
  --header "CONTEXT7_API_KEY=${CONTEXT7_API_KEY}"

# List servers
gemini mcp list

# Remove server
gemini mcp remove <name>
```

### Qwen Commands

```bash
# Add stdio server with env vars
qwen mcp add serena uvx --from git+... serena start-mcp-server --context ide-assistant \
  --env KEY=value

# Add HTTP server with headers
qwen mcp add context7 https://mcp.context7.com/mcp \
  --header "CONTEXT7_API_KEY=${CONTEXT7_API_KEY}"

# List servers
qwen mcp list

# Remove server
qwen mcp remove <name>
```

---

## Sync Process

**Implementation:** `cli/lib/sync.js`

1. **Detect Agent** - From target directory (`.claude`, `.gemini`, `.qwen`)
2. **Load Canonical Config** - From `config/mcp_servers.json`
3. **Build Commands** - Agent-specific `mcp add` commands
4. **Execute** - Via `child_process.execSync()`
5. **Handle Existing** - "Already configured" = success (idempotent)
6. **Prune Mode** - Remove servers not in canonical config

### Code Flow

```javascript
// In sync.js
const agent = detectAgent(systemRoot); // 'claude', 'gemini', or 'qwen'
if (agent && actionType === 'sync') {
  const canonicalConfig = loadCanonicalMcpConfig(repoRoot);
  await syncMcpServersWithCli(agent, canonicalConfig, isDryRun, mode === 'prune');
}
```

---

## Agent-Specific Handling

### Claude Code
- **Scope:** `-s local` (also supports `user`, `project`)
- **Transport:** `--transport http|sse|stdio`
- **Headers:** `--header "Key: Value"`
- **Env Vars:** `-e KEY=value`

### Gemini
- **Transport:** Auto-detected from URL
- **Headers:** `--header "KEY=value"`
- **Env Vars:** `--env KEY=value`

### Qwen
- **Transport:** Auto-detected from URL
- **Headers:** `--header "KEY=value"`
- **Env Vars:** `--env KEY=value`

---

## Idempotent Sync

The sync is **idempotent** - running multiple times is safe:

**First run:**
```
✓ serena uvx --from git+...
✓ context7 https://mcp.context7.com/mcp
✓ github-grep https://mcp.grep.app
✓ deepwiki https://mcp.deepwiki.com/mcp
```

**Subsequent runs:**
```
✓ serena (already configured)
✓ context7 (already configured)
✓ github-grep (already configured)
✓ deepwiki (already configured)
```

---

## Environment Variables

**Location:** `~/.config/jaggers-agent-tools/.env`

The CLI automatically manages the environment file:

1. **First sync:** Creates `~/.config/jaggers-agent-tools/.env` if missing
2. **Validation:** Checks for required env vars and warns if missing
3. **Loading:** Loads env vars before sync
4. **Re-sync safe:** Existing values are preserved, file is not overwritten

**Required Variables:**
```bash
# Context7 MCP server API key
# Get your key from: https://context7.com/
CONTEXT7_API_KEY=ctx7sk-your-api-key-here
```

**Workflow:**
```bash
# 1. Run sync (creates .env if missing)
npx ./cli

# 2. Edit .env file
nano ~/.config/jaggers-agent-tools/.env

# 3. Add your API key
CONTEXT7_API_KEY=ctx7sk-actual-key-here

# 4. Re-run sync to apply
npx ./cli
```

**Example file:** `~/.config/jaggers-agent-tools/.env.example`

**Repo reference:** [`config/.env.example`](../../config/.env.example)

The sync resolves `${VAR}` references from `process.env` at runtime.

---

## Related Documentation

- [Universal Configuration Hub SSOT](ssot_cli_universal_hub_2026-02-19.md)
- [ConfigAdapter Source](../../cli/lib/config-adapter.js)
- [MCP CLI Sync Source](../../cli/lib/sync-mcp-cli.js)
- [MCP Servers Configuration Guide](../../docs/mcp-servers-config.md)
