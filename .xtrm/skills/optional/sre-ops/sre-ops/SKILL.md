---
name: sre-ops
description: >
  Operational/SRE stack for live service health, incident triage, observability-driven
  diagnosis, deploy verification windows, capacity/resource pressure, rollback evidence,
  and service-specific routing. Enable this pack for infrastructure and production
  operations such as Mercury. Use when an alert fires, a service is unhealthy, a deploy
  must be proven live and safe, resource pressure appears, or an operator asks for an
  SRE health/incident investigation.
---

# SRE Ops

SRE work starts from the live system, not the repository.

This umbrella preserves the useful parts of the former `sre-triage`, `deploy-monitor`,
and `capacity-reclaim` skills while avoiding three overlapping top-level triggers.

## Route by incident shape

| Need | Read |
|---|---|
| Current health / alert / unknown outage | `references/triage.md` |
| A merge/redeploy needs a monitored verification window | `references/deploy-monitoring.md` |
| CPU, memory, disk, runner or machine pressure | `references/capacity.md` |
| Multi-surface incident and evidence synthesis | `references/incident-response.md` |

The bundled `scripts/` directory contains deterministic historical-alert helpers retained
from the previous SRE triage skill. Execute them when the reference explicitly calls for
them; do not load their source into context unless debugging the script itself.

## SRE invariants

1. Live metrics/logs/traces/health state beat cached documentation.
2. Discover project-specific service/container/alert mappings; never freeze another
   project's names into a generic skill.
3. Diagnose before changing state. Read-only evidence collection is the default first
   phase.
4. Route affected services to current service knowledge/specialists when available.
5. A missing observability path is `UNKNOWN`/`BLOCKED`, never healthy.
6. A deploy monitor proves the intended artifact is actually running before evaluating
   its health.
7. First abnormal deploy-window sample is actionable; do not hide it inside an average.
8. Operational changes require explicit ownership, rollback, and post-change evidence.

## XTRM integration

Use `/using-xtrm` contracts for any remediation handed to another worker. Use
`/multiplexing` when several live agents coordinate the incident. Use
`/using-specialists` when a bounded SRE/observability/change-forensics specialist is the
right execution backend.

SRE Ops is an optional pack because it is a domain capability, not because it is low
value. Infrastructure-heavy environments should enable it globally or per project with
`xt skills`.