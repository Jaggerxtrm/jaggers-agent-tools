# Incident response

For multi-surface incidents, separate evidence lanes instead of making one agent guess
across metrics, traces, dashboards, logs, host state, and source history.

A useful shape is:

```text
incident contract
  -> observability lane
       Prometheus + Grafana + Tempo + logs
       first bad time / first bad boundary
  -> host/capacity lane
  -> deploy/provenance lane
       artifact -> commit -> PR -> Bead/worker -> original intent
  -> source/data-flow lane
       GitNexus + targeted source confirmation
  -> coordinator synthesis
       one causal graph + confidence / competing hypotheses
  -> remediation contract
  -> deploy/change verification
```

Run independent read-only lanes in parallel only when they do not mutate shared state.
The coordinator owns synthesis and must read the actual evidence/results before choosing a
remediation. Do not let each lane independently propose a fix and then pick the most
confident-sounding one.

The synthesis should align all evidence on one timeline. A strong RCA explains when the
system first deviated, where the runtime path first became wrong, which deployed change or
state transition caused/exposed it, why that change existed, and how the proposed fix
preserves valid original intent.

Every incident conclusion should state:

- observed symptoms and exact incident window;
- affected services/users/data;
- relevant Grafana dashboards/panels and Prometheus evidence;
- representative bad/good traces and first failing span/boundary;
- deployed artifact/revision;
- commit/PR/Bead/worker provenance and original change intent;
- confirmed causal mechanism or ranked unresolved hypotheses;
- remediation owner and explicit scope;
- rollback path;
- post-change/deploy verification evidence required.

An incident team is complete when it produces one evidence-backed causal explanation or
an explicit uncertainty boundary, not when every specialist has returned a report.