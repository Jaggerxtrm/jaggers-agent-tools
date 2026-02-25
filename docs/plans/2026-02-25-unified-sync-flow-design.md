# Unified Sync Flow Design

**Date:** 2026-02-25
**Status:** Approved
**Replaces:** `sync` + `add-optional` split flow

---

## Goal

Replace the current fragmented sync experience (multiple mid-flow prompts, separate `add-optional` command, per-target confirmations) with a single unified `sync` command that runs all checks upfront, presents one interactive plan, and executes without further interruption.

---

## Problem Summary

Current flow blocks users repeatedly:
1. Spinner — detect environments
2. Per-target diff — per-target prompt
3. MCP sync runs mid-flow with no prior visibility
4. Optional servers only discoverable via separate `add-optional` command
5. Drifted items shown in plan but silently skipped (user only learns after)
6. Prerequisite installs interleaved with MCP sync output

---

## Architecture

### Three Phases

```
Phase 1: Preflight   (parallel, no prompts)
Phase 2: Plan        (interactive multiselect, one confirmation)
Phase 3: Execute     (ordered, no further prompts)
```

### Phase 1 — Preflight (parallel)

Run all checks concurrently via `Promise.all`:

| Check | What it does |
|-------|-------------|
| `detectEnvironments` | Scan for .claude / .gemini / .qwen targets |
| `calculateAllDiffs` | File diff (skills/hooks/config) across all targets |
| `getMcpServerState` | `claude/gemini/qwen mcp list` per target |
| `loadOptionalServers` | Read mcp_servers_optional.json, filter not-yet-installed |
| `checkPrerequisites` | Test binaries: uvx, npm, per-server install_cmd tools |

Single spinner while running, then summary:
```
Checking 3 environments...
OK — 12 changes across 3 targets (2 optional available)
```

### Phase 2 — Unified Plan (interactive multiselect)

Display using `prompts` multiselect. All items pre-checked by default except drifted and optional server items.

**Item types and default selection:**

| Symbol | Meaning | Default |
|--------|---------|---------|
| `[+]` | New (missing from target) | selected |
| `[up]` | Outdated (repo is newer) | selected |
| `[~]` | Drifted (local edits exist) | deselected — skip recommended |
| `[=]` | Already installed, no action | greyed, unselectable |
| `[?]` | Optional server not installed | deselected — user opt-in |
| `[pkg]` | Prerequisite install | mirrors parent optional selection |

**Grouping order:**
1. Files (skills, hooks, config) — per target
2. MCP Servers (core) — per target
3. Optional Servers — global
4. Prerequisites — bottom, linked to parent optional

**Prerequisite linking:** Selecting/deselecting an optional server automatically selects/deselects its linked `install_cmd` entry.

**Controls:**
```
space   = toggle item
a       = toggle all
enter   = confirm
ctrl+c  = abort
```

Footer:
```
11 selected · 1 skipped · --dry-run to preview without executing
```

### Phase 3 — Execute (ordered, no prompts)

Fixed execution order to satisfy dependencies:

1. Prerequisites — install_cmd per selected optional server
2. File sync — copy/symlink per target
3. MCP core servers — mcp add per target
4. MCP optional servers — selected ones only
5. Post-install messages — collected throughout, printed once at end

---

## Component Changes

### `cli/src/commands/sync.ts` — Major rewrite

```typescript
async () => {
  const plan = await runPreflight(repoRoot);

  if (dryRun) { displayPlan(plan); return; }

  const selected = await interactivePlan(plan);   // null if ctrl+c
  if (!selected) return;

  await execute(selected);
}
```

### New `cli/src/core/preflight.ts`

`runPreflight(repoRoot): Promise<PreflightPlan>`

```typescript
interface PreflightPlan {
  targets: TargetPlan[];
  optionalServers: OptionalServerItem[];
  prerequisites: PrerequisiteItem[];
}

interface TargetPlan {
  target: string;
  agent: AgentName;
  files: FileItem[];        // missing / outdated / drifted
  mcpCore: McpItem[];       // not-installed / already-installed
}

interface OptionalServerItem {
  name: string;
  description: string;
  installCmd?: string;
  alreadyInstalled: boolean;
}

interface PrerequisiteItem {
  cmd: string;
  forServer: string;        // linked optional server name
  available: boolean;       // already on PATH?
}
```

### New `cli/src/core/interactive-plan.ts`

Builds `prompts` multiselect choices from `PreflightPlan`. Returns filtered selected plan or `false` on abort.

Key rules:
- Drifted items pre-unchecked
- Already-installed MCP items: disabled hint, not a choice
- Optional servers: pre-unchecked
- Prerequisites: injected after parent optional, selection mirrors parent

### `cli/src/commands/add-optional.ts` — Deprecated alias

```typescript
console.log(kleur.yellow('add-optional is deprecated — use: jaggers-config sync\n'));
// delegate to sync action
```

### `cli/src/core/sync-executor.ts` — Simplify

Remove `promptOptionalServers` call. Executor receives pre-filtered plan and executes it.

---

## Data Flow

```
sync.ts
  runPreflight()
    detectEnvironments()      context.ts
    calculateAllDiffs()       diff.ts (all targets)
    getMcpServerState()       sync-mcp-cli.ts
    loadOptionalServers()     sync-mcp-cli.ts
    checkPrerequisites()      new — test PATH binaries

  interactivePlan(plan)       new interactive-plan.ts

  execute(selectedPlan)       sync-executor.ts (refactored)
    runPrerequisites()
    syncFiles()
    syncMcpCore()
    syncMcpOptional()
    printPostInstallMessages()
```

---

## CLI Flags

| Flag | Behaviour |
|------|-----------|
| `--dry-run` | Show plan, skip Phase 3 |
| `-y` / `--yes` | Skip Phase 2, confirm all pre-selected defaults |
| `--prune` | Adds remove items for files/servers not in canonical config (pre-unchecked) |
| `--backport` | Reverses file direction; plan labels show arrows pointing to repo |

---

## Error Handling

- Preflight check failure: show inline in plan, item disabled
- Prerequisite install failure: log, continue, summarise at end
- MCP add failure: log inline, continue, summarise at end
- ctrl+c: clean exit, no partial state written

---

## Testing

- Unit: `runPreflight()` with mocked fs — verify all 5 checks run via Promise.all
- Unit: `interactivePlan()` — drifted items default unchecked, prerequisites link to parent
- Integration: mock all checks, run with `-y`, verify execution order (prerequisites before MCP)
- Smoke: `jaggers-config sync --dry-run` shows grouped plan with correct symbols

---

## Migration

- `add-optional` prints deprecation notice, delegates to sync
- `-y` flag preserves CI usage
- `--dry-run` and `status` unchanged
