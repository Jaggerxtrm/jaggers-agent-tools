# Native waiting

Do not create an xtmux message obligation, monitor, or wait on a native lane. Compatibility lanes keep their existing xtmux surfaces.


Use the narrowest native mechanism:

- Pi short blocking decision → `intercom ask`.
- Pi long task → `intercom send`; worker sends completion; use `intercom list` for live presence/status when needed.
- Claude long local task → explicit completion reply plus optional `notify_when_idle` one-shot notice.
- Pi↔Claude quick question → `claude-link ask`.
- Pi↔Claude long work → non-blocking native send + explicit completion reply; no bridge polling loop.

Do not busy-poll native peer status. If the peer runtime disappears, classify it separately from "work failed".
