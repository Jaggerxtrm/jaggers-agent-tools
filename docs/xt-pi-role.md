# `xt pi --role` and `xt claude --role`

Interactive **specialist role launcher.** Boots a fresh pi (or claude) session in a sandboxed worktree, wired up as a named specialist (via `sp view`), with the pane's `@agent_*` metadata already set for orchestrator routing.

The same flag surface works for both runtimes; differences are called out explicitly below.

---

## Quick start

```bash
# Launch pi as chain-coordinator, tracked to bead xyz-1
xt pi --role chain-coordinator --bead xyz-1

# Same for claude
xt claude --role reviewer --bead xyz-1
```

Inside `$TMUX`, both commands **run in the current pane** by default — no nested-tmux warning, no new session in `tmux ls`. Outside `$TMUX`, both create a new tmux session and attach.

---

## Flag surface

| Flag | Meaning | Notes |
| --- | --- | --- |
| `--role <name>` | Resolve `<name>` via `sp view <name> --raw` and boot the runtime with the specialist's system prompt, skills, model, and thinking level. | The role's `execution.model` / `execution.thinking_level` from `sp view` are the defaults; CLI flags override. |
| `--bead <id>` | Attach `<id>` to the pane via `@agent_bead`; also included in the session name slug (`role-<slug>-<bead>`). | Optional. Enables `bv` claim discovery and hook-based gating. |
| `--no-attach` | New-session mode only. Print `session_name:pane_id` on stdout and exit — orchestrator-capture pattern. | Inside `$TMUX` without `--new-session`, `--no-attach` **errors** with a clear hint. |
| `--model <name>` | Forward `--model <name>` to the runtime; overrides `specialist.execution.model`. | Both pi and claude accept `--model`. |
| `--thinking <level>` | pi only. Forward `--thinking <level>`; overrides `specialist.execution.thinking_level`. | claude has no `--thinking` flag — `xt claude --thinking X` warns loudly and drops. |
| `--new-session` / `--ns` | Force a fresh tmux session even when inside `$TMUX`. | Default outside `$TMUX`. Combines with `--no-attach`. |
| `--parent <target>` | Override `@agent_parent_session` on the target pane. `<target>` = tmux session name, session id (`$3`), or `#{session_id}` string. | Bogus targets fail with a clear error before the runtime spawns. Precedence: `--parent` > `--child` > auto. |
| `--child` | Explicit form of the auto-behavior (`@agent_parent_session` = current pane's `#{session_id}`). | Kept as a stable opt-in against a future default flip. |
| `--reuse` | Only with `--new-session` (or outside `$TMUX`): if a session with the resolved name already exists, attach to it (or, with `--no-attach`, print its coordinates) instead of auto-suffixing. | Skips `agent.role.launched` emission — we don't own the reused pane's metadata. |
| `--` `<passthrough>` | Everything after `--` forwarded verbatim to the runtime. | Guarded flags (`--session-dir`, `--name`, `--system-prompt`, `--append-system-prompt`) are rejected. Batch-mode flags (`--print`, `--list-models`, `--export`, `--mode`) are dropped with a warning. |

Run `xt pi --help` or `xt claude --help` for the canonical (auto-generated) flag list plus concrete examples.

---

## Behavior matrix

| Context | Flags | Result |
| --- | --- | --- |
| inside `$TMUX` | (none) | Runtime runs in the **current pane**; pane options + `XTMUX_AGENT_*` env set on this pane. `tmux ls` unchanged. |
| inside `$TMUX` | `--new-session` | New session (`role-<slug>-<bead>`); `switch-client` moves the current client to it. |
| inside `$TMUX` | `--new-session --no-attach` | New session detached; prints `session_name:pane_id` on stdout. Exit 0. |
| inside `$TMUX` | `--no-attach` alone | **Error** — `--no-attach requires --new-session (or exit tmux first)`. |
| outside `$TMUX` | (any) | New session; `attach-session` attaches. `--no-attach` still valid. |

**Session-name collision.** When the resolved session name (`role-<slug>[-<bead>]`) is already in use, the launcher does one of two things:

- `--reuse` passed → attach to the existing session (or print `session:pane` with `--no-attach`) and exit. Skips the pane-option write + `agent.role.launched` emission since the pane is not fresh.
- otherwise → auto-suffix a 4-char hex slug and retry up to 10 times (`role-<slug>[-<bead>]-<hex>`). If all 10 candidates collide, errors with a hint to pass `--reuse` or free some session names.

---

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

At launch time (both modes) the launcher shells out to `tmux-session-picker` to emit an `agent.role.launched` event with `pane`, `session`, `bead`, `role`, `parent`, `worktree` fields. Non-fatal if the picker binary is missing.

Query the log with `tmux-session-picker log query --type agent.role.launched --since 2h` for a "who spawned what" audit trail.

---

## Skill and model resolution

**Skills.**

- **pi.** `specialist.skills.paths[]` from `sp view` are resolved:
  1. absolute or `~`-prefixed → used verbatim
  2. relative + exists at repo root → repo-local override
  3. relative + exists at `$HOME` → canonical global (post-`xtrm-bq7yd` migration; see the CHANGELOG entry for xtrm-1rn)
  4. otherwise → repo-resolved path so pi produces a loud "skill not found" error at the exact absolute location the operator can fix
- **claude.** No `--skill` flag; claude reads `.claude/skills/` from cwd. The worktree launcher scaffolds that symlink automatically.

**Model.**

CLI `--model` wins over `specialist.execution.model` (from `sp view`), which wins over the runtime's own default. `sp view <name> --raw` returns the **merged effective spec** (package canonical + user overrides via `sp edit --global`) — the launcher does not need to re-apply overrides.

**Extensions (pi).**

The launcher no longer emits `--no-extensions -e <name>`. `pi -e` takes a filesystem path (not a registry name), and the prior curated allow-list caused silent startup crashes (see xtmux-3rs). pi discovers its own extensions from `~/.pi/agent/settings.json` plus any per-repo settings.

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
