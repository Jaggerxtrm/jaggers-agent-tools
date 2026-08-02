# Codex runtime boundary characterization

Status: K1 evidence for `xtrm-ozknq.5`. This document records observed behavior. It does not authorize a production `xt codex` command.

## Evidence and provenance

- Core commit: `9b823f80d373a4cb82173ec594f525b1f20caa39`.
- Codex: `codex-cli 0.146.0`, resolved from `/home/dawid/.local/bin/codex` to the standalone `0.146.0-x86_64-unknown-linux-musl` release.
- Pi and Claude behavior: characterized by `cli/src/tests/worktree-session-role.test.ts`, `cli/src/tests/worktree-session-bare-slash.test.ts`, `cli/src/tests/worktree-session-beads-noise.test.ts`, `cli/src/tests/end-worktree.test.ts`, and `cli/src/tests/pi-launch-self-heal-regression.test.ts`.
- Codex lifecycle payload: `cli/src/tests/fixtures/codex/0.146.0/exec-success.jsonl`, captured on 2026-08-02 with the exact argv recorded in its metadata.
- Codex product reference: the current OpenAI Codex manual fetched on 2026-08-02. Runtime observations take precedence for this installed version.
- Programme sequencing: [KAN-127 execution note](https://github.com/xtrm-dev/xtrm/blob/ed06ba222307030c7153c43cd2370262706b78a4/docs/shared/xtrm-codex-kan-127-execution-note.md).

## Released launcher baseline

Core currently owns one shared worktree launcher for Pi and Claude. Both create one branch and one worktree, publish bead, parent, worktree and branch identity to tmux, wait for runtime readiness, and clean up a failed launch. Their argv heads remain runtime-specific:

| Concern | Pi | Claude |
| --- | --- | --- |
| Runtime command | `pi` | `claude` |
| Default authority profile | Pi process permissions | `--dangerously-skip-permissions` |
| Explicit skills | repeated native `--skill PATH` | discoverability check plus slash prefix |
| Thinking override | `--thinking LEVEL` | unsupported and omitted |
| Turn-one separator | none | `--` |
| Resume used by `xt attach` | `pi -c` | `claude --continue --dangerously-skip-permissions` |
| Interactive machine outcome | no versioned outcome object | no versioned outcome object |

Human output reports the worktree and branch before launch and supplies recovery prose after failures. JSON consumers instead use tmux pane options, runtime-origin and xtmux events. K2 must introduce a stable machine outcome without changing these released argv and metadata baselines.

## Observed Codex boundary

Codex is a distinct interactive harness, not the `openai-codex/...` Pi provider spelling. The installed CLI exposes interactive launch, `exec --json`, exact UUID-based `resume`, archive/delete/fork, sandbox and approval controls, hooks, plugins, MCP, apps and native multi-agent features.

The minimal XTRM adapter consumes only the following native surfaces:

- `codex [OPTIONS] [PROMPT]` for an interactive thread;
- `codex resume SESSION_ID [PROMPT]` for exact persistence;
- `codex exec --json` only for isolated contract and smoke evidence;
- stable lifecycle and hook payloads for readiness, identity and turn capture.

Native Codex multi-agent execution is outside the parity architecture. Specialists and xtmux remain the worker, orchestration and monitoring authorities. Plugins, MCP bundles, apps/connectors and other extended capabilities remain optional K7 work.

## Safety profiles

The managed default profile is `--yolo`, expanded by Core to `--dangerously-bypass-approvals-and-sandbox`. The explicit `--no-yolo` profile expands to `--sandbox workspace-write --ask-for-approval on-request`; normal writes inside the active worktree do not require per-edit approval. Worktree isolation is a Git workflow boundary, not a host-security sandbox.

Hook trust is independent from approval and sandbox policy. Core must never generate or forward `--dangerously-bypass-hook-trust`. Conflicting native policy flags must fail before worktree creation. These rules are design inputs for K3, not behavior implemented by K1.

## Capability and ownership ledger

| Capability | Current Codex capability | XTRM parity owner | Minimum parity decision |
| --- | --- | --- | --- |
| Worktree and branch | Native Codex surfaces exist | Core | Core remains the single owner for `xt codex` |
| Thread persistence | UUID thread plus exact `resume` | Core | Store exact thread ID and exact resume argv |
| Sandbox and approvals | Native profiles and flags | Core | Expose validated YOLO/no-YOLO profiles |
| Hook trust | Persisted independently | Core installer plus xtmux adapter | Preserve trust; never bypass it |
| Messages and replies | No XTRM-compatible authority | xtmux | Adapt existing message and obligation domains |
| Monitors, wakes and recovery | Native lifecycle differs | xtmux | Adapt existing state and recovery domains |
| Roles and results | Native agents exist but conflict with programme ownership | Specialists | Add a Codex surface; do not use native subagents |
| Skills | Native user and repository discovery | Core distribution | Project managed projection; preserve unowned content |
| Plugins, MCP and apps | Native and useful | Optional K7 | Do not block parity |
| Serena | Not installed as an active Claude plugin | None for parity | Remove only active conflicting management in K4 |

## K2 contract boundary

K2 can add one additive, versioned outcome with runtime/version, status/reason, thread/session/pane identity, worktree/branch, readiness, safety profile, side effects, persistence result and exact next-action argv. It must not parse human prose, fabricate mutations, duplicate xtmux or Specialists domains, or require a production `xt codex` launcher to prove the generic contract.

The Codex JSONL capture proves that a non-fatal `item.completed` error can coexist with a successful agent message and terminal `turn.completed`. Consumers must therefore determine success from the versioned adapter contract, not from the presence of an arbitrary error item or a matching line of prose.

## Observed gaps retained for later phases

- The installed global `~/.codex/hooks.json` contains both an xtmux-owned agent-state registration and a byte-equivalent unowned registration for `SessionStart` and `UserPromptSubmit`. K1 records the duplication; owner-aware reconciliation belongs to the xtmux/Core lifecycle work.
- The Core full test suite currently fails its installed-hook parity assertion because the installed xtmux `auto-monitor-drain-stop.mjs` is older than the vendored Core fixture. The same assertion fails on unchanged Core `main`, so this is baseline drift rather than a K1 regression.
- Core has no versioned machine launch outcome today. Human launch/failure prose and tmux metadata must remain compatibility inputs only until K2 adds the deterministic outcome spine.
