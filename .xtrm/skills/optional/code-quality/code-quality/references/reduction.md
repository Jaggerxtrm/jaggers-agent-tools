# Evidence-backed reduction

Use the XTRM minimal-engineering ladder: delete/reuse/runtime primitive/stdlib/existing
dependency before custom machinery.

For candidate deletions/inlines, verify callers and dynamic/config usage before cutting.
For performance findings, measure or identify a concrete hot-path cost: synchronous I/O,
N+1 work, redundant reads/parsing, unnecessary sequential awaits, repeated expensive pure
computation, or resource churn.

Do not optimize for line count at the expense of clarity, safety, tests, observability,
or recoverability.