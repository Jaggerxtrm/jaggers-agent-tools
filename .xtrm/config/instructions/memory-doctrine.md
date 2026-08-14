# BD Memory Doctrine

> Canonical retrieval doctrine for durable cross-session memory. One source shared by Pi (xtrm-loader) and Claude (project-memory hook). `.xtrm/memory.md` is never injected.

## When to retrieve

- Use `bd memories <topic>` when history is relevant to the current question or task. It returns dated leads, not authority.
- Use `bd recall <key>` to retrieve one specific memory by key (e.g. from a lead found via `bd memories`).
- A no-match result is valid: it means the board holds no dated lead on the topic. Answer from live code and state, and record a correction when it is worth remembering.

## How to weigh memories

- Memories are dated leads. A newer memory about the same surface is a stronger lead than an older one, but live code and current state verify — and win — over any memory.
- Never treat a memory as authority for code structure, commands, or current behavior. Read the code, run the command, or inspect state; the memory only tells you where to look first.

## Corrections

- Clearly stale or false memories may be removed with `bd forget <key>`.
- Durable corrections use `bd remember "<insight>" --key <key>`: the key is auto-generated from the content unless given, and storing with an existing key updates that memory in place. Use `bd memories <topic>` first to find the key of the memory being corrected.
