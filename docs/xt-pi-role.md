# `xt pi --role` and `xt claude --role`

Interactive **specialist role launcher.** Boots a fresh pi (or claude) session in a sandboxed worktree, wired up as a named specialist (via `sp view`), with the pane's `@agent_*` metadata already set for orchestrator routing.

The same flag surface works for both runtimes; differences are called out explicitly below.

---

## Quick start

```bash
# Launch pi as chain-coordinator, tracked to bead xyz-1
xt pi --role chain-coordinator --bead xyz-1

# Same for claude, with one deliberate extra skill
xt claude --role reviewer --bead xyz-1 --skill code-review
```

Inside `$TMUX`, both commands **run in the current pane** by default — no nested-tmux warning, no new session in `tmux ls`. Outside `$TMUX`, both create a new tmux session and attach.

With `--bead`, the launcher first calls `sp render-task <role> --bead <id> --cwd <original-cwd> --context-depth 3 --surface <runtime>`. Any renderer error stops before worktree or tmux provisioning. The role system prompt remains unchanged; the rendered task is written mode `0600` under the ignored worktree `.xtrm/` and passed as the final `@file` initial-user argument. Process arguments and telemetry therefore expose only the file path and renderer metadata, never the task body. Without `--bead`, no initial task is sent.

---

## Flag surface

| Flag | Meaning | Notes |
| --- | --- | --- |
| `--role <name>` | Resolve `<name>` via `sp view <name> --raw` and boot the runtime with the specialist's system prompt, skills, model, and thinking level. | The role's `execution.model` / `execution.thinking_level` from `sp view` are the defaults; CLI flags override. |
| `--bead <id>` | Attach `<id>` to the pane via `@agent_bead`; also included in the session name slug (`role-<runtime>-<slug>-<bead>`). | Optional. Enables `bv` claim discovery and hook-based gating. |
| `--no-attach` | New-session mode only. Print `session_name:pane_id` on stdout and exit — orchestrator-capture pattern. | Inside `$TMUX` without `--new-session`, `--no-attach` **errors** with a clear hint. |
| `--model <name>` | Forward `--model <name>` to the runtime; overrides `specialist.execution.model`. | Both pi and claude accept `--model`. |
| `--thinking <level>` | pi only. Forward `--thinking <level>`; overrides `specialist.execution.thinking_level`. | claude has no `--thinking` flag — `xt claude --thinking X` warns loudly and drops. |
| `--skill <name-or-path>` | Load one additional skill at startup; repeatable. | Names resolve through project/global runtime skill locations. Pi receives `--skill`; Claude receives an ephemeral plugin under the worktree's ignored `.xtrm/`. Invalid skills fail before worktree creation. |
| `--new-session` / `--ns` | Force a fresh tmux session even when inside `$TMUX`. | Default outside `$TMUX`. Combines with `--no-attach`. |
| `--parent <target>` | Override `@agent_parent_session` on the target pane. `<target>` = tmux session name, session id (`$3`), or `#{session_id}` string. | Bogus targets fail with a clear error before the runtime spawns. Precedence: `--parent` > `--child` > auto. |
| `--child` | Explicit form of the auto-behavior (`@agent_parent_session` = current pane's `#{session_id}`). | Kept as a stable opt-in against a future default flip. |
| `--reuse` | Only with `--new-session` (or outside `$TMUX`): if a session with the resolved name already exists, attach to it (or, with `--no-attach`, print its coordinates) instead of auto-suffixing. | Skips `agent.role.launched` emission — we don't own the reused pane's metadata. |
| `--` `<passthrough>` | Everything after `--` forwarded verbatim to the runtime. | Guarded flags (`--session-dir`, `--name`, `--system-prompt`, `--append-system-prompt`, `--skill`) are rejected. Batch-mode flags (`--print`, `--list-models`, `--export`, `--mode`) are dropped with a warning. |

Run `xt pi --help` or `xt claude --help` for the canonical (auto-generated) flag list plus concrete examples.

---

## Behavior matrix

| Context | Flags | Result |
| --- | --- | --- |
| inside `$TMUX` | (none) | Runtime runs in the **current pane**; pane options + `XTMUX_AGENT_*` env set on this pane. `tmux ls` unchanged. |
| inside `$TMUX` | `--new-session` | New session (`role-<runtime>-<slug>-<bead>`); `switch-client` moves the current client to it. |
| inside `$TMUX` | `--new-session --no-attach` | New session detached; prints `session_name:pane_id` on stdout. Exit 0. |
| inside `$TMUX` | `--no-attach` alone | **Error** — `--no-attach requires --new-session (or exit tmux first)`. |
| outside `$TMUX` | (any) | New session; `attach-session` attaches. `--no-attach` still valid. |

**Session-name collision.** When the resolved session name (`role-<runtime>-<slug>[-<bead>]`, e.g. `role-pi-chain-coordinator-xyz-1` vs `role-claude-chain-coordinator-xyz-1`) is already in use, the launcher does one of two things:

- `--reuse` passed → attach to the existing session (or print `session:pane` with `--no-attach`) and exit. Skips the pane-option write + `agent.role.launched` emission since the pane is not fresh.
- otherwise → auto-suffix a 4-char hex slug and retry up to 10 times (`role-<runtime>-<slug>[-<bead>]-<hex>`). If all 10 candidates collide, errors with a hint to pass `--reuse` or free some session names.

---

## Session names

Session names encode both the runtime and the specialist role so `xt pi --role X` and `xt claude --role X` produce distinguishable sessions:

```
role-pi-<role-slug>[-<bead-slug>]
role-claude-<role-slug>[-<bead-slug>]
```

Example: `xt pi --role chain-coordinator --bead xyz-1` → `role-pi-chain-coordinator-xyz-1`; `xt claude --role chain-coordinator --bead xyz-1` → `role-claude-chain-coordinator-xyz-1`. Both coexist without `--reuse` or auto-suffix.

## Pane options set at launch

The launcher writes these on the target pane (current pane by default, new session's first pane in `--new-session` mode). The picker + safe-send-pointer + handoff all consume them.

| Option | Value |
| --- | --- |
| `@agent_task` | `role:<name>` |
| `@agent_parent_session` | Resolved `#{session_id}` (see `--parent` precedence above) |
| `@agent_state` | `idle` — set at spawn so the picker sees the pane immediately (before the runtime's own agent-state hook fires) |
| `@agent_prompt_file` | Path to the transported system-prompt file — picker preview + handoff read this |
| `@agent_bead` | Only set when `--bead <id>` was passed |

---

## Environment variables exported to the runtime

Redundant with pane options on purpose — env survives re-execs the way pane options don't. `scripts/agent-state.sh` reads these on first turn.

| Variable | Source |
| --- | --- |
| `XTMUX_AGENT_TASK` | `role:<name>` |
| `XTMUX_AGENT_PROMPT_FILE` | Same file as `@agent_prompt_file` |
| `XTMUX_AGENT_PARENT_SESSION` | Same value as `@agent_parent_session` |
| `XTMUX_AGENT_BEAD` | Only set when `--bead <id>` was passed |

In `--new-session` mode these are exported via `tmux new-session -e KEY=VAL ...` so they land in the new pane's environment. In current-pane mode they're passed to the runtime via `spawnSync`'s `env`.

---

## Log emission

At launch time (both modes) the launcher shells out to `tmux-session-picker` to emit `agent.role.launched` plus a companion `agent.role.task-rendered` event containing renderer outcome, prompt hash, and bounded component sizes. It never logs the rendered body. Log emission is non-fatal if the picker binary is missing.

Query the log with `tmux-session-picker log query --type agent.role.launched --since 2h` for a "who spawned what" audit trail.

---

## Skill and model resolution

**Skills.**

- **pi.** `specialist.skills.paths[]` from `sp view` are resolved:
  1. absolute or `~`-prefixed → used verbatim
  2. relative + exists at repo root → repo-local override
  3. relative + exists at `$HOME` → canonical global (post-`xtrm-bq7yd` migration; see the CHANGELOG entry for xtrm-1rn)
  4. otherwise → repo-resolved path so pi produces a loud "skill not found" error at the exact absolute location the operator can fix
- **claude.** Specialist-declared and explicit skills are exposed deliberately through an ephemeral `--plugin-dir` under the worktree's gitignored `.xtrm/`, using Claude's native `skills/<name>/SKILL.md` convention.
- **explicit requests.** `--skill` accepts an installed skill name, a skill directory, or a `SKILL.md` path. Requests are validated and realpath-deduplicated against specialist-declared skills before provisioning. Project runtime locations win over global pointers from the post-migration layout.

**Model.**

CLI `--model` wins over `specialist.execution.model` (from `sp view`), which wins over the runtime's own default. `sp view <name> --raw` returns the **merged effective spec** (package canonical + user overrides via `sp edit --global`) — the launcher does not need to re-apply overrides.

**Extensions (pi).**

The launcher no longer emits `--no-extensions -e <name>`. `pi -e` takes a filesystem path (not a registry name), and the prior curated allow-list caused silent startup crashes (see xtmux-3rs). pi discovers its own extensions from `~/.pi/agent/settings.json` plus any per-repo settings.

## `sp run` parity boundary

| Component | Interactive role behavior |
| --- | --- |
| Effective specialist + system prompt | Same `sp view` resolution; role-only system prompt remains separate from the task. |
| Task template, bead/dependency context, boundary rules | Same specialists-owned `renderTaskPrompt` seam through `sp render-task`. |
| Mandatory rules | Same ordering and token limit; renderer failure is fatal for tracked interactive launch. |
| Pre-script output | Deliberately omitted: executing pre-scripts is job-runtime behavior. |
| Reviewer git-diff context | Deliberately omitted: execution-only and unavailable before the interactive session starts. |
| Job/RPC/status creation | Not applicable: rendering is read-only; `xt` owns only its sandbox worktree/tmux session. |
| Skills | Specialist-declared skills are loaded deliberately at startup; repeatable `xt --skill` adds deduplicated session-only skills. |

---

## Coordination pattern

A parent Claude Code / pi orchestrator spawns a child role session, drives it via `tmux-session-picker message-send`, and consumes its `turn done: …` messages:

```bash
# Parent orchestrator, from inside its own tmux session
xt pi --role researcher --bead xyz-1 --no-attach --new-session > /tmp/child.addr
# child.addr contains "role-researcher-xyz-1:%42"
CHILD_TARGET=$(cat /tmp/child.addr)

# Route a task to the child
tmux-session-picker message-send \
  --to "$CHILD_TARGET" \
  --bead xyz-1 \
  --text "Please summarize the ~/notes/design.md brief."

# Later, poll the parent's inbox for the child's turn-done reply
tmux-session-picker message-list --for "$(tmux display-message -p '#{session_id}')" \
  --unacked --since 15m
```

The child role can escalate policy calls back to the parent by resolving its own `@agent_parent_session` pane option and calling `message-send` in the reverse direction.

---

## Related

- `xt pi --help` / `xt claude --help` — canonical flag list with examples.
- [docs/worktrees.md](worktrees.md) — the sandbox worktree model that underpins the launcher.
- `xtmux-1lb` epic in beads — surface completion history.
