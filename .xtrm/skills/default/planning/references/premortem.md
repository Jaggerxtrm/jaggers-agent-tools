# Premortem

Use before committing to an expensive or risky plan.

Ask: assume this implementation failed in production or wasted a week. What was the most
plausible reason?

Check at least:

- wrong/stale assumption about current code or runtime;
- duplicated authority or new abstraction where an existing primitive sufficed;
- hidden shared state that makes planned parallelism unsafe;
- boundary/auth/data migration/rollback risk;
- tests that prove only mocks or implementation details;
- missing observability/recovery path;
- contract contradiction: SUCCESS cannot be reached without violating NON_GOALS or a
  constraint;
- dependency/release ordering across repositories.

For each credible failure, either change the plan/contract, add explicit validation, or
record why the risk is accepted. Do not turn the premortem into an unbounded list of
hypothetical edge cases.