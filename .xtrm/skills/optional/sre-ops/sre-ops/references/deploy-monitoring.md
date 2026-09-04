# Deploy verification

The purpose of a deploy monitor is to prove two things in order:

1. the intended merged/built artifact is actually running;
2. the running artifact stays healthy through the agreed observation window.

## Deploy-gap guard

Before opening the window, compare merge/release identity with the running deployment:
container `StartedAt`/image/revision, Kubernetes generation, GitOps revision, committed
CLI artifact SHA, or the equivalent authoritative deployment receipt.

If the artifact is stale or ambiguous, verdict is `BLOCKED`; ask the owning workflow to
redeploy/reconcile. Monitoring the old artifact cannot validate the change.

## Window

Use an explicit absolute schedule and record it. A common production window is 30–60
minutes with regular samples, but the contract/service SLO decides the duration/cadence.

Each sample should include the signals relevant to the change plus broad safety signals:
alerts, errors/traces, latency/throughput/freshness, direct health, and public edge probes
when an edge/proxy can fail independently of the target service.

Use verdicts:

- `PASS` — intended artifact proven live and required samples healthy.
- `HOLD` — artifact is live but a required signal is abnormal/inconclusive.
- `BLOCKED` — cannot prove artifact identity or required observability is unavailable.

The first abnormal sample produces `HOLD` immediately and should be re-checked quickly;
do not silently wait for the next scheduled tick.

Store raw evidence in durable files/artifacts and concise summaries in Beads/messages.
The deploy monitor does not merge, edit code, redeploy, or silently roll back unless its
explicit XTRM contract grants such authority.