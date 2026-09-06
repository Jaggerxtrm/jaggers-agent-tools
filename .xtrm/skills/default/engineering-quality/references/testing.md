# Testing strategy

Tests prove behavior at the layer that changed. They are not a coverage-percentage ritual.

## Choose the proof layer

| Change | Evidence floor |
|---|---|
| Pure logic/invariant | unit/property/characterization test |
| Bug/regression | smallest test or reproduction that fails before the fix and passes after |
| API/DB/file boundary | contract/integration evidence |
| CLI/shell/runtime wiring | integration + smoke command |
| agent/hook/MCP/workflow | isolated runtime smoke/E2E + lifecycle evidence |
| production/infra | observability, health, rollback and deploy evidence |

Use TDD when the desired behavior is clear enough to encode before implementation,
especially bugs, invariants, parsers, pure logic and well-specified features. Do not force
TDD ceremony while the actual task is discovering what the correct behavior should be.

A regression test should correspond to the confirmed causal mechanism. A test that passes
against the known-bad revision does not prove the regression unless it is protecting a
different explicit invariant.

Mocks are useful for isolation. They do not replace evidence at the only meaningful
external boundary. When practical, include a real contract/smoke path for integrations.

For fixes, run:

1. the minimal failing reproduction;
2. the targeted new/changed tests;
3. callers or integration tests implicated by GitNexus impact;
4. the project-required broader checks appropriate to the risk.

Record skipped/unavailable checks honestly. “All tests pass” must not mean “the one test I
chose passes.”