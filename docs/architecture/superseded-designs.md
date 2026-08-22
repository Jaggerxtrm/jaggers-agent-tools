# Superseded designs

Audit reference: `~/dev/11.md` §P3-05; XTRM runtime canonicalization residual `xtrm-cn8.6`.

An archive of designs that were tried, rejected, or replaced — kept explicit so a future contributor grepping the codebase finds this document before re-proposing something already retired. Each entry names the replacement and a set of stale search terms to watch for.

Format per entry:

- **Design** — one-line summary.
- **Replaced by** — the current design.
- **Why rejected** — one paragraph.
- **Removed / superseded in** — PR or commit when known.
- **Stale search terms** — literal identifiers/paths a grep might still surface today.

---

## Prompt-file transport

- **Replaced by** — direct system-prompt args on the runtime invocation (`claude --append-system-prompt-file`, Pi argv handling).
- **Why rejected** — external temp files were an extra failure mode (leaks under `~/.pi/agent`, cleanup races, permission mismatches on shared runners). Direct argv is atomic.
- **Removed / superseded in** — v0.11.0 line.
- **Stale search terms** — `XTMUX_AGENT_PROMPT_FILE`, `promptFile`, `prompt-file transport`.

## Marker directories as coordination authority

- **Replaced by** — xtmux journaled/SQLite coordination state (messages, obligations, monitors, waits/wakes) as the source of truth.
- **Why rejected** — marker directories are lossy, non-atomic across processes, and fragile under worktree cleanup.
- **Removed / superseded in** — xtmux SQLite V2 migration.
- **Stale search terms** — `marker/`, `xtrm-marker-`, `waitForMarker`.

## Core-owned independent skill-prefix construction

- **Replaced by** — Specialists-owned rendering (`sp render-skill-prefix` or its current public equivalent); Core consumes the rendered contract rather than rebuilding Specialist cognition independently.
- **Why rejected** — duplicated logic drifts. Core mis-composing the prefix produced two silently different startups for the same role.
- **Removed / superseded in** — Specialists v3.x transition.
- **Stale search terms** — `buildSkillPrefix`, `composeSkillList` in cli/src/.

## Pi extension allowlisting through invalid registry-name -e flags

- **Replaced by** — explicit `packages/pi-extensions/src/manifest.json` and package-managed extension discovery.
- **Why rejected** — implicit allowlisting via CLI flag order was invisible and easily broken on rebuild. Manifest/package ownership is explicit and version-controlled.
- **Removed / superseded in** — audit R-02 remediation.
- **Stale search terms** — `-e npm:pi-…` in legacy scripts.

## Broad persistent Claude permission defaults

- **Replaced by** — narrow project-scoped permission seeds only where operationally required; PR #438 dropped the broad seed entirely.
- **Why rejected** — persistent broad permission writes leaked into user-owned settings and survived across projects.
- **Removed / superseded in** — PR #438 (reverting PR #434).
- **Stale search terms** — `permissionsDefaults`, `seedClaudePermissions`.

## Native Pi mutation-tool pilot

- **Replaced by** — governed XTRM participant/tool surfaces and Specialist jobs; native Pi integration is an execution/adapter surface, not independent mutation authority.
- **Why rejected** — a free-standing Pi mutation tool bypassed Specialists/Beads governance and audit. The native Chain Runtime now places direct AgentSession activations behind XTRM capability, evidence, reducer and finalization contracts.
- **Stale search terms** — `pi-mutation-tool`, `pi tool call`.

## Remote mutation bridge

- **Replaced by** — nothing implicit. Any remote mutation surface must ship as a distinct protocol with auth/authz/audit/idempotency and consume the canonical XTRM runtime authorities.
- **Stale search terms** — `bridge.mutate`, `remoteMutation`.

## No-worktree interactive role proposals

- **Replaced by** — mandatory interactive worktrees. Every interactive `xt` runtime owns its own worktree/branch unless a separately reviewed runtime contract explicitly provides an equivalent isolation boundary.
- **Why rejected** — sharing a mutable operator worktree between concurrent runtimes creates races on source, dist paths and hooks.
- **Stale search terms** — `--no-worktree` on `xt claude`/`xt pi`.

## Full Core duplication of Specialist job-supervision metadata

- **Replaced by** — slim interactive-role envelope. See `docs/architecture/interactive-role-envelope.md`.
- **Why rejected** — Core consuming retries/stall/permission fields would make it a second competing job supervisor. Specialists/XTRM participant runtime owns managed Activation semantics; Core owns operator launch/install infrastructure.
- **Stale search terms** — `retries`, `stall_timeout`, `permission_tier` in Core role-launch config.

## March 2026 delegation architecture (`plans/delegation-architecture.md`)

- **Design** — pre-Specialists delegation plan built around AskUserQuestion plus Gemini/Cursor/Droid-style delegated sessions and a doctrine that execution never proceeds without explicit user confirmation.
- **Replaced by** — XTRM governed chains: Beads work authority, Specialists role/activation contracts, the XTRM `ChainSource → ChainDefinition → ResolvedChain → ChainRun` model, deterministic reducer/scheduler progression, and xtmux/runtime adapters for interactive/external agents.
- **Why rejected** — the document predates Specialists and xtmux as current authorities and embeds an obsolete human-confirmation/orchestrator-routing model. Reusing its session/dispatch doctrine would reintroduce prompt-owned orchestration and conflict with the current native runtime canon.
- **Removed / superseded in** — architecture superseded incrementally by the Specialists/xtmux/XTRM runtime programmes; formally registered by `xtrm-cn8.6` on 2026-08-22.
- **Stale search terms** — `AskUserQuestion`, `Gemini`, `Cursor`, `Droid`, `delegation-architecture`, `explicit user confirmation`.

## March 2026 orchestration implementation (`plans/orchestration-implementation.md`)

- **Design** — early orchestration implementation centered on `.jaggers/`, `sessions.json`, and UUID-pinned Gemini/Qwen session management.
- **Replaced by** — Core `xt` launch/worktree infrastructure, xtmux typed SQLite runtime/session coordination, Specialists/XTRM participant execution, and canonical ChainRun workflow semantics.
- **Why rejected** — its persistence, identity, provider and orchestration model predates the current package boundaries and would create duplicate session/workflow state if revived.
- **Removed / superseded in** — formally registered by `xtrm-cn8.6` on 2026-08-22; retained at its historical path for provenance until a separate plans-archive cleanup moves it.
- **Stale search terms** — `.jaggers/`, `sessions.json`, `orchestration-implementation`, `Gemini session`, `Qwen session`.

---

## Adding an entry

Before deleting or renaming a design surface: add the entry here in the same PR. The archive's job is to catch grep before it catches a stale identifier and leads someone to reimplement a rejected design.