# Production causal tracing

Use when an outage, alert, latency/error spike, stale feed, or behavioral regression may
be associated with a recent deploy/change.

The goal is a time-ordered causal graph, not a list of suspicious signals.

## 1. Bound the failure window

Find the earliest bad observation and last known good state from alerts, metrics, traces,
logs, direct probes, and operator reports. Use exact timestamps and the service timezone/UTC
consistently.

Do not use “currently healthy” to dismiss a past incident.

## 2. Query the full observability picture

### Prometheus

Inspect relevant time series across a window that includes healthy baseline before the
failure and recovery/current state after it. Include availability, errors, latency,
throughput, saturation, freshness/SLO signals and firing alert history relevant to the
service.

### Grafana

When Grafana dashboards exist for the affected service/stack, inspect them as a required
part of triage:

1. discover the relevant dashboard(s), not only a remembered URL;
2. inspect dashboard variables and panel definitions so the query scope is understood;
3. query/render the relevant panel data across the failure window;
4. compare before/after behavior and neighboring correlated panels;
5. follow links/drilldowns to logs/traces when available;
6. record dashboard/panel/query identity in the incident evidence.

A screenshot can help a human, but the underlying time-series/query evidence is more
important than an image.

### Tempo / OpenTelemetry

Search the failure window and affected service. Select representative bad traces plus
known-good comparisons. Follow the trace end-to-end and inspect:

- span errors/status;
- duration changes and the first slow/failing span;
- service/dependency transitions;
- attributes that identify route, job, source, symbol/version when available;
- correlated logs/metrics/exemplars.

A trace should help answer **where the request/job first becomes wrong**, not merely prove
that an error span exists.

### Logs

Build a timeline using timestamps and trace/request/job/correlation IDs. Find the first
meaningful deviation and events immediately before it. Avoid reading only the final stack
trace line.

## 3. Identify the deployed artifact

Resolve what code/config/image/revision was actually running at the first-bad time:
container image/digest and start time, Kubernetes/GitOps revision, release SHA, committed
CLI artifact, or equivalent deployment receipt.

List deployments/releases around the good->bad boundary. A deployment that happened after
the incident began cannot be its cause.

## 4. Reconstruct source/work provenance

For each deployment/commit plausibly on the affected path, inspect:

```bash
git show --format=fuller <sha>
git log --format=fuller --date=iso <good>..<bad>
```

Then follow available XTRM/GitHub evidence:

```text
commit body + diff
  -> PR body/review/merge time
  -> Bead contract/notes/dependencies
  -> peer/worktree or Specialist result when recoverable
  -> original problem, constraints and intended success condition
```

This matters because a rollback/fix must preserve the valid reason the original change
was introduced. “Newest commit” is not a root cause.

## 5. Connect the two halves

The candidate change becomes causal only when evidence connects:

```text
change in source/config/state
  -> affected runtime path/span/query
  -> first wrong intermediate state
  -> observed alert/user symptom
```

Use source reads and `/gitnexus` to verify the code/control/data path. Use observability to
verify that path actually executed in the bad window.

Strong evidence may include:

- failure starts immediately after a deployment containing the change;
- bad traces execute the changed path while good traces do not;
- a metric/panel transition matches the changed behavior;
- rollback or a controlled reproduction removes the symptom;
- source/data-flow inspection explains the mechanism.

Timing alone is insufficient.

## 6. Produce a root-cause record

Persist:

```text
Incident window:
First bad / last good:
Affected services/users/data:
Runtime evidence: Prometheus / Grafana / Tempo / logs
First failing span/boundary:
Deployment/revision:
Commit(s) / PR / Bead / worker provenance:
Original change intent:
Confirmed causal mechanism:
Competing hypotheses ruled out / unresolved:
Remediation:
Rollback:
Post-change verification plan:
```

If causality remains uncertain, say so and rank the remaining hypotheses. Do not convert a
likely correlation into a definitive RCA.