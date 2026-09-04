# Live health and alert triage

Start from the current failure window and observability surfaces. In XTRM environments
these are often reachable through `mcpq`/MCP for Prometheus, Grafana, Tempo/OpenTelemetry
and logs, but discover the installed tools/server prefixes from live help.

## Initial evidence sweep

1. firing/current alert state and alert history for the window;
2. down/unready targets, containers or dependency failures;
3. service-specific availability/error/latency/throughput/freshness signals;
4. resource saturation when relevant;
5. relevant **Grafana dashboards and panels** across the failure window;
6. representative **Tempo traces**, including bad and known-good comparisons;
7. correlated logs using trace/request/job IDs;
8. current deployment/revision plus deploys around the good->bad boundary.

Do not stop after the first red metric. The objective is to identify the first failing
boundary and enough correlated evidence to choose a causal hypothesis.

## Grafana requirement

If the project has a dashboard for the affected service/stack, use it. Inspect its
variables and underlying panel queries/data, compare the failure window with a healthy
baseline, and follow useful drilldowns. A screenshot alone is not a completed Grafana
check.

## Trace requirement

Use Tempo/OpenTelemetry to follow representative affected requests/jobs through service
boundaries. Identify the first error/latency/state deviation, not merely the final error
span. Compare against a good trace where possible.

## Classify current state

Classify `HEALTHY`, `DEGRADED`, `CRITICAL`, or `UNKNOWN` from cited live evidence. This
classification describes current/runtime health; it is not yet the RCA.

Project-specific container/repo mappings, feed cadences, alert names, dashboards and
service ownership must come from current project config/service knowledge.

## Move from triage to causality

For a regression or unexplained incident, load `causal-tracing.md`. Reconstruct:

```text
first bad runtime evidence
  -> deployed artifact/revision
  -> commits in the regression window
  -> PR / Bead / worker provenance and original intent
  -> source/control/data path
  -> confirmed or ranked causal hypothesis
```

A recent deploy is a lead, not proof.

## Past alert that already resolved

When the operator reports a past alert, do not conclude “healthy now” means false alert.
Use the bundled historical helpers when compatible:

```bash
python3 <sre-ops-skill-dir>/scripts/alert_history.py --hours <N>
python3 <sre-ops-skill-dir>/scripts/alert_investigator.py --alert <name> --hours <N>
```

Then still correlate the event with dashboards, traces/logs and change/deploy history when
the evidence exists.

## Remediation boundary

Triage is read-only. Once root cause is supported, create/update an XTRM remediation
contract including causal evidence, original change intent, rollback, and post-change
validation. Do not turn investigation into an untracked production mutation.