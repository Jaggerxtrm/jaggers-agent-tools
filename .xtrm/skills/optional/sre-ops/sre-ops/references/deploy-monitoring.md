# Deploy verification

A deploy monitor proves three things, in order:

1. the intended merged/built artifact is actually running;
2. the running artifact is the change being evaluated, with known commit/PR/Bead intent;
3. the artifact stays healthy through the agreed observation window.

## Deploy-gap and provenance guard

Before opening the window, identify the deployment revision/image/build and compare it with
the intended merge/release. Record:

```text
artifact/revision
started/deployed time
commit SHA(s)
PR / Bead / owning work when available
what the deploy was intended to change
```

If artifact identity is stale or ambiguous, verdict is `BLOCKED`. Monitoring the wrong
artifact cannot validate the change.

Read the relevant commit body/PR/Bead before interpreting a regression. This lets the
monitor distinguish an intended behavioral shift from an unintended side effect and makes
rollback decisions preserve the original constraint.

## Observation window

Use an explicit absolute schedule. The contract/service SLO decides duration/cadence; a
30–60 minute window with regular samples is common, not universal.

At each required sample evaluate both change-specific signals and broad safety signals.
When the stack provides them, include:

- Prometheus alerts and relevant availability/error/latency/throughput/freshness/saturation
  series;
- the relevant Grafana dashboard panels with the correct variables/time range;
- Tempo/OpenTelemetry traces for representative requests/jobs, especially changed paths;
- correlated logs when traces/metrics expose an anomaly;
- direct service/API/data probes;
- public edge/proxy probes when edge behavior can fail independently.

Do not reduce Grafana to a screenshot. Query the relevant panel data and compare against
pre-deploy baseline where possible. Do not reduce tracing to “traces exist”; inspect the
changed request path and error/duration distribution.

## Causal regression during the window

The first abnormal sample is `HOLD` immediately. Capture the exact timestamp and then load
`causal-tracing.md` if the abnormality may be caused by this deploy.

The desired result is:

```text
sample anomaly
  -> trace/metric/panel deviation
  -> changed runtime path
  -> deployed commit/config
  -> original intent
  -> causal mechanism or explicit uncertainty
```

Re-sample promptly to distinguish a transient from sustained regression, but do not wait
for the next scheduled tick before surfacing the HOLD.

## Verdicts

- `PASS` — intended artifact proven live; required samples/evidence healthy.
- `HOLD` — artifact live but a required signal is abnormal or causality is still
  unresolved enough that progression would be unsafe.
- `BLOCKED` — artifact identity or required observability cannot be established.

Store raw evidence in durable files/artifacts and concise summaries in Beads/messages.
The deploy monitor does not edit, redeploy, revert or roll back unless the explicit XTRM
contract grants that authority.

A final PASS should cite the deployment identity and observation evidence, not simply
state that no alert happened.