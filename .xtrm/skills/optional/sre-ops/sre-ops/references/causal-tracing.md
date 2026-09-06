# Production causal tracing

Use when an outage, alert, latency/error spike, stale feed, or behavioral regression may
be associated with a deploy, config/flag/schema/infra change, or other recent state
transition.

The goal is a time-ordered **causal graph** across signal type, time, service topology,
and change provenance — not a list of suspicious signals.

## 1. Bound one incident window

Find the earliest bad observation and last known good state from alerts, metrics, traces,
logs, direct probes, deployment events, and operator reports. Normalize timestamps to UTC
for the investigation even if dashboards display local time.

Use a window with enough healthy baseline before the failure and recovery/current state
after it. Do not use “currently healthy” to dismiss a past incident.

## 2. Build a multi-signal anomaly bundle

Collect evidence over the **same window** so signals can be correlated rather than viewed
as unrelated snapshots.

### Prometheus / metrics

Inspect relevant availability, errors, latency, throughput, saturation, freshness/SLO and
alert-history series. Look for the first material transition and which labels/services
move together.

When exemplars or trace IDs are attached to metrics, follow them into representative
traces. A metric spike plus its exemplar is stronger than separately searching for an
unrelated trace later.

### Grafana

Relevant dashboards are a required investigation surface when available:

1. discover the service/stack dashboard(s), not only a remembered URL;
2. inspect variables, panel definitions and datasource/query scope;
3. query/render relevant panel data over the incident window;
4. compare healthy baseline, incident and recovery;
5. inspect neighboring panels that should co-move if the hypothesis is true;
6. use dashboard/panel links and drilldowns to traces/logs/profiles where available;
7. record dashboard UID/title, panel/query identity and time range in durable evidence.

Do not treat a screenshot or one headline panel as sufficient evidence. Grafana is a query
and correlation surface, not only a visual artifact.

### Tempo / OpenTelemetry traces

Search the same incident window and affected services. Select representative bad traces
and known-good comparisons. Follow each trace end-to-end and identify the **first** span
where behavior diverges:

- error/status transition;
- duration increase;
- unexpected retry/fan-out;
- missing/changed attribute;
- service/dependency transition;
- version/revision/route/job/source attributes where instrumented.

Use trace-to-logs and trace-to-metrics links when available. If profiling is connected,
use trace-to-profile correlation for CPU/contention/allocation regressions rather than
assuming the slow span tells you why it is slow.

### Logs

Correlate by trace/request/job/correlation ID and timestamp. Cluster repeated error/event
shapes when volume is high and find the first meaningful deviation before the terminal
error. Rare/new log clusters around the first-bad boundary are useful hypotheses, not
proof by themselves.

## 3. Use topology before blaming the alerting service

In distributed systems the service that alerts is often the **sink** of a failure, not its
origin.

Use an OpenTelemetry/Tempo Service Graph or equivalent live dependency map derived from
actual traffic when available. Starting from the affected service/user boundary, traverse
upstream dependencies and compare evidence at each node/edge.

```text
user symptom at C
  <- C receives bad/slow response from B
  <- B first becomes abnormal while calling A/database/queue
  <- origin candidate
```

Prefer topology observed during the incident window over a static architecture diagram.
Service Graph RED signals (rate/errors/duration) are especially useful for identifying
which edge first changed.

The root candidate should explain both its own anomaly and the downstream propagation
path. A downstream service that only reports the propagated error is not the root cause.

## 4. Fingerprint the failing execution sequence

When many traces/jobs fail similarly, reduce them to a repeated sequence fingerprint:
service/span path, error transition, important attributes and timing shape. Compare the
dominant bad fingerprint with good traffic.

This helps distinguish one causal path repeated thousands of times from many independent
symptoms, and keeps RCA focused on the earliest shared divergence.

## 5. Identify the exact runtime state and change candidates

Resolve what was actually running at first-bad time: image/digest, release SHA,
Kubernetes/GitOps revision, committed CLI artifact, configuration version, schema state,
feature flags, infrastructure revision, or equivalent deployment receipt.

Build a bounded change set around the good->bad boundary. Candidates include more than
Git commits:

- deploy/release/image changes;
- config or environment changes;
- feature-flag changes;
- schema/migration/data-contract changes;
- dependency/package updates;
- infrastructure/network/policy changes;
- manual hotfix/operator actions;
- traffic/workload shape changes when no system change occurred.

A change after the incident began cannot be the initial cause. A change immediately
before it is still only a candidate.

## 6. Reconstruct source/work provenance

For code/config commits on the affected path, use the deterministic provenance helper
from `/engineering-quality` when available, then inspect the most credible candidates in
detail.

```text
commit body + actual diff
  -> PR body/review/merge time
  -> Bead contract/notes/dependencies
  -> peer/worktree or Specialist result when recoverable
  -> original problem, constraints and intended success condition
```

This matters because a rollback/fix must preserve the valid reason the original change
was introduced. Distinguish:

- **introduced by** — the defect itself was added by this change;
- **exposed by** — a valid change activated an older latent defect;
- **correlated with** — time-adjacent but mechanism not proven.

## 7. Connect change evidence to runtime evidence

A candidate becomes causal only when the graph closes:

```text
change/state transition
  -> code/config/data path
  -> first abnormal service/span/query/state
  -> propagation through topology
  -> observed alert/user symptom
```

Use `/gitnexus` and targeted source reads to verify the code/control/data path. Use the
observability bundle to prove that path executed in the bad window.

Strong evidence includes combinations such as:

- first bad signal begins only after the exact deployed revision appears;
- bad traces execute the changed path while comparable good traces do not;
- the first abnormal Service Graph edge matches the changed dependency behavior;
- Prometheus/Grafana transition matches the mechanism predicted by the code/config change;
- trace/log/profile evidence identifies the expected failure or contention point;
- a controlled reproduction, targeted rollback, feature-flag reversal or fixed build
  removes the symptom while preserving other variables;
- source/data-flow analysis independently explains the observed intermediate state.

Time proximity alone is insufficient. One signal alone is normally insufficient for a
multi-service RCA.

## 8. Challenge the leading hypothesis

Before declaring root cause, deliberately look for disconfirming evidence:

- a bad trace before the candidate change;
- healthy executions using the supposedly causal path under equivalent state;
- another upstream dependency that changed first;
- config/data/workload differences that better explain the affected subset;
- a rollback that fails to restore behavior.

Record competing hypotheses and why they were rejected or remain unresolved. Confidence
comes from converging independent evidence, not from confident prose.

## 9. Persist one causal record

```text
Incident window / last good / first bad:
Affected users/services/data:
Signal bundle:
  Prometheus/Grafana:
  representative bad/good traces:
  logs/profiles/exemplars:
Topology / first abnormal edge or boundary:
Failing sequence fingerprint:
Runtime artifact/config/state:
Change candidate(s):
Commit/PR/Bead/worker provenance:
Original change intent:
Introduced vs exposed vs correlated:
Confirmed causal mechanism:
Propagation path:
Counterevidence / competing hypotheses:
Remediation:
Rollback/containment:
Post-change verification plan:
```

If causality remains uncertain, persist the uncertainty boundary and next discriminating
experiment. Do not convert correlation into a definitive RCA simply to close the
incident.