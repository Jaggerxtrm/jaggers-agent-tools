# Terminal fallback — unsupported runtimes only

Use terminal injection only for a target that has no supported native agent transport (raw shell, vim, REPL, or a broken/missing experimental adapter) and only when the action is appropriate for that terminal.

The old safety constraints still apply to this fallback:

1. Never multiline-paste into `tmux send-keys`.
2. Never embed `$(...)` or backticks in a sent shell string.
3. Never paste a newline-containing buffer as a prompt.
4. Inspect the target pane before terminal injection.
5. Prefer one short literal pointer to a file/work item over a large inline prompt.

Do **not** silently use terminal fallback for Claude/Pi because their native message was held, refused, timed out, or unavailable. Surface the failure; bypassing the native policy through terminal keystrokes invalidates the experiment and may bypass trust controls.
