# GitNexus Installer Integration

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Integrate the full GitNexus system (MCP server, PreToolUse hook, 4 skills) into the CLI installer as an optional component, with automatic `npm install -g gitnexus` on selection and a post-install reminder to run `npx gitnexus analyze` per project.

**Architecture:** Add `gitnexus` to `config/mcp_servers_optional.json` with `_notes.install_cmd` and `_notes.post_install_message` metadata fields. Modify `add-optional.ts` to detect these fields, run the install command before MCP sync, and print the post-install message after. Copy the hook and skills into the repo so the standard sync pipeline picks them up for free.

**Tech Stack:** TypeScript (CLI), `child_process.execSync` (existing pattern in codebase), `kleur` for terminal colour, `ora` for spinners, Commander.js sub-commands.

---

## Files Reference

| File | Role |
|------|------|
| `config/mcp_servers_optional.json` | Add gitnexus entry with install metadata |
| `config/settings.json` | Add PreToolUse hook entry for gitnexus |
| `hooks/gitnexus/gitnexus-hook.cjs` | Hook file — copy from live `~/.claude/hooks/gitnexus/` |
| `skills/gitnexus/*/SKILL.md` | 4 skill files — copy from `.claude/skills/gitnexus/` |
| `cli/src/commands/add-optional.ts` | Add prerequisite install + post-install message logic |

---

### Task 1: Copy hook into repo

**Files:**
- Create: `hooks/gitnexus/gitnexus-hook.cjs`

**Step 1: Copy the live hook file**

```bash
mkdir -p hooks/gitnexus
cp ~/.claude/hooks/gitnexus/gitnexus-hook.cjs hooks/gitnexus/gitnexus-hook.cjs
```

**Step 2: Verify the file was copied**

```bash
head -3 hooks/gitnexus/gitnexus-hook.cjs
```

Expected: `#!/usr/bin/env node` on line 1.

**Step 3: Commit**

```bash
git add hooks/gitnexus/gitnexus-hook.cjs
git commit -m "feat: add gitnexus PreToolUse hook to repo"
```

---

### Task 2: Copy skills into repo

**Files:**
- Create: `skills/gitnexus/exploring/SKILL.md`
- Create: `skills/gitnexus/debugging/SKILL.md`
- Create: `skills/gitnexus/impact-analysis/SKILL.md`
- Create: `skills/gitnexus/refactoring/SKILL.md`

**Step 1: Copy the 4 skill files from the local .claude dir**

```bash
mkdir -p skills/gitnexus/exploring skills/gitnexus/debugging skills/gitnexus/impact-analysis skills/gitnexus/refactoring
cp .claude/skills/gitnexus/exploring/SKILL.md      skills/gitnexus/exploring/SKILL.md
cp .claude/skills/gitnexus/debugging/SKILL.md      skills/gitnexus/debugging/SKILL.md
cp .claude/skills/gitnexus/impact-analysis/SKILL.md skills/gitnexus/impact-analysis/SKILL.md
cp .claude/skills/gitnexus/refactoring/SKILL.md    skills/gitnexus/refactoring/SKILL.md
```

**Step 2: Verify all 4 exist**

```bash
find skills/gitnexus -name "SKILL.md" | sort
```

Expected: 4 lines.

**Step 3: Commit**

```bash
git add skills/gitnexus/
git commit -m "feat: add gitnexus skills (exploring, debugging, impact-analysis, refactoring)"
```

---

### Task 3: Add gitnexus to optional MCP config

**Files:**
- Modify: `config/mcp_servers_optional.json`

**Step 1: Add the gitnexus entry**

Add this block inside `"mcpServers"` in `config/mcp_servers_optional.json`, after the existing entries:

```json
"gitnexus": {
  "type": "stdio",
  "command": "gitnexus",
  "args": ["mcp"],
  "env": {},
  "_notes": {
    "description": "Knowledge graph over your codebase — call chains, blast radius, execution flows, semantic search",
    "prerequisite": "Requires npm install -g gitnexus",
    "install_cmd": "npm install -g gitnexus",
    "post_install_message": "⚡ GitNexus must be indexed per project!\n   Run inside each project you want to use it with:\n\n     npx gitnexus analyze\n"
  }
}
```

**Step 2: Validate JSON is well-formed**

```bash
python3 -c "import json; json.load(open('config/mcp_servers_optional.json')); print('✓ valid JSON')"
```

Expected: `✓ valid JSON`

**Step 3: Commit**

```bash
git add config/mcp_servers_optional.json
git commit -m "feat: add gitnexus as optional MCP server with auto-install metadata"
```

---

### Task 4: Add gitnexus hook entry to settings.json

**Files:**
- Modify: `config/settings.json`

**Step 1: Add PreToolUse section to the hooks object**

The current `"hooks"` object in `config/settings.json` only has a `"Stop"` key. Add a `"PreToolUse"` key alongside it:

```json
"hooks": {
  "Stop": [
    {
      "hooks": [
        {
          "type": "command",
          "command": "python3 \"$HOME/.claude/skills/documenting/scripts/drift_detector.py\" hook",
          "timeout": 5
        }
      ]
    }
  ],
  "PreToolUse": [
    {
      "matcher": "Grep|Glob|Bash",
      "hooks": [
        {
          "type": "command",
          "command": "node \"$HOME/.claude/hooks/gitnexus/gitnexus-hook.cjs\"",
          "timeout": 8000,
          "statusMessage": "Enriching with GitNexus graph context..."
        }
      ]
    }
  ]
}
```

**Step 2: Validate JSON**

```bash
python3 -c "import json; json.load(open('config/settings.json')); print('✓ valid JSON')"
```

Expected: `✓ valid JSON`

**Step 3: Commit**

```bash
git add config/settings.json
git commit -m "feat: add gitnexus PreToolUse hook to settings.json"
```

---

### Task 5: Add prerequisite install + post-install message to add-optional.ts

**Files:**
- Modify: `cli/src/commands/add-optional.ts`

**Context:** Current file is ~52 lines. The action body:
1. Calls `promptOptionalServers` → gets selection
2. Filters optionalConfig to selected servers
3. Runs `syncMcpServersWithCli` per target

We are adding between steps 1→3:
- Loop selected servers, check `server._notes?.install_cmd`
- If present: run `execSync(install_cmd)` with a spinner (consistent with `executeCommand` in `sync-mcp-cli.ts` which also uses `execSync`)
- After MCP sync: print `server._notes?.post_install_message` for any server that has one

Note: `install_cmd` is a hardcoded string from our own config (not user input), so `execSync` is safe here — same pattern used throughout `sync-mcp-cli.ts`.

**Step 1: Add `execSync` import**

At the top of `cli/src/commands/add-optional.ts`, add to the existing imports:

```typescript
import { execSync } from 'child_process';
```

**Step 2: Replace the entire `.action(async () => { ... })` body**

```typescript
const repoRoot = await findRepoRoot();

console.log(kleur.cyan().bold('\nAdding Optional MCP Servers\n'));

// Prompt for which optional servers to install
const selected = await promptOptionalServers(repoRoot);

if (!selected || selected.length === 0) {
    console.log(kleur.gray('  No optional servers selected.\n'));
    return;
}

console.log(kleur.green(`\n  Selected: ${selected.join(', ')}\n`));

// Load full optional config to access _notes metadata
const optionalConfig = loadCanonicalMcpConfig(repoRoot, true);
const filteredConfig: any = { mcpServers: {} };
const postInstallMessages: string[] = [];

for (const serverName of selected) {
    const server = optionalConfig.mcpServers[serverName];
    if (!server) continue;
    filteredConfig.mcpServers[serverName] = server;

    // Run prerequisite install command if defined (hardcoded config value, not user input)
    const installCmd: string | undefined = server._notes?.install_cmd;
    if (installCmd) {
        const spinner = ora(`Installing prerequisite: ${installCmd}`).start();
        try {
            execSync(installCmd, { stdio: 'pipe' });
            spinner.succeed(kleur.green(`Installed: ${installCmd}`));
        } catch (err: any) {
            spinner.fail(kleur.red(`Failed: ${installCmd}`));
            console.log(kleur.dim(`  ${err.message}\n  You may need to run it manually.`));
        }
    }

    // Collect post-install messages
    const msg: string | undefined = server._notes?.post_install_message;
    if (msg) postInstallMessages.push(`[${serverName}]\n  ${msg}`);
}

// Get targets from context
const { getContext } = await import('../core/context.js');
const ctx = await getContext();

// Sync MCP to each target
for (const target of ctx.targets) {
    const agent = detectAgent(target);
    if (agent) {
        console.log(kleur.bold(`\n📂 Target: ${path.basename(target)}`));
        await syncMcpServersWithCli(agent, filteredConfig, false, false);
    }
}

console.log(kleur.green('\n✓ Optional MCP servers added successfully\n'));

// Print post-install guidance
if (postInstallMessages.length > 0) {
    console.log(kleur.yellow().bold('⚠️  Next Steps Required:\n'));
    for (const msg of postInstallMessages) {
        console.log(kleur.yellow(msg));
    }
    console.log('');
}
```

**Step 3: Build and check for TypeScript errors**

```bash
cd cli && npm run build 2>&1
```

Expected: Zero errors. Zero warnings about `any` unless pre-existing.

**Step 4: Smoke test — empty selection still exits cleanly**

```bash
echo "" | node dist/index.js add-optional
```

Expected: `No optional servers selected.` — no crash.

**Step 5: Commit**

```bash
cd ..
git add cli/src/commands/add-optional.ts
git commit -m "feat: run prerequisite install cmd and show post-install message for optional MCP servers"
```

---

### Task 6: End-to-end verification

**Step 1: Confirm hook and skills appear as missing in status**

```bash
npx ./cli status
```

Expected: `hooks/gitnexus` and `skills/gitnexus` listed as `[+] Missing`.

**Step 2: Dry-run sync shows them in plan**

```bash
npx ./cli sync --dry-run
```

Expected: Both `hooks/gitnexus` and `skills/gitnexus` in the copy plan.

**Step 3: Simulate gitnexus selection in add-optional**

Find gitnexus's position number in the menu (it will be the 3rd entry), then:

```bash
echo "3" | node cli/dist/index.js add-optional
```

Expected output sequence:
1. Menu shows: `[3] gitnexus` with `⚠️  Requires npm install -g gitnexus`
2. Spinner: `Installing prerequisite: npm install -g gitnexus`
3. `✓ Installed: npm install -g gitnexus` (or "already installed" equivalent)
4. MCP sync runs
5. Final block:
   ```
   ⚠️  Next Steps Required:
   [gitnexus]
     ⚡ GitNexus must be indexed per project!
        Run inside each project you want to use it with:
          npx gitnexus analyze
   ```

---
