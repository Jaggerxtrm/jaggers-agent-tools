---
name: sre-ops
description: >
  Operational/SRE stack for live service health, incident triage, causal production
  debugging, observability-driven diagnosis, deploy verification, capacity/resource
  pressure, rollback evidence, and service-specific routing. Use when an alert fires, a
  service is unhealthy, a deployment may have regressed behavior, resource pressure
  appears, or an operator asks what changed and why production broke. Reconstruct the
  chain from runtime symptom through traces/metrics/dashboards to deploy, commit, Bead,
  and original change intent before choosing a remediation.
---

# SRE Ops

SRE investigation starts from the live failure window and reconstructs causality across
runtime and source history.

```text
alert / user-visible symptom
  -> first bad metric/trace/request/job
  -> affected service/dependency path
  -> deployment/release present at first bad time
  -> commits introduced by that deployment
  -> PR / Bead / XTRM worker that produced the change
  -> why the change was made
  -> mechanism connecting change/state to symptom
  -> remediation + rollback + post-change proof
```

Do not stop at “container is unhealthy,” “latency increased,” or “this commit is recent.”
The investigation should explain how the evidence fits together.

## Route by incident shape

| Need | Read |
|---|---|
| Current health / alert / unknown outage | `references/triage.md` |
| Reconstruct runtime -> deploy -> source/work provenance | `references/causal-tracing.md` |
| A merge/redeploy needs a monitored verification window | `references/deploy-monitoring.md` |
| CPU, memory, disk, runner or machine pressure | `references/capacity.md` |
| Multi-surface incident and evidence synthesis | `references/incident-response.md` |

The bundled `scripts/` directory contains deterministic historical-alert helpers retained
from the previous SRE triage skill. Execute them when the reference calls for them; do not
load script source unless debugging the helper itself.

## Observability is an evidence system

When the project provides Prometheus, Grafana, Tempo/OpenTelemetry, logs, and direct health
signals, use them together rather than treating one green query as proof.

- **Prometheus**: alerts, availability, error/latency/throughput/freshness/saturation and
  relevant before/after time series.
- **Grafana**: discover and inspect the service/stack dashboards and their relevant panels,
  variables and time ranges. Query the underlying panel data when possible; do not reduce
  Grafana to a screenshot or a single headline number.
- **Tempo / tracing**: search the affected time window and services, follow representative
  traces across service boundaries, inspect error spans/status/duration and compare bad
  traces with known-good traces.
- **Logs**: correlate using timestamps, request/trace/correlation IDs and first occurrence.
- **Deployment/source history**: identify the artifact/revision and the work that created
  it.

Use the current MCP/mcpq/native observability surfaces and live help. Project-specific
server/tool prefixes are discovered, never hardcoded into this generic skill.

## SRE invariants

1. Live runtime evidence beats cached documentation.
2. A recent change is a suspect only after timing/path evidence connects it to the failure.
3. Diagnose before mutating production; read-only evidence collection is the first phase.
4. Query relevant Grafana dashboards fully when they exist, alongside raw metrics/traces.
5. Route affected services to current service knowledge/specialists when available.
6. Missing required observability is `UNKNOWN`/`BLOCKED`, never healthy.
7. A deploy monitor proves the intended artifact is actually running before judging it.
8. The first abnormal deploy-window sample is actionable; do not hide it in an average.
9. Operational changes require explicit ownership, rollback, and post-change evidence.
10. Record the root cause including deploy/commit/work-contract provenance, not only the
    immediate technical symptom.

## XTRM integration

Use `/engineering-quality` for the general causal-debugging method and source-level
regression discipline. Use `/using-xtrm` contracts for remediation handed to another
worker, `/multiplexing` for a coordinated incident team, and `/using-specialists` when a
bounded SRE/observability/change-forensics specialist is appropriate.

SRE Ops stays an optional pack because it is a production-operations domain capability,
not because it is low value. Infrastructure-heavy environments such as Mercury should
enable it globally or per project with `xt skills`.