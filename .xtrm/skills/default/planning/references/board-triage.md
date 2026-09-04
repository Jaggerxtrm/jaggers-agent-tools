# Board triage

Use when the board is large, duplicated, stale, or no longer reflects current work.

1. Snapshot open/in-progress/blocked work and existing dependencies.
2. Find obvious duplicates mechanically, then verify semantic overlap against current
   implementation surfaces and intent.
3. Group items by real ownership/ship boundary, not similar titles.
4. Close/supersede only when evidence shows one item replaces another.
5. Parent or relate work only when the relationship helps execution or operator scan.
6. Detect dependency cycles and stale blockers after rewiring.
7. Re-evaluate priority from the resulting graph/current goal.

For large boards, use a read-only explorer/critic or code graph evidence to find shared
implementation surfaces. Do not let an AI similarity score mutate the board unattended.

Persist a concise triage result: what changed, what was deliberately left alone, and the
next actionable work.