# Reply discipline — mandatory

Native messaging must reduce the "forgot to reply / forgot to wake / stalled forever" class.


Therefore:

1. If an inbound message explicitly asks a question or requests a reply, respond through the same native conversation before considering that communication handled.
2. Pi intercom asks: use `reply`; use `pending` to recover lost local context.
3. Claude peer request: use native `SendMessage` reply semantics/addressing, not a local-only answer.
4. Pi receiving through `pi-claude-link`: answer naturally; let the bridge relay the turn result unless a separate explicit message is needed.
5. A completion message should identify the durable result/evidence, not merely say "done".
6. If you cannot answer, send an explicit `blocked`, `cannot-answer`, or escalation message. Silence is not a disposition.
