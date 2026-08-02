# Deterministic launcher outcome (`xtrm.command-outcome.v1`)

Status: K2 contract for `xtrm-ozknq.6`. This is a generic Pi/Claude launcher spine. It does not add or authorize a production `xt codex` command.

Programme reference: [KAN-127 execution note](https://github.com/xtrm-dev/xtrm/blob/ed06ba222307030c7153c43cd2370262706b78a4/docs/shared/xtrm-codex-kan-127-execution-note.md).

## Contract boundary

`@xtrm/contracts` owns the JSON Schema, TypeScript mirror, validator, and golden/invalid fixtures for `xtrm.command-outcome.v1`. The required generic fields are:

- `status`, stable `reason_code`, and a bounded summary;
- the authoritative mutation result;
- bounded side effects;
- exact next-action argv plus display text derived from that argv.

Runtime, identity, worktree, readiness, safety profile, and persistence fields are optional in the generic schema and mandatory in the detached launcher adapter. Every object rejects unknown fields. Strings and arrays have explicit ceilings. Control characters are rejected from summaries, identity, paths, argv, and display fields. Raw prompts, credentials, transcripts, and terminal capture have no contract slot.

## Pi and Claude adapter

`xt pi|claude <name> --no-attach --json` emits exactly one JSON object on stdout after Core has created the worktree and tmux pane. Existing invocations retain their human output and the exact `session_name:pane_id` detached result.

The structured mode is deliberately narrow:

- `--json` requires `--no-attach`;
- `--json` rejects `--reuse` before worktree creation;
- Pi and Claude argv, exit codes, pane metadata, and default output do not change;
- existing rejected/failed launch paths retain their established non-zero exit and stderr behavior in K2;
- the builder rejects unsafe input strings before emission, and contract tests validate every emitted shape against the packaged schema.

The adapter records `readiness.status=unverified` and `source=tmux-pane`. A live pane proves that the tmux mutation completed; it does not prove that the runtime accepted its first turn. The adapter therefore never fabricates `ready` or a runtime thread identifier. Pi and Claude keep `thread_id=null` until their released harnesses expose an exact identifier through this launch seam.

If worktree session metadata cannot be persisted, the adapter reports `status=degraded` with `reason_code=session_created_metadata_not_persisted` and omits the metadata-dependent resume action. The live tmux session remains attachable.

## Safety profiles

The Pi adapter records the current native-runtime permission boundary. The Claude adapter records the released `--dangerously-skip-permissions` behavior. Both record `hook_trust=preserved`; neither profile introduces a hook-trust bypass.

These fields characterize released behavior. The future Codex adapter will use its separate managed YOLO and `--no-yolo` profiles without aliasing either existing runtime.

## Exact actions

The detached result includes four optional actions:

1. attach to the live tmux session, or switch the current client when invoked from inside tmux;
2. resume through `xt attach <branch>` after the tmux session ends;
3. inspect drift with `xt doctor`;
4. close through `xt end` from the owned worktree.

`argv` is authoritative. `display` is derived from it with shell-safe quoting. No action contains shell chaining.

## Compatibility and sequencing

This K2 slice proves the common shape with existing Pi and Claude launchers. It does not depend on `ResolvedChain`, `specialists.execution.v1`, the chain reducer, MCP, plugins, or a production Codex launcher. A contract-only release is required only if xtmux or Specialists must consume the packaged schema before their K3 compatibility work.
