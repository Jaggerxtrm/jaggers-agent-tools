# CLI UX Improvements — Inspired by vsync

Analysis of vsync's patterns compared to our CLI. Issues grouped from most critical (safety bugs) to cosmetic.

---

## Critical — Safety & Correctness

### 1. `--prune` has no read-failure guard (data-loss risk)

**vsync fix**: If reading the target fails in prune mode, throw `PruneModeReadError` (FATAL) and abort immediately. Without this, a file permissions error or corrupted config causes our code to return `[]` → the diff thinks everything was deleted → prune deletes everything.

**Our bug**: `calculateDiff` in `diff.ts` swallows errors silently. If `hashDirectory` throws on a target directory (e.g. permission denied), the item just disappears from the changeset → prune would delete it from the system.

**Fix**: In `compareItem`, wrap the system-side hash read in try/catch. If it throws and `prune` is active, abort sync entirely with a clear error message.

```typescript
// diff.ts — compareItem, add mode param
if (mode === 'prune') {
  throw new Error(
    `Cannot read ${systemPath} in prune mode — aborting to prevent accidental deletion`
  );
}
```

---

### 2. `repoRoot` is always `path.resolve(process.cwd(), '..')` — wrong when running from repo root

**Our bug**: In `sync.ts` and `status.ts`:
```typescript
const repoRoot = path.resolve(process.cwd(), '..'); // ALWAYS goes up one level
```

If the user runs `jaggers-config sync` from the repo root (not `cli/`), or from a totally unrelated directory, `repoRoot` is wrong. It should be the **actual repo root** — detected by walking up from `cwd()` looking for a known marker file (e.g. `skills/`, `hooks/`, `package.json` with `"name": "jaggers-agent-tools"`).

**Fix**: Add `findRepoRoot(startDir: string): string` utility that walks up the tree looking for `skills/` directory, or alternatively look for the marker using `package.json` name. Fall back to a clear error if not found.

```typescript
async function findRepoRoot(start: string): Promise<string> {
  let dir = start;
  while (true) {
    if (await fs.pathExists(join(dir, 'skills')) && await fs.pathExists(join(dir, 'hooks'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error('Could not locate jaggers-agent-tools repo root. Run from within the cloned repository.');
    dir = parent;
  }
}
```

---

### 3. Confirmation prompt fires **per target**, not once

**Our bug**: For 4 targets with changes, users get prompted 4 times. The target loop in `sync.ts` calls `prompts()` inside each iteration.

**vsync pattern**: Calculate ALL diffs first, display the full plan, then ask ONCE for confirmation.

**Fix**: Move the confirmation prompt outside the `for` loop. Collect all changesets first, display them all, then ask once:
```
📂 .claude      → 2 changes
📂 .gemini      → 3 changes
📂 .qwen        → 1 change
Proceed with sync (6 total)? [Y/n]
```

---

## UX — Missing Feedback & Polish

### 4. No spinners during slow operations

**vsync pattern**: Every async step shows an `ora` spinner:
- "Loading configuration…" → ✓ Config loaded
- "Reading source (claude)…" → ✓ 5 skills, 4 MCP servers
- "Calculating diff…" → ✓ Plan generated
- "Syncing…" → ✓ Sync complete

**Our gap**: Raw `console.log` only after the operation completes. MCP CLI commands (`claude mcp add`) can take 2–10s with no feedback.

**Fix**: Add `ora` to devDependencies and wrap the 3 slow operations:
- `getContext()` → "Detecting environments…"
- `calculateDiff()` per target → "Calculating diff for .claude…"
- `executeSync()` → "Syncing to .gemini…"

---

### 5. `status` shows a flat diff list — no summary header, no last-sync time, no health indicator

**vsync pattern**: `status` shows:
- Last sync time (relative: "2 hours ago")
- Manifest path
- Item counts (N skills, N MCP servers)
- Per-tool health: ✓ Up-to-date / ⚠ Pending changes
- "Run `jaggers-config sync` to apply"

**Our gap**: `status` just reprints the raw diff lines. No timestamps. No summary. No actionable hint.

**Fix**: Enhance `status.ts` to:
1. Load the manifest and read `lastSync` timestamp
2. Show relative time ("synced 3 hours ago")
3. Show item counts from the manifest
4. Show health per target
5. Print a hint line at the bottom

---

### 6. No global error handler — unhandled errors print raw stack traces

**vsync pattern**: `cli-setup.ts` has `program.exitOverride()` for unknown commands, and `runCLI()` has a top-level catch that prints `Error: <message>` (no stack) then `process.exit(1)`.

**Our gap**: `index.ts` has no top-level catch. If any command throws unhandled, Node prints the full stack trace with internal paths — looks bad for a CLI tool.

**Fix**: In `src/index.ts`, wrap `program.parseAsync()`:
```typescript
process.on('uncaughtException', (err) => {
  console.error(kleur.red(`\n✗ ${err.message}\n`));
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error(kleur.red(`\n✗ ${String(reason)}\n`));
  process.exit(1);
});
```
Also add `program.exitOverride()` for unknown commands:
```typescript
program.exitOverride((err) => {
  if (err.code === 'commander.unknownCommand') {
    console.error(kleur.red(`Unknown command. Run 'jaggers-config --help'`));
    process.exit(1);
  }
});
```

---

### 7. `--dry-run` banner prints before target selection — misleading order

**Our bug** in `sync.ts`:
```typescript
if (dryRun) {
  console.log(kleur.cyan('\n  DRY RUN — no changes will be written\n'));  // Line 23
}
const ctx = await getContext();  // then prompts for targets — Line 26
```

The dry-run banner appears before the user even picks targets, which is confusing. After selecting targets, users may have forgotten the banner.

**Fix**: Move the dry-run notice to display *after* the full plan is shown, immediately before where the confirmation would normally appear:
```
📂 .claude → 2 changes (missing: skill-creator, outdated: settings.json)
📂 .gemini → 1 change  (missing: skill-creator)
💡 Dry run — no changes written
```

---

### 8. Drifted items handled silently during `sync` (not `--backport`)

**Our gap**: When `sync` runs in non-backport mode, drifted items (system newer than repo) are shown in the diff summary but then **silently skipped** in `executeSync`. There is no per-item "Skipped (drifted)" message.

**Fix**: After sync completes, print the set of skipped drifted items:
```
  ⚠ 1 drifted item skipped (local edits preserved):
      hooks/__pycache__
  Run 'jaggers-config sync --backport' to push them back.
```

---

### 9. `__pycache__` appears in the diff — should be ignored

**Our bug**: Python bytecache directories appear in the diff output:
```
✗ 1 drifted hooks: __pycache__
```

`__pycache__` should be globally excluded from diff scanning (same as `.gitignore` patterns).

**Fix**: In `diff.ts`, filter items before scanning:
```typescript
const IGNORED_ITEMS = new Set(['__pycache__', '.DS_Store', 'Thumbs.db', '.gitkeep', 'node_modules']);

const items = (await fs.readdir(repoPath)).filter(i => !IGNORED_ITEMS.has(i));
```

---

## Summary Table

| #   | Issue                                        | Severity   | File to Fix                              |
| --- | -------------------------------------------- | ---------- | ---------------------------------------- |
| 1   | Prune mode read-failure can mass-delete      | 🔴 Critical | `core/diff.ts`                           |
| 2   | `repoRoot` incorrect when not in `cli/`      | 🔴 Critical | `commands/sync.ts`, `commands/status.ts` |
| 3   | Confirmation prompt loops per target         | 🟠 High     | `commands/sync.ts`                       |
| 4   | No spinners during slow async operations     | 🟡 Medium   | `commands/sync.ts`, `commands/status.ts` |
| 5   | `status` shows no summary/timestamps/hints   | 🟡 Medium   | `commands/status.ts`                     |
| 6   | No global error handler — raw stack traces   | 🟡 Medium   | `src/index.ts`                           |
| 7   | `--dry-run` banner before target selection   | 🟡 Medium   | `commands/sync.ts`                       |
| 8   | Drifted items silently skipped — no feedback | 🟢 Low      | `commands/sync.ts`                       |
| 9   | `__pycache__` pollutes diff output           | 🟢 Low      | `core/diff.ts`                           |

## Deferred (from vsync but out of scope)
- i18n / `t()` translation layer
- `plan` command (separate dry-run view with detailed table)
- `init` command (auto-configure `.vsync.json` on first run)
- Parallel target reads (`Promise.all` over targets)
- `--debug` flag with structured logging
