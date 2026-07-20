# `xt update` — canonical repair transaction

Audit reference: `~/dev/11.md` §P1-09, §P1-11.

`xt update` (with or without `--apply`) is the ONE operator-facing
verb that reconciles a project's xtrm-managed state. All future
runtime repair work belongs inside this transaction — do NOT
introduce parallel repair verbs unless they represent a genuinely
distinct operation.

## Phases

Every reconciliation phase must return the same shape:

```ts
interface ReconciliationOutcome {
  changed: boolean;
  planned: Operation[];
  applied: Operation[];   // empty when running without --apply
  preserved: Asset[];     // user-owned assets we deliberately left alone
  failed: Failure[];
}
```

Human output, JSON output (`xt update --json` when it lands), and
dry-run reporting all derive from this same model. If a phase can't
produce a `ReconciliationOutcome`, that's the phase to fix — not a
place to invent a new outcome shape.

Current phases (order matters):

1. Registry reconciliation (compare on-disk to `.xtrm/registry.json`)
2. Managed asset installation (hooks, skills, config)
3. Pi settings normalization
4. Pi extension state (add/enable/disable per manifest)
5. Pi theme state
6. Claude hook state (merge with user-owned hooks, never wholesale replace)
7. Retired managed assets (owned-only cleanup)
8. Runtime links (flat active views)
9. Package assurance (registered Pi npm packages present)
10. External Pi tool patches
11. Final drift verification

## Cleanup

Cleanup (removal of retired managed assets, replaced designs, and
ownership-marked xtrm state) is NOT its own public verb. It is a
phase INSIDE `xt update`. The audit R-03 remediation established
this — see also PR #442.

Public compatibility surfaces (`xt clean`, `xt bootstrap`, `xt pi
install/reload/doctor`, `xt claude reload/reinstall/doctor`) are
scheduled for removal in v0.13.0 (see
`docs/command-deprecations.json`).

Internal cleanup helper stays available:

```ts
runOwnedLegacyCleanup({
  projectRoot,
  dryRun,
  scopes: ["hooks", "skills", "extensions"]
})
```

Rules that survive the v0.13.0 removals:

- Unknown Claude hooks stay. Third-party hooks stay.
- Unknown skills stay. User-created skills stay.
- Unknown Pi extensions stay.
- Removal only when the path is EXPLICITLY XTRM-owned (hash match
  to a canonical wrapper, `_source === XTRM_GLOBAL_SOURCE`, or the
  hook command references a known xtrm-managed path).

Do NOT scan a user directory and infer ownership from absence.

## Adding a new phase

- Extend the phase list here first.
- Return a `ReconciliationOutcome`.
- Wire it into `xt update` (both dry-run and `--apply`).
- Do NOT add a new top-level `xt <verb>` command. `xt update` is
  the canonical entrypoint.

## Cross-references

- Command deprecations: `docs/command-deprecations.json`.
- Compatibility contract: `docs/runtime-compatibility.json`.
- Ownership rules: `~/.xtrm/skills/default/using-xtrm/SKILL.md`.
