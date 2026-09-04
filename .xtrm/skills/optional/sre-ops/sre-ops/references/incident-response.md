# Incident response

For multi-surface incidents, separate evidence lanes instead of making one agent guess
across metrics, logs, host state, and recent changes.

A useful shape is:

```text
incident contract
  -> observability evidence
  -> host/capacity evidence
  -> recent-change/deploy evidence
  -> synthesis/root-cause confidence
  -> remediation contract
  -> deploy/change verification
```

Run independent read-only lanes in parallel only when they do not mutate shared state.
The coordinator owns synthesis and must read the actual evidence/results before choosing
a remediation.

Every incident conclusion should state: observed symptoms, time window, affected
services, strongest root-cause evidence, competing hypotheses rejected/not ruled out,
remediation owner, rollback, and post-change proof.