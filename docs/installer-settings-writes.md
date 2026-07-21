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
| ↳ same function, side effect | **home** `~/.claude/settings.json` | `statusLine` | ~~Questionable~~ **removed** (xtrm-tzzud) | n/a |
| `claude-runtime-sync.ts:reconcileProjectClaudeHooks` | project `.claude/settings.json` | `hooks` | Yes | No — calls `planLegacyHookDedupe` at `:204` |
| `claude-runtime-sync.ts:reconcileGlobalClaudeHooks` | home `~/.claude/settings.json` | `hooks`, `statusLine` | Yes — this is the canonical global block | n/a (it *is* global) |
| `claude-runtime-sync.ts:ensureGlobalStatusLine` | home `~/.claude/settings.json` | `statusLine` | Yes, but see below | n/a |
| `pi-runtime.ts:updatePiSettings` | project `.pi/settings.json` | `packages`, `extensions`, `skills`, `serena`, `theme`; deletes `xtrmExternalCompact` | Yes | ~~Yes (`packages`)~~ **No** — gated on the global declaration (xtrm-tzzud) |
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

**RESOLVED (xtrm-tzzud.1) — Pi dedupes, and the project entry WINS.** The write
is therefore *actively wrong*, not merely redundant.

`DefaultPackageManager.resolve()` collects project entries first, then global
ones, and hands both to `dedupePackages()`. Identity comes from
`getPackageIdentity(source, scope)`, which for an `npm:` source returns
`npm:<name>` — **no scope component**. The two entries collide, and the dedupe
rule keeps the project one (a global entry survives only when the project entry
is an object with `autoload: false`; ours is a plain string). Verified against
the installed runtime rather than by reading alone:

```
input entries      : 2 project,user
identity(project)  : npm:@jaggerxtrm/pi-extensions
identity(user)     : npm:@jaggerxtrm/pi-extensions
deduped entries    : 1 project
VERDICT            : DEDUPES
winning scope      : project
```

So there is no double-load. What there *is* instead is worse in practice:
because the surviving entry carries `scope: "project"`, the extension resolves
from `<project>/.pi/npm/node_modules/…` rather than the global install, and
those per-project copies drift. On the machine this was audited on, the global
install was **0.11.0** while the per-project copies it shadowed were:

| Repo | Shadowing copy |
|---|---|
| `~/dev/console` | 0.9.3 |
| `~/dev/core` | 0.11.1 |
| `~/dev/specialists` | 0.9.5 |
| `~/dev/xtmux` | 0.11.0 |
| `~/dev/xtrm` | 0.9.0 |

Every one of those repos was pinned to a stale snapshot by this write, and the
global install was never loaded. The deletion is therefore justified, and the
audit's `duplicate-of-global` evidence string now says *shadows*, not
*duplicates*.

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

## Follow-up work — LANDED (xtrm-tzzud)

All three deletions shipped, plus the deferred `--fix`:

1. `updatePiSettings` no longer adds `pi-extensions` to per-project `packages`,
   and removes an existing entry — but only when `~/.pi/agent/settings.json` is
   proven to declare it. When the global settings do *not* declare the package
   the project entry is load-bearing and is left in place, so a machine that
   never completed the global migration is not broken by the change.
2. `ensureGlobalStatusLine` runs on the global path only. Global coverage is
   unchanged: `reconcileGlobalClaudeHooks` calls it on both of its exits, and
   `init` / `install` / `update` / `bootstrap` all invoke that separately. The
   surface that loses the side effect is exactly the one that should never have
   had it — a project-scoped `xt claude sync`.
3. The dangling `skills` pointer is removed by `--fix`. Nothing in the installer
   writes it any more: `normalizePiSkillsEntries` already classifies
   `../.xtrm/skills/active` as legacy, but it only ever runs against project
   roots, so no code path reaches `~/.pi/settings.json`. Dropping the key is the
   right call over repairing the pointer — the entry names a per-runtime view
   that the flat-`active` migration retired.

### `xt doctor settings --fix`

Dry-run by default, `--apply` opt-in, each mutated file copied into
`~/.xtrm/migration-backups/` before the write — the same contract as
`scripts/dedupe-legacy-hooks.mjs`. It resolves only findings the audit marked
`fix`, which is deliberately narrow:

| Finding | Fixable? | Why |
|---|---|---|
| `duplicate-of-global` (Pi arrays) | Yes | the global settings are proven to declare the entry |
| `orphaned-key` | Yes | on the explicit `RETIRED_PI_KEYS` list |
| `dangling-reference` on an xt-owned pointer | Yes | on `LEGACY_XTRM_SKILLS_ENTRIES` |
| `dangling-reference` on any other path | **No** | the operator wrote it; the dir may simply not exist yet here |
| every hook finding | **No** | owned by `xt update --apply` and the fleet sweep script |

Each file is re-read immediately before writing, so an audit that has gone stale
fails closed instead of clobbering concurrent edits.

## Cross-references

- `docs/architecture/repair-transaction.md` — phase contract and ownership rules
- `docs/legacy-hook-duplication.md` — duplication taxonomy and the fleet sweep
- `cli/src/core/legacy-hook-dedupe.ts` — the coverage+hash ownership proof
- `cli/src/core/settings-audit.ts` — detection for everything in this matrix
