# Skills v4 causal debugging note

The `engineering-quality` default skill supersedes the old standalone `xt-debugging` and the optional `code-quality` umbrella. Its causal-debugging reference deliberately preserves and combines the useful behaviors from `xt-debugging` and `systematic-debugging`: root-cause investigation, GitNexus flow tracing, recent-change analysis, commit/PR/Bead/worker provenance, hypothesis testing, regression proof, review, testing, verification, and evidence-backed reduction.

SRE Ops applies the same method in production, extending the causal chain through Prometheus, Grafana, Tempo/OpenTelemetry, logs, deployment identity, commit history, PR/Bead intent, and source/data-flow confirmation.

This note is temporary migration evidence and should be folded into the final skills documentation before merge.
