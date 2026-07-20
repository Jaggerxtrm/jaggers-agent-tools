# Superseded designs

Audit reference: `~/dev/11.md` §P3-05.

An archive of designs that were tried, rejected, or replaced —
kept explicit so a future contributor grepping the codebase finds
this document before re-proposing something already retired. Each
entry names the replacement and a set of stale search terms to
watch for.

Format per entry:

- **Design** — one-line summary.
- **Replaced by** — the current design.
- **Why rejected** — one paragraph.
- **Removed / superseded in** — PR or commit.
- **Stale search terms** — literal identifiers/paths a grep might
  still surface today.

---

## Prompt-file transport

- **Replaced by** — direct system-prompt args on the runtime
  invocation (`claude --append-system-prompt-file`, pi's argv
  handling).
- **Why rejected** — external temp files were an extra failure
  mode (leaks under `~/.pi/agent`, cleanup races, permission
  mismatches on shared runners). Direct argv is atomic.
- **Removed / superseded in** — v0.11.0 line.
- **Stale search terms** — `XTMUX_AGENT_PROMPT_FILE`,
  `promptFile`, `prompt-file transport`.

## Marker directories as coordination authority

- **Replaced by** — xtmux journaled coordination state (messages,
  obligations, monitors, wakes) as the source of truth.
- **Why rejected** — marker directories on disk are lossy
  (readers can't tell "not yet" from "consumed"), non-atomic
  across processes, and fragile under worktree cleanup.
- **Removed / superseded in** — xtmux migration.
- **Stale search terms** — `marker/`, `xtrm-marker-`,
  `waitForMarker`.

## Core-owned independent skill-prefix construction

- **Replaced by** — `sp render-skill-prefix` — Specialists renders
  the prefix; Core consumes verbatim.
- **Why rejected** — duplicated logic drifts. Core mis-composing
  the prefix produced two silently different startups for the
  same role.
- **Removed / superseded in** — Specialists v3.x transition.
- **Stale search terms** — `buildSkillPrefix`, `composeSkillList`
  in cli/src/.

## Pi extension allowlisting through invalid registry-name -e flags

- **Replaced by** — explicit `packages/pi-extensions/src/manifest.json`
  (see `docs/architecture/interactive-role-envelope.md` for the
  companion Core boundary).
- **Why rejected** — implicit allowlisting via CLI flag order was
  invisible and easily broken on rebuild. Manifest is explicit
  and version-controlled.
- **Removed / superseded in** — audit R-02 remediation.
- **Stale search terms** — `-e npm:pi-…` in legacy scripts.

## Broad persistent Claude permission defaults

- **Replaced by** — narrow project-scoped permission seeds only
  where operationally required; PR #438 dropped the broad seed
  entirely (mechanism was unneeded — commander/skill startup
  already provided the necessary handshakes).
- **Why rejected** — persistent write of broad permissions leaked
  into user-owned settings files and got carried across projects.
- **Removed / superseded in** — PR #438 (reverting PR #434).
- **Stale search terms** — `permissionsDefaults`,
  `seedClaudePermissions`.

## Native Pi mutation-tool pilot

- **Replaced by** — Pi extensions dispatched via xtmux + specialist
  jobs (read-only bridge + observation surfaces).
- **Why rejected** — Pi as a mutation tool bypassed
  Specialists/beads governance and audit trail. The pilot
  demonstrated the coordination-state distinction is the harder
  problem.
- **Stale search terms** — `pi-mutation-tool`, `pi tool call`.

## Remote mutation bridge

- **Replaced by** — nothing (read-only remains the design). Any
  future mutation surface must ship as a distinct protocol with
  auth/authz/audit/idempotency (see
  `docs/architecture/coordination-terminology.md`).
- **Stale search terms** — `bridge.mutate`, `remoteMutation`.

## No-worktree interactive role proposals

- **Replaced by** — mandatory interactive worktrees (audit
  P1-02). Every interactive `xt` runtime owns its own worktree
  and branch.
- **Why rejected** — sharing the main worktree between concurrent
  interactive runtimes race-conditions on the working tree, dist
  paths, and hooks. The isolation is architectural, not a
  convenience.
- **Stale search terms** — `--no-worktree` on `xt claude`/`xt pi`.

## Full Core duplication of Specialist job-supervision metadata

- **Replaced by** — slim interactive-role envelope (audit P1-01).
  See `docs/architecture/interactive-role-envelope.md`.
- **Why rejected** — Core consuming retries/stall/permission
  fields would make it a second, competing job supervisor.
  Specialists owns background job supervision; Core owns
  interactive session launch.
- **Stale search terms** — `retries` / `stall_timeout` /
  `permission_tier` in Core config or role-launch code.

---

## Adding an entry

Before deleting or renaming a design surface: add the entry here
in the same PR. The archive's job is to catch grep before it
catches a stale identifier and leads someone to reimplement a
rejected design.
