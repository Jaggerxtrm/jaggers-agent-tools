# Unified Sync Flow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the fragmented sync + add-optional commands with a single 3-phase flow: parallel preflight checks → interactive multiselect plan → ordered execution with no mid-flow prompts.

**Architecture:** New `preflight.ts` runs all environment/diff/MCP/optional checks in parallel. New `interactive-plan.ts` presents a single `prompts` multiselect with all items pre-checked by default (drifted and optionals pre-unchecked). Refactored `sync.ts` wires the three phases. `sync-executor.ts` has its inline `promptOptionalServers` call removed. `add-optional.ts` becomes a deprecation redirect.

**Tech Stack:** TypeScript, `prompts` (multiselect — already in project), `ora` (spinners — already in project), `kleur` (colours — already in project), `Promise.all` for parallel preflight.

**Design doc:** `docs/plans/2026-02-25-unified-sync-flow-design.md`

---

## Files Reference

| File | Action |
|------|--------|
| `cli/src/utils/sync-mcp-cli.ts` | Export `getCurrentServers` |
| `cli/src/core/preflight.ts` | **Create** — parallel checks, PreflightPlan types |
| `cli/src/core/interactive-plan.ts` | **Create** — prompts multiselect, SelectedPlan |
| `cli/src/core/sync-executor.ts` | Remove inline optional-server prompt logic |
| `cli/src/commands/sync.ts` | Rewrite — 3-phase flow |
| `cli/src/commands/add-optional.ts` | Deprecation redirect |

---

### Task 1: Export `getCurrentServers` from sync-mcp-cli.ts

**Files:**
- Modify: `cli/src/utils/sync-mcp-cli.ts:233`

`getCurrentServers` is needed by `preflight.ts` but is currently private. Add `export`.

**Step 1: Add export keyword**

In `cli/src/utils/sync-mcp-cli.ts` line 233, change:
```typescript
function getCurrentServers(agent: AgentName): string[] {
```
to:
```typescript
export function getCurrentServers(agent: AgentName): string[] {
```

**Step 2: Build to verify no breakage**
```bash
cd cli && npm run build 2>&1 | tail -5
```
Expected: Build success, zero errors.

**Step 3: Commit**
```bash
cd .. && git add cli/src/utils/sync-mcp-cli.ts
git commit -m "refactor: export getCurrentServers from sync-mcp-cli"
```

---

### Task 2: Create `cli/src/core/preflight.ts`

**Files:**
- Create: `cli/src/core/preflight.ts`

This module runs all 5 checks in parallel and returns a `PreflightPlan`.

**Step 1: Create the file**

```typescript
import path from 'path';
import os from 'os';
import fs from 'fs-extra';
import { execSync } from 'child_process';
import { calculateDiff } from './diff.js';
import {
    loadCanonicalMcpConfig,
    getCurrentServers,
    detectAgent,
} from '../utils/sync-mcp-cli.js';
import type { ChangeSet } from '../types/config.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface FileItem {
    name: string;
    status: 'missing' | 'outdated' | 'drifted';
    category: string;
}

export interface McpItem {
    name: string;
    installed: boolean;
}

export interface TargetPlan {
    target: string;
    label: string;
    agent: string | null;
    files: FileItem[];
    mcpCore: McpItem[];
    changeSet: ChangeSet;
}

export interface OptionalServerItem {
    name: string;
    description: string;
    prerequisite?: string;
    installCmd?: string;
    postInstallMessage?: string;
}

export interface PreflightPlan {
    targets: TargetPlan[];
    optionalServers: OptionalServerItem[];
    repoRoot: string;
    syncMode: 'copy' | 'symlink';
}

// ── Helpers ────────────────────────────────────────────────────────────────

function getCandidatePaths(): Array<{ label: string; path: string }> {
    const home = os.homedir();
    return [
        { label: '.claude', path: path.join(home, '.claude') },
        { label: '.gemini', path: path.join(home, '.gemini') },
        { label: '.qwen', path: path.join(home, '.qwen') },
        { label: '.gemini/antigravity', path: path.join(home, '.gemini', 'antigravity') },
    ];
}

export function isBinaryAvailable(binary: string): boolean {
    try {
        execSync(`which ${binary}`, { stdio: 'pipe' });
        return true;
    } catch {
        return false;
    }
}

// ── Main export ────────────────────────────────────────────────────────────

export async function runPreflight(
    repoRoot: string,
    prune = false
): Promise<PreflightPlan> {
    const candidates = getCandidatePaths();

    // Run all target checks in parallel
    const targetResults = await Promise.all(
        candidates.map(async (c) => {
            const exists = await fs.pathExists(c.path);
            if (!exists) return null;

            const agent = detectAgent(c.path);

            const [changeSet, installedMcp] = await Promise.all([
                calculateDiff(repoRoot, c.path, prune),
                Promise.resolve(agent ? getCurrentServers(agent) : []),
            ]);

            const files: FileItem[] = [];
            for (const [category, cat] of Object.entries(changeSet)) {
                const c2 = cat as any;
                for (const name of c2.missing)  files.push({ name, status: 'missing',  category });
                for (const name of c2.outdated) files.push({ name, status: 'outdated', category });
                for (const name of c2.drifted)  files.push({ name, status: 'drifted',  category });
            }

            const canonicalMcp = loadCanonicalMcpConfig(repoRoot);
            const mcpCore: McpItem[] = Object.keys(canonicalMcp.mcpServers || {}).map(name => ({
                name,
                installed: installedMcp.includes(name),
            }));

            return { target: c.path, label: c.label, agent, files, mcpCore, changeSet };
        })
    );

    const targets = targetResults.filter((t): t is TargetPlan => t !== null);

    // Load optional servers config
    const optionalConfig = loadCanonicalMcpConfig(repoRoot, true);
    const allInstalledMcp = new Set(targets.flatMap(t => t.mcpCore.filter(m => m.installed).map(m => m.name)));

    const optionalServers: OptionalServerItem[] = Object.entries(optionalConfig.mcpServers || {})
        .filter(([name]) => !allInstalledMcp.has(name))
        .map(([name, server]: [string, any]) => ({
            name,
            description: server._notes?.description || '',
            prerequisite: server._notes?.prerequisite,
            installCmd: server._notes?.install_cmd,
            postInstallMessage: server._notes?.post_install_message,
        }));

    return { targets, optionalServers, repoRoot, syncMode: 'copy' };
}
```

**Step 2: Build**
```bash
cd cli && npm run build 2>&1 | tail -5
```
Expected: zero errors.

**Step 3: Commit**
```bash
cd .. && git add cli/src/core/preflight.ts
git commit -m "feat: add preflight.ts — parallel environment/diff/MCP checks"
```

---

### Task 3: Create `cli/src/core/interactive-plan.ts`

**Files:**
- Create: `cli/src/core/interactive-plan.ts`

Builds a `prompts` multiselect from a `PreflightPlan`. Drifted and optional items are pre-unchecked. Returns `SelectedPlan` (filtered to user selection) or `null` if user aborted.

**Step 1: Create the file**

```typescript
// @ts-ignore
import prompts from 'prompts';
import kleur from 'kleur';
import type { PreflightPlan, TargetPlan, FileItem, McpItem, OptionalServerItem } from './preflight.js';
import type { AgentName } from '../utils/sync-mcp-cli.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface SelectedFileItem {
    target: string;
    name: string;
    status: 'missing' | 'outdated' | 'drifted';
    category: string;
}

export interface SelectedMcpItem {
    target: string;
    agent: string;
    name: string;
}

export interface SelectedPlan {
    files: SelectedFileItem[];
    mcpCore: SelectedMcpItem[];
    optionalServers: OptionalServerItem[];
    repoRoot: string;
    syncMode: 'copy' | 'symlink';
}

// ── Helpers ────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
    missing:  kleur.green('[+]'),
    outdated: kleur.blue('[↑]'),
    drifted:  kleur.red('[~]'),
};

function fileChoices(target: TargetPlan): any[] {
    if (target.files.length === 0) return [];
    const choices: any[] = [
        { title: kleur.bold().dim(`  ── ${target.label} files ──`), disabled: true, value: null },
    ];
    for (const f of target.files) {
        const label = STATUS_LABEL[f.status] ?? '[?]';
        const hint = f.status === 'drifted' ? kleur.dim(' local edits — skip recommended') : '';
        choices.push({
            title: `  ${label} ${f.category}/${f.name}${hint}`,
            value: { type: 'file', target: target.target, name: f.name, status: f.status, category: f.category },
            selected: f.status !== 'drifted',
        });
    }
    return choices;
}

function mcpCoreChoices(target: TargetPlan): any[] {
    const uninstalled = target.mcpCore.filter(m => !m.installed);
    const installed   = target.mcpCore.filter(m => m.installed);
    if (target.mcpCore.length === 0) return [];

    const choices: any[] = [
        { title: kleur.bold().dim(`  ── ${target.label} MCP servers ──`), disabled: true, value: null },
    ];
    for (const m of uninstalled) {
        choices.push({
            title: `  ${kleur.green('[+]')} ${m.name}`,
            value: { type: 'mcp-core', target: target.target, agent: target.agent, name: m.name },
            selected: true,
        });
    }
    for (const m of installed) {
        choices.push({
            title: kleur.dim(`  [=] ${m.name}  (already installed)`),
            disabled: true,
            value: null,
        });
    }
    return choices;
}

function optionalChoices(optionalServers: OptionalServerItem[]): any[] {
    if (optionalServers.length === 0) return [];
    const choices: any[] = [
        { title: kleur.bold().dim('  ── optional servers ──'), disabled: true, value: null },
    ];
    for (const s of optionalServers) {
        const prereq = s.prerequisite ? kleur.yellow(` ⚠ ${s.prerequisite}`) : '';
        choices.push({
            title: `  ${kleur.yellow('[?]')} ${s.name}${prereq}`,
            value: { type: 'mcp-optional', server: s },
            selected: false,
        });
    }
    return choices;
}

// ── Main export ────────────────────────────────────────────────────────────

export async function interactivePlan(
    plan: PreflightPlan,
    opts: { dryRun?: boolean; yes?: boolean } = {}
): Promise<SelectedPlan | null> {
    const allChoices = [
        ...plan.targets.flatMap(t => [...fileChoices(t), ...mcpCoreChoices(t)]),
        ...optionalChoices(plan.optionalServers),
    ].filter(c => c.title); // remove any undefined entries

    const totalSelectable = allChoices.filter(c => !c.disabled && c.value !== null).length;

    if (totalSelectable === 0) {
        console.log(kleur.green('\n✓ Everything is up-to-date\n'));
        return { files: [], mcpCore: [], optionalServers: [], repoRoot: plan.repoRoot, syncMode: plan.syncMode };
    }

    console.log(kleur.bold('\n📋 Sync Plan') + kleur.dim('  (space to toggle, a = all, enter to confirm)\n'));

    if (opts.dryRun) {
        // Just display, don't prompt
        for (const c of allChoices) {
            if (c.disabled) { console.log(kleur.dim(c.title)); continue; }
            const bullet = c.selected ? '◉' : '◯';
            console.log(`  ${bullet} ${c.title?.trim()}`);
        }
        console.log(kleur.cyan('\n💡 Dry run — no changes written\n'));
        return null;
    }

    if (opts.yes) {
        // Select all pre-selected defaults, skip prompt
        const selected = allChoices.filter(c => !c.disabled && c.selected && c.value).map(c => c.value);
        return buildSelectedPlan(selected, plan);
    }

    const response = await prompts({
        type: 'multiselect',
        name: 'selected',
        message: 'Select items to sync:',
        choices: allChoices,
        hint: 'space to toggle · a = all · enter to confirm',
        instructions: false,
        min: 0,
    });

    // ctrl+c returns undefined
    if (!response || response.selected === undefined) {
        console.log(kleur.gray('\n  Cancelled.\n'));
        return null;
    }

    return buildSelectedPlan(response.selected, plan);
}

function buildSelectedPlan(selected: any[], plan: PreflightPlan): SelectedPlan {
    const files: SelectedFileItem[] = selected
        .filter(v => v?.type === 'file')
        .map(v => ({ target: v.target, name: v.name, status: v.status, category: v.category }));

    const mcpCore: SelectedMcpItem[] = selected
        .filter(v => v?.type === 'mcp-core')
        .map(v => ({ target: v.target, agent: v.agent, name: v.name }));

    const optionalServers: OptionalServerItem[] = selected
        .filter(v => v?.type === 'mcp-optional')
        .map(v => v.server);

    return { files, mcpCore, optionalServers, repoRoot: plan.repoRoot, syncMode: plan.syncMode };
}
```

**Step 2: Build**
```bash
cd cli && npm run build 2>&1 | tail -5
```
Expected: zero errors.

**Step 3: Commit**
```bash
cd .. && git add cli/src/core/interactive-plan.ts
git commit -m "feat: add interactive-plan.ts — prompts multiselect for unified sync plan"
```

---

### Task 4: Remove inline optional-server prompt from sync-executor.ts

**Files:**
- Modify: `cli/src/core/sync-executor.ts:38-80` (approx)

The manifest tracking for `optionalServersPrompted` and the `promptOptionalServers` call move to the new flow. Remove them. Also add a `selectedOptionalServers` parameter.

**Step 1: Read the current executeSync signature and optional-server block**

Lines 14-80 of `cli/src/core/sync-executor.ts`. The block to remove is lines ~42-80 (the `wasOptionalPromptShown` / `promptOptionalServers` logic).

**Step 2: Remove the optional-server prompt block and add parameter**

Change the function signature from:
```typescript
export async function executeSync(
    repoRoot: string,
    systemRoot: string,
    changeSet: ChangeSet,
    mode: 'copy' | 'symlink' | 'prune',
    actionType: 'sync' | 'backport',
    isDryRun: boolean = false
): Promise<number>
```
to:
```typescript
export async function executeSync(
    repoRoot: string,
    systemRoot: string,
    changeSet: ChangeSet,
    mode: 'copy' | 'symlink' | 'prune',
    actionType: 'sync' | 'backport',
    isDryRun: boolean = false,
    selectedMcpServers?: string[]   // NEW: pre-selected from interactive plan
): Promise<number>
```

Remove the entire block starting with:
```typescript
// Check if optional servers prompt was already shown
const manifestPath = path.join(systemRoot, '.jaggers-sync-manifest.json');
```
...through the closing brace of the optional-server if-block (around line 80).

Replace with simply:
```typescript
const agent = detectAgent(systemRoot);
if (agent && actionType === 'sync') {
    const coreConfig = loadCanonicalMcpConfig(repoRoot);

    // Build MCP config: core servers always + any pre-selected optionals
    const mcpToSync: any = { mcpServers: { ...coreConfig.mcpServers } };

    if (selectedMcpServers && selectedMcpServers.length > 0) {
        const optionalConfig = loadCanonicalMcpConfig(repoRoot, true);
        for (const name of selectedMcpServers) {
            if (optionalConfig.mcpServers[name]) {
                mcpToSync.mcpServers[name] = optionalConfig.mcpServers[name];
            }
        }
    }

    if (!isDryRun) {
        await syncMcpServersWithCli(agent, mcpToSync, isDryRun, false);
    } else {
        console.log(kleur.cyan(`  [DRY RUN] MCP sync for ${agent}`));
    }
}
```

Also remove `promptOptionalServers` from the import line at the top of the file.

**Step 3: Build**
```bash
cd cli && npm run build 2>&1 | tail -5
```
Expected: zero errors.

**Step 4: Commit**
```bash
cd .. && git add cli/src/core/sync-executor.ts
git commit -m "refactor: remove inline optional-server prompt from sync-executor, accept pre-selected list"
```

---

### Task 5: Rewrite `cli/src/commands/sync.ts`

**Files:**
- Modify: `cli/src/commands/sync.ts` (full rewrite)

Wire the three phases together: preflight → interactive plan → execute.

**Step 1: Replace the file content**

```typescript
import { Command } from 'commander';
import kleur from 'kleur';
import ora from 'ora';
import { execSync } from 'child_process';
import { findRepoRoot } from '../utils/repo-root.js';
import { getContext } from '../core/context.js';
import { runPreflight } from '../core/preflight.js';
import { interactivePlan } from '../core/interactive-plan.js';
import { executeSync } from '../core/sync-executor.js';
import { syncMcpServersWithCli, detectAgent } from '../utils/sync-mcp-cli.js';
import type { ChangeSet } from '../types/config.js';
import path from 'path';

export function createSyncCommand(): Command {
    return new Command('sync')
        .description('Sync skills, hooks, config, and MCP servers to all agent environments')
        .option('--dry-run', 'Preview the plan without making any changes', false)
        .option('-y, --yes', 'Skip interactive plan, apply all defaults', false)
        .option('--prune', 'Also remove items not present in the canonical repository', false)
        .option('--backport', 'Reverse direction: copy local edits back into the repository', false)
        .action(async (opts) => {
            const { dryRun, yes, prune, backport } = opts;
            const actionType = backport ? 'backport' : 'sync';
            const repoRoot = await findRepoRoot();

            // ── Phase 1: Preflight (all parallel) ──────────────────────────
            const spinner = ora('Checking environments…').start();
            let plan;
            try {
                // Target selection: prompt user (existing behaviour from getContext)
                // or auto-detect all found targets when -y is passed
                if (!yes && !dryRun) {
                    spinner.stop();
                    const ctx = await getContext();
                    spinner.start('Running preflight checks…');
                    plan = await runPreflight(repoRoot, prune);
                    // Filter to user-selected targets only
                    plan = {
                        ...plan,
                        targets: plan.targets.filter(t => ctx.targets.includes(t.target)),
                    };
                } else {
                    plan = await runPreflight(repoRoot, prune);
                }

                const totalChanges = plan.targets.reduce(
                    (sum, t) => sum + t.files.length + t.mcpCore.filter(m => !m.installed).length, 0
                ) + plan.optionalServers.length;

                spinner.succeed(`Ready — ${totalChanges} potential changes across ${plan.targets.length} target(s)`);
            } catch (err: any) {
                spinner.fail(`Preflight failed: ${err.message}`);
                process.exit(1);
            }

            // ── Phase 2: Interactive plan ───────────────────────────────────
            const selected = await interactivePlan(plan, { dryRun, yes });
            if (!selected) return; // dry-run or cancelled

            if (selected.files.length === 0 && selected.mcpCore.length === 0 && selected.optionalServers.length === 0) {
                console.log(kleur.green('\n✓ Nothing to do\n'));
                return;
            }

            // ── Phase 3: Execute ────────────────────────────────────────────

            // 3a. Prerequisite installs for selected optional servers
            const postInstallMessages: string[] = [];
            for (const optServer of selected.optionalServers) {
                if (optServer.installCmd) {
                    const installSpinner = ora(`Installing: ${optServer.installCmd}`).start();
                    try {
                        execSync(optServer.installCmd, { stdio: 'pipe' });
                        installSpinner.succeed(kleur.green(`Installed: ${optServer.installCmd}`));
                    } catch (err: any) {
                        const stderr = (err.stderr as Buffer | undefined)?.toString() || err.message;
                        installSpinner.fail(kleur.red(`Failed: ${optServer.installCmd}`));
                        console.log(kleur.dim(`  ${stderr.trim()}`));
                    }
                }
                if (optServer.postInstallMessage) {
                    postInstallMessages.push(`[${optServer.name}]\n  ${optServer.postInstallMessage}`);
                }
            }

            // 3b. File sync per target
            // Group selected files back into changeset shape per target
            const { syncMode } = plan;
            const targetPaths = [...new Set([
                ...selected.files.map(f => f.target),
                ...selected.mcpCore.map(m => m.target),
            ])];

            let totalSynced = 0;
            const skippedDrifted: string[] = [];

            for (const targetPath of targetPaths) {
                console.log(kleur.bold(`\n📂 ${path.basename(targetPath)}`));

                // Reconstruct a partial ChangeSet from selected file items
                const targetFiles = selected.files.filter(f => f.target === targetPath);
                const partialChangeSet: any = {
                    skills:                 { missing: [], outdated: [], drifted: [], total: 0 },
                    hooks:                  { missing: [], outdated: [], drifted: [], total: 0 },
                    config:                 { missing: [], outdated: [], drifted: [], total: 0 },
                    commands:               { missing: [], outdated: [], drifted: [], total: 0 },
                    'qwen-commands':        { missing: [], outdated: [], drifted: [], total: 0 },
                    'antigravity-workflows':{ missing: [], outdated: [], drifted: [], total: 0 },
                };
                for (const f of targetFiles) {
                    if (partialChangeSet[f.category]) {
                        partialChangeSet[f.category][f.status].push(f.name);
                    }
                }

                const selectedOptionalNames = selected.optionalServers.map(s => s.name);
                const count = await executeSync(
                    repoRoot, targetPath, partialChangeSet, syncMode, actionType, false, selectedOptionalNames
                );
                totalSynced += count;

                // Track drifted skips
                for (const f of targetFiles) {
                    if (f.status === 'drifted') {
                        skippedDrifted.push(`${targetPath}/${f.category}/${f.name}`);
                    }
                }
            }

            // 3c. Summary
            console.log(kleur.bold(kleur.green(`\n✓ Synced ${totalSynced} items\n`)));

            if (skippedDrifted.length > 0) {
                console.log(kleur.yellow(`  ⚠ ${skippedDrifted.length} drifted item(s) in your selection were preserved`));
                console.log(kleur.yellow(`  Run 'jaggers-config sync --backport' to push them back.\n`));
            }

            // 3d. Post-install messages
            if (postInstallMessages.length > 0) {
                console.log(kleur.yellow().bold('⚠️  Next Steps Required:\n'));
                for (const msg of postInstallMessages) {
                    console.log(kleur.yellow(`  ${msg}`));
                }
                console.log('');
            }
        });
}
```

**Step 2: Build**
```bash
cd cli && npm run build 2>&1 | tail -5
```
Expected: zero errors.

**Step 3: Commit**
```bash
cd .. && git add cli/src/commands/sync.ts
git commit -m "feat: rewrite sync command — 3-phase preflight/interactive-plan/execute flow"
```

---

### Task 6: Deprecate `add-optional.ts`

**Files:**
- Modify: `cli/src/commands/add-optional.ts` (full replacement)

```typescript
import { Command } from 'commander';
import kleur from 'kleur';

export function createAddOptionalCommand(): Command {
    return new Command('add-optional')
        .description('[deprecated] Use: jaggers-config sync — optional servers are now part of the main sync flow')
        .action(async () => {
            console.log(kleur.yellow(
                '\n⚠  add-optional is deprecated.\n' +
                '   Optional MCP servers are now part of the main sync flow.\n' +
                '   Run: jaggers-config sync\n'
            ));
        });
}
```

**Step 1: Replace file, build, commit**
```bash
cd cli && npm run build 2>&1 | tail -5
```
Expected: zero errors.

```bash
cd .. && git add cli/src/commands/add-optional.ts
git commit -m "feat: deprecate add-optional — redirects to sync"
```

---

### Task 7: End-to-end verification

**Step 1: Dry-run shows grouped plan**
```bash
node cli/dist/index.js sync --dry-run
```
Expected:
- Single preflight spinner, then "Ready — N changes"
- Plan displayed grouped: files per target, MCP servers per target, optional servers
- Drifted items shown with `[~]` label
- "Dry run — no changes written" banner
- Clean exit, no errors

**Step 2: -y flag applies defaults without prompting**
```bash
node cli/dist/index.js sync -y 2>&1 | head -20
```
Expected:
- Preflight spinner completes
- No interactive prompt
- Jumps straight to execution
- Summary line printed

**Step 3: add-optional shows deprecation notice**
```bash
node cli/dist/index.js add-optional
```
Expected:
```
⚠  add-optional is deprecated.
   Optional MCP servers are now part of the main sync flow.
   Run: jaggers-config sync
```

**Step 4: Confirm no build errors or TypeScript warnings**
```bash
cd cli && npm run build 2>&1
```
Expected: zero errors.

**Step 5: Commit if any fixup needed, then final commit**
```bash
cd .. && git add -p
git commit -m "test: verify unified sync flow end-to-end"
```

---
