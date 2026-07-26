# Vendored xtmux Claude hooks

Byte-identical copies of the Claude-runtime hooks that xtmux installs into
`~/.claude/hooks/xtmux/`. They are the units under test for
`cli/src/tests/eval-01-claude-side.test.ts` (EVAL-01 Claude column,
bead `xtrm-wiy5n.4.2.2`).

They are vendored because `@jaggerxtrm/xtmux` cannot be a Core devDependency:
its `postinstall` runs `scripts/install.mjs --from-npm`, which would rewrite
`~/.claude` on every `npm ci`. Vendoring keeps the suite deterministic in CI
while `eval-01-claude-side.test.ts` carries a drift guard that fails locally
whenever these copies diverge from the installed originals.

| File | Owner | Upstream path |
|---|---|---|
| `auto-monitor-drain-stop.mjs` | xtmux | `hooks/claude/auto-monitor-drain-stop.mjs` |
| `auto-monitor-on-send.mjs` | xtmux | `hooks/claude/auto-monitor-on-send.mjs` |
| `auto-monitor-consumed.mjs` | xtmux | `hooks/claude/auto-monitor-consumed.mjs` |

Vendored from `@jaggerxtrm/xtmux` **0.2.2**.

## Re-vendoring

Edit the hooks in the xtmux repo first — never here. Then:

```bash
for f in auto-monitor-drain-stop.mjs auto-monitor-on-send.mjs auto-monitor-consumed.mjs; do
  cp ~/.claude/hooks/xtmux/"$f" cli/src/tests/fixtures/xtmux-claude-hooks/"$f"
done
npm test --prefix cli -- eval-01-claude-side
```

A contract break in the refreshed copy surfaces as a named scenario failure.
