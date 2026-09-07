# Operator-help patterns

| Pattern | Trigger | Native-messaging flow |
|---|---|---|
| Inventory | "what's running", "session map" | `ListAgents` + `intercom list` + `claude-link list`; tmux only to account for raw terminal panes |
| Assisted handoff | "send X to Y", "delegate to Y" | durable work pointer → native roster → native `send`/`SendMessage` |
| Clarification | worker is blocked | Pi `ask`; Claude explicit request/reply; cross-harness `claude-link ask` only for short questions |
| Completion watch | long-running Claude work | `SendMessage` + explicit completion reply; optionally `notify_when_idle` |
| Cleanup | dead/idle sessions | native roster first → terminal/process check → kill only confirmed stale terminal sessions → prune worktrees |
| Messy-run recovery | off-contract or wrong direction | native correction first; cancel/supersede where supported; terminal interrupt only if runtime cannot recover conversationally |
| Multi-session goal | one outcome across N sessions | one parent work item + child ownership per worker + native handoffs + aggregate durable evidence |
| Sprint coordination | review/deploy workers | durable work graph + native peer messages; domain-specific `/pr-reviewer`/`/deploy-monitor` stay authoritative for their own policy |
