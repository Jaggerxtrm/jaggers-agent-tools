---
title: CLI UX Improvements — Vsyc-Inspired Enhancements
version: 1.0.0
updated: 2026-02-22
domain: cli
tracks:
  - "cli/src/commands/**"
  - "cli/src/core/**"
type: ssot
tags: [cli, ux, sync, status, error-handling, spinners]
changelog:
  - version: 1.0.0
    date: 2026-02-22
    description: Initial implementation of 9 UX improvements inspired by vsync patterns
---

# CLI UX Improvements — Vsyc-Inspired Enhancements

## Overview

This SSOT documents the comprehensive UX improvements implemented in the Jaggers Config CLI, inspired by the vsync project's patterns. These enhancements focus on **safety**, **feedback**, and **polish**.

**Implementation Date:** 2026-02-22
**Files Modified:** 6 core files
**New Dependencies:** `ora` (spinners)

---

## Critical Safety Improvements

### 1. Prune Mode Read-Failure Guard

**Problem:** If reading the target fails in prune mode, the diff would return `[]`, causing prune to delete everything.

**Solution:** Added `PruneModeReadError` that aborts sync immediately if a system-side hash read fails.

**Implementation:**
```typescript
// cli/src/core/diff.ts
export class PruneModeReadError extends Error {
    constructor(path: string) {
        super(`Cannot read ${path} in prune mode — aborting to prevent accidental deletion`);
        this.name = 'PruneModeReadError';
    }
}

async function compareItem(..., pruneMode: boolean = false) {
    try {
        systemHash = await hashDirectory(systemPath);
    } catch (error) {
        if (pruneMode) {
            throw new PruneModeReadError(systemPath);
        }
        cat.missing.push(item);
        return;
    }
}
```

**Usage:**
```bash
jaggers-config sync --prune  # Now safe from accidental mass deletion
```

---

### 2. Dynamic Repo Root Detection

**Problem:** `repoRoot` was hardcoded as `path.resolve(process.cwd(), '..')`, which failed when running from outside `cli/`.

**Solution:** Created `findRepoRoot()` utility that walks up the directory tree looking for marker files.

**Implementation:**
```typescript
// cli/src/utils/repo-root.ts
export async function findRepoRoot(startDir: string = process.cwd()): Promise<string> {
    let dir = path.resolve(startDir);
    while (true) {
        const skillsPath = path.join(dir, 'skills');
        const hooksPath = path.join(dir, 'hooks');
        if (await fs.pathExists(skillsPath) && await fs.pathExists(hooksPath)) {
            return dir;
        }
        const parent = path.dirname(dir);
        if (parent === dir) {
            throw new Error('Could not locate jaggers-agent-tools repo root...');
        }
        dir = parent;
    }
}
```

**Usage:**
```bash
# Now works from any directory within the repo
cd ~/projects/jaggers-agent-tools && jaggers-config sync
cd ~/projects/jaggers-agent-tools/cli && jaggers-config sync
cd ~/projects/jaggers-agent-tools/docs && jaggers-config sync
```

---

### 3. Single Confirmation Prompt

**Problem:** Users were prompted once per target (4 targets = 4 prompts).

**Solution:** Collect all changesets first, display the full plan, then ask once.

**Implementation:**
```typescript
// cli/src/commands/sync.ts
// 1. Collect all changesets
const allChanges: TargetChanges[] = [];
for (const target of targets) {
    const changeSet = await calculateDiff(repoRoot, target, prune);
    allChanges.push({ target, changeSet, totalChanges, skippedDrifted: [] });
}

// 2. Display full plan
console.log(kleur.bold('\n📋 Sync Plan:'));
for (const { target, changeSet, totalChanges } of allChanges) {
    console.log(kleur.bold(`\n📂 ${path.basename(target)} → ${totalChanges} changes`));
    // ... show categories
}

// 3. Ask once
const totalChangesCount = allChanges.reduce((sum, c) => sum + c.totalChanges, 0);
const { confirm } = await prompts({
    message: `Proceed with ${actionType} (${totalChangesCount} total changes)?`
});
```

**Before:**
```
📂 Target: .claude
Proceed with sync (2 changes)? [Y/n]

📂 Target: .gemini
Proceed with sync (3 changes)? [Y/n]

📂 Target: .qwen
Proceed with sync (1 change)? [Y/n]
```

**After:**
```
📋 Sync Plan:

📂 .claude → 2 changes
  + 2 missing skills: skill-creator, documenting
📂 .gemini → 3 changes
  ↑ 3 outdated hooks: skill-suggestion, pip-venv-guard, serena-reminder
📂 .qwen → 1 change
  ✗ 1 drifted commands: search

Proceed with sync (6 total changes)? [Y/n]
```

---

## UX Feedback & Polish

### 4. Ora Spinners for Slow Operations

**Problem:** MCP CLI commands take 2-10s with no feedback.

**Solution:** Added `ora` spinners to all async operations.

**Implementation:**
```typescript
// cli/src/commands/sync.ts
const ctxSpinner = ora('Detecting environments…').start();
const ctx = await getContext();
ctxSpinner.succeed('Config loaded');

const diffSpinner = ora(`Calculating diff for ${path.basename(target)}…`).start();
const changeSet = await calculateDiff(repoRoot, target, prune);
diffSpinner.succeed('Plan generated');

const syncSpinner = ora('Syncing…').start();
const count = await executeSync(repoRoot, target, changeSet, syncMode, actionType, dryRun);
syncSpinner.succeed(`Synced ${count} items`);
```

**Visual Feedback:**
```
- Detecting environments…
✔ Config loaded

- Calculating diff for .claude…
✔ Plan generated

- Syncing…
✔ Synced 2 items
```

---

### 5. Enhanced Status Output

**Problem:** `status` showed flat diff list with no summary, timestamps, or health indicators.

**Solution:** Added last sync time, item counts, health indicators, and actionable hints.

**Implementation:**
```typescript
// cli/src/commands/status.ts
function formatRelativeTime(timestamp: number): string {
    const diff = Date.now() - timestamp;
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    return `${days} day${days > 1 ? 's' : ''} ago`;
}

// Load manifest for metadata
const manifestPath = getManifestPath(target);
if (await fs.pathExists(manifestPath)) {
    const manifest = await fs.readJson(manifestPath);
    console.log(kleur.gray(`  Last synced: ${formatRelativeTime(manifest.lastSync)}`));
    console.log(kleur.gray(`  Manifest: ${manifest.skills} skills, ${manifest.hooks} hooks`));
}

// Show health indicator
if (!hasChanges) {
    console.log(kleur.green('  ✓ Up-to-date'));
} else {
    console.log(kleur.yellow(`\n  ⚠ Pending changes: ${totalChanges}`));
}
```

**Output Example:**
```
- Loading status…
✔ Status loaded

📂 .claude
  Last synced: 3 hours ago
  Manifest: 5 skills, 4 hooks
  ✓ Up-to-date

📂 .gemini
  Last synced: 5 hours ago
  Manifest: 5 skills, 4 hooks
  + 2 missing skills
  ↑ 1 outdated hooks
  
  ⚠ Pending changes: 3

💡 Run `jaggers-config sync` to apply changes
```

---

### 6. Global Error Handler

**Problem:** Unhandled errors printed raw stack traces with internal paths.

**Solution:** Added global error handlers for clean error messages.

**Implementation:**
```typescript
// cli/src/index.ts
program.exitOverride((err) => {
    if (err.code === 'commander.unknownCommand') {
        console.error(kleur.red(`\n✗ Unknown command. Run 'jaggers-config --help'\n`));
        process.exit(1);
    }
});

process.on('uncaughtException', (err) => {
    if ((err as any).code?.startsWith('commander.')) return;
    console.error(kleur.red(`\n✗ ${err.message}\n`));
    process.exit(1);
});

process.on('unhandledRejection', (reason) => {
    console.error(kleur.red(`\n✗ ${String(reason)}\n`));
    process.exit(1);
});
```

**Before:**
```
Error: ENOENT: no such file or directory, access '/home/user/project/skills'
    at Object.accessSync (node:fs:254:3)
    at findRepoRoot (/home/dawid/projects/jaggers-agent-tools/cli/src/utils/repo-root.ts:10:8)
    ...
```

**After:**
```
✗ Could not locate jaggers-agent-tools repo root. Run from within the cloned repository.
```

---

### 7. Dry-Run Banner Positioning

**Problem:** Dry-run banner printed before target selection, causing confusion.

**Solution:** Moved notice to display after the full plan is shown.

**Before:**
```
  DRY RUN — no changes will be written

? Select target environments: ›
```

**After:**
```
📋 Sync Plan:

📂 .claude → 2 changes
📂 .gemini → 1 change

💡 Dry run — no changes written

Proceed with sync (3 total changes)? [Y/n]
```

---

### 8. Drifted Items Feedback

**Problem:** Drifted items were silently skipped during sync with no feedback.

**Solution:** Report skipped drifted items after sync completes.

**Implementation:**
```typescript
// cli/src/commands/sync.ts
// Track skipped drifted items
for (const [category, cat] of Object.entries(changeSet)) {
    const c = cat as any;
    if (c.drifted.length > 0 && actionType === 'sync') {
        skippedDrifted.push(...c.drifted.map((item: string) => `${category}/${item}`));
    }
}

// Report after sync
const allSkipped = allChanges.flatMap(c => c.skippedDrifted);
if (allSkipped.length > 0 && actionType === 'sync' && !dryRun) {
    console.log(kleur.yellow(`\n  ⚠ ${allSkipped.length} drifted item(s) skipped (local edits preserved):`));
    for (const item of allSkipped) {
        console.log(kleur.yellow(`      ${item}`));
    }
    console.log(kleur.yellow(`  Run 'jaggers-config sync --backport' to push them back.\n`));
}
```

**Output:**
```
✔ Synced 5 items

  ⚠ 2 drifted item(s) skipped (local edits preserved):
      hooks/skill-suggestion
      hooks/pip-venv-guard
  Run 'jaggers-config sync --backport' to push them back.
```

---

### 9. Ignored Items Filtering

**Problem:** `__pycache__` and other build artifacts appeared in diff output.

**Solution:** Added `IGNORED_ITEMS` set to filter before scanning.

**Implementation:**
```typescript
// cli/src/core/diff.ts
const IGNORED_ITEMS = new Set([
    '__pycache__',
    '.DS_Store',
    'Thumbs.db',
    '.gitkeep',
    'node_modules'
]);

const items = (await fs.readdir(repoPath)).filter(i => !IGNORED_ITEMS.has(i));
```

**Before:**
```
✗ 1 drifted hooks: __pycache__
```

**After:**
```
✓ Up-to-date
```

---

## Files Modified

| File | Changes |
|------|---------|
| `cli/src/core/diff.ts` | Added `PruneModeReadError`, `IGNORED_ITEMS`, prune mode param |
| `cli/src/utils/repo-root.ts` | New utility for dynamic repo root detection |
| `cli/src/commands/sync.ts` | Spinners, single confirm, dry-run positioning, drifted feedback |
| `cli/src/commands/status.ts` | Enhanced output with timestamps, counts, health |
| `cli/src/core/manifest.ts` | Added `getManifestPath()` helper |
| `cli/src/index.ts` | Global error handlers |
| `cli/package.json` | Added `ora` dependency |

---

## Testing

**Build Verification:**
```bash
cd cli && npm run build  # ✓ Success
cd cli && npm run typecheck  # ✓ No errors
```

**CLI Commands:**
```bash
jaggers-config --help  # ✓ Clean output
jaggers-config status  # ✓ Enhanced output with spinners
jaggers-config sync --dry-run  # ✓ Single prompt, proper banner positioning
```

---

## Related Documentation

- [CLI UX Improvements Plan](../../docs/plans/cli-ux-improvements.md)
- [Universal Configuration Hub SSOT](ssot_cli_universal_hub_2026-02-19.md)
- [MCP Servers Configuration SSOT](ssot_cli_mcp_servers_2026-02-21.md)
