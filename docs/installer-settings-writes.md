# Installer settings.json writes — post-global-migration audit

Bead: `xtrm-kdwvu.2`. Companion to `xt doctor settings`, which detects the
residue this matrix explains. Audited against `a1fdc4ca` (post PR #469).

Every function below writes a `settings.json`. The question this matrix answers
is the operator's: *after the migration to a global install, which of these
writes are still load-bearing, and which now duplicate something global?*

## Matrix

| Writer | Target | Fields touched | Still needed? | Duplicates global? |
|---|---|---|---|---|
| `claude-runtime-sync.ts:runClaudeRuntimeSyncPhase` (`isGlobal:false`) | project `.claude/settings.json` | `hooks`, `statusLine` | Yes | No — deduped in-flight (below) |
| ↳ same function, side effect | **home** `~/.claude/settings.json` | `statusLine` | **Questionable** | n/a |
| `claude-runtime-sync.ts:reconcileProjectClaudeHooks` | project `.claude/settings.json` | `hooks` | Yes | No — calls `planLegacyHookDedupe` at `:204` |
| `claude-runtime-sync.ts:reconcileGlobalClaudeHooks` | home `~/.claude/settings.json` | `hooks`, `statusLine` | Yes — this is the canonical global block | n/a (it *is* global) |
| `claude-runtime-sync.ts:ensureGlobalStatusLine` | home `~/.claude/settings.json` | `statusLine` | Yes, but see below | n/a |
| `pi-runtime.ts:updatePiSettings` | project `.pi/settings.json` | `packages`, `extensions`, `skills`, `serena`, `theme`; deletes `xtrmExternalCompact` | **Partly — see below** | **Yes** (`packages`) |
| `pi-runtime.ts:pruneConflictingPiPackageEntries` | home + project `.pi/settings.json` | `packages`, `theme`, `xtrmExternalCompact` | Yes — removal only | No |
| `pi-runtime-hooks.ts:reconcileGlobalPiHooks` | home `~/.pi/agent/settings.json` | `hooks` | Yes | n/a (it *is* global) |
| `plugin-era-cleanup.ts` | home + project `.claude/settings.json` | `enabledPlugins[xtrm-tools@xtrm-tools]`, `extraKnownMarketplaces[xtrm-tools]` | Yes — removal only | No |
| `clean.ts` | home `~/.claude/settings.json` | xtrm-owned hook entries | Yes — removal only, ownership-gated | No |
| `migrate.ts:migrateHooks` | project `.claude/settings.json` | `hooks` | Yes — removal only, via `planLegacyHookDedupe` (`:685`) | No |

## Findings

### 1. `updatePiSettings` writes a package entry the global install already carries — CONFIRMED

`cli/src/core/pi-runtime.ts:1318-1319` unconditionally pushes
`npm:@jaggerxtrm/pi-extensions` into the per-project `.pi/settings.json`
`packages` array:

```ts
if (!existingPackages.includes(PROJECT_EXTENSION_PACKAGE_ID)) {
    existingPackages.push(PROJECT_EXTENSION_PACKAGE_ID);
}
```

`~/.pi/agent/settings.json` already declares the same package. A fleet scan
(`xt doctor settings --scope project --scan-all-repos`) reports the redundancy
in every consumer project on this machine — the same shape as the Claude hook
duplication that PR #460/#464 fixed.

Not yet established: whether Pi double-loads the package or dedupes internally.
That determines whether this is *redundant* or *actively wrong*, and it is the
one open question blocking the deletion. Answer it before deleting the write.

### 2. Project-mode Claude sync writes the HOME settings file — CONFIRMED

`runClaudeRuntimeSyncPhase` calls `ensureGlobalStatusLine()` on all three of its
exit paths (`:125`, `:175`, `:180`) regardless of `isGlobal`. Running
`xt claude sync` or `xt init` inside one project therefore mutates
`~/.claude/settings.json.statusLine` — a surprising side effect from a
project-scoped verb, and the reason a per-project run can flip a global setting.

The write itself is idempotent and correctly gated (it no-ops when
`~/.xtrm/hooks/statusline.mjs` is absent or the command already matches), so
this is a layering defect rather than a corruption risk. The fix is to hoist
the call out of the project path, not to delete it.

### 3. `clean.ts` strips only xtrm-owned entries — CONFIRMED SAFE

Ownership is proven per entry before removal; unknown and third-party hooks are
left alone. No change needed. Note that PR #464 already replaced the
provenance-marker predicate with the coverage+hash proof, which is what made the
legacy untagged entries removable at all.

### 4. Hook duplication is already handled in the reconcile path

`reconcileProjectClaudeHooks` runs `planLegacyHookDedupe` at `:204`, so
`xt update --apply`, `xt init` and `xt claude sync` all prune project-scope
registrations the global block covers. `scripts/dedupe-legacy-hooks.mjs` remains
the one-shot fleet sweep for repos that have not been re-synced. Nothing further
is owed here.

### 5. xtmux triple-registration is NOT ours

`~/.claude/settings.json` carries every xtmux hook three times (one tagged
`_source:'xtmux'`, two untagged clones). Every command points at
`~/.claude/hooks/xtmux/`, none at `.xtrm/hooks/`. This is the xtmux installer
appending without first removing what it previously wrote. `xt doctor settings`
**detects** it and names the owner; the fix belongs to the xtmux repo
(`xtrm-xus17`). Core must not dedupe another installer's block — it has no
ownership rules for it.

## Follow-up work

The deletions themselves are deliberately not in this bead. `xt doctor settings`
is read-only and `--fix` is deferred, per `xtrm-kdwvu` scope §3. The follow-up
bead covers:

1. `updatePiSettings` stops adding `pi-extensions` to per-project `packages`
   (pending the Pi double-load question above).
2. `ensureGlobalStatusLine` runs only on the global path.
3. `~/.pi/settings.json` `skills: ['../.xtrm/skills/active']` — a dangling
   pointer that resolves nowhere on this machine.

## Cross-references

- `docs/architecture/repair-transaction.md` — phase contract and ownership rules
- `docs/legacy-hook-duplication.md` — duplication taxonomy and the fleet sweep
- `cli/src/core/legacy-hook-dedupe.ts` — the coverage+hash ownership proof
- `cli/src/core/settings-audit.ts` — detection for everything in this matrix
