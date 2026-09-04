# Live health and alert triage

Start with the current observability surface. In XTRM environments this is often `mcpq`
against Prometheus/Grafana/Tempo/OpenTelemetry sidecars, but discover actual servers/tools
with current help instead of assuming a fixed prefix.

Evidence order:

1. firing alerts;
2. down/unready targets or containers;
3. freshness/SLO breaches using the correct cadence for each feed;
4. resource saturation when symptoms suggest it;
5. logs/traces around the affected window;
6. service-specific probes and current deployment/change evidence.

Classify overall state as `HEALTHY`, `DEGRADED`, `CRITICAL`, or `UNKNOWN` with cited live
evidence.

Project bindings such as container-to-repo mappings, feed cadence, alert names, and
service ownership must come from the current project's config/service map and service
knowledge. Never reuse placeholder mappings from an old skill.

## Past alert that already resolved

When the operator reports an alert from hours ago, do not conclude “healthy now” means
“false alert.” Use the bundled deterministic helpers when compatible:

```bash
python3 <sre-ops-skill-dir>/scripts/alert_history.py --hours <N>
python3 <sre-ops-skill-dir>/scripts/alert_investigator.py --alert <name> --hours <N>
```

If the helpers do not fit the current metrics/project, inspect the relevant historical
range directly and record the fallback.

## Remediation boundary

Triage itself is read-only. Once a root cause is supported by evidence, create/update an
XTRM work contract for the change, including rollback and post-change validation. Do not
turn an investigation into an untracked production mutation.