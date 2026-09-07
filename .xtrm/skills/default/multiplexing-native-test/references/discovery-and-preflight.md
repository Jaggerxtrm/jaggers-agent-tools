# Discovery and pre-flight

### From Pi

For Pi peers:

```typescript
intercom({ action: "list" })
```

For Claude peers:

```typescript
claude-link({ action: "list" })
```

Verify target name/id and cwd before a consequential handoff.

### From Claude Code

Use `ListAgents` or `/list-agents` to see addressable peers. A Pi session running `pi-claude-link` should appear in the same peer list.

Verify the target name and working directory. If native discovery says the target is absent, do not guess a tmux pane and inject the message anyway.

### tmux inventory

Use plain tmux only when you need terminal topology or to account for non-agent panes:

```bash
tmux list-sessions
tmux list-panes -a -F '#{session_name} #{window_id} #{pane_id} #{pane_current_command} #{pane_current_path}'
```

A pane being present does not prove its agent transport is reachable; the native roster decides that.
