# End-of-session hygiene

1. Check native rosters first; distinguish disconnected peers from merely idle ones.
2. Use `tmux ls` / `tmux list-panes` to find terminal sessions that remain.
3. Kill only confirmed idle/stale operator-created sessions whose work is safely persisted.
4. `git worktree prune` in affected repos.
5. `sp clean --ps` where Specialists processes were involved.
6. Run `/session-close-report` if loaded.

`pi-intercom` and `pi-claude-link` own their own session disconnect/unregister cleanup. Do not manually delete their sockets/registry files during normal cleanup.
