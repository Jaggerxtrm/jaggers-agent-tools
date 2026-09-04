# Review

Review the contract and actual diff, not the author's summary.

Prioritize correctness, state/resource safety, boundary behavior, migrations, rollback,
telemetry loss, tests that would catch the defect, and project conventions. Use GitNexus
impact evidence for shared symbols when available.

Existing bot/LLM findings are leads. Verify them against the current diff before acting.
Do not silently override a blocking finding; document why it is invalid if you reject it.

A review verdict must name concrete evidence and unresolved risk. Style preferences that
are neither correctness issues nor enforced project rules are low priority.