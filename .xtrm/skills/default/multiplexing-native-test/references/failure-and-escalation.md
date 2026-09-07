# Failure and escalation

Escalate or recover explicitly when:

- target is visible in tmux but absent from native discovery;
- Claude reports a peer message held/refused/expired;
- Pi `ask` times out;
- `pi-claude-link` cannot resolve/bind/reach the Claude peer socket;
- a transport result is ambiguous and a retry could duplicate work;
- two live sessions are writing the same worktree and produce git-state races;
- a target is waiting on a permission prompt that a peer cannot authorize;
- a worker produces off-contract output twice after a native correction.

Recovery order:

```text
native status/discovery
→ native correction / explicit cancel or supersede where supported
→ durable work-state inspection
→ terminal inspection
→ terminal interrupt/kill only when necessary
```

Never hide a native-transport failure by immediately performing the same send through another route.
