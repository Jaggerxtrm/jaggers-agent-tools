# Runtime debugging

Debug XTRM from authoritative state: installed package/version, active skill view, hook or
extension registration, Beads events/state, agent/session identity, worktree/branch, and
structured logs/observability DBs.

Do not infer runtime state from terminal appearance alone. Reproduce at the smallest
boundary, inspect the event/envelope, then trace through the responsible adapter/runtime
owner.