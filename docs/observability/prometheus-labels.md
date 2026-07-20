# Prometheus label cardinality guardrail

Audit reference: `~/dev/11.md` §P3-04.

Prometheus labels are dimensions. Every distinct label value costs
memory and query time forever — Prometheus does not garbage-collect
label combinations, and high-cardinality labels degrade both
storage and dashboards. `job_id` as a label = one time series per
job for the life of the retention window.

The following identity fields MUST NOT become Prometheus label
values in xtrm-tools, Specialists, xtmux, or any downstream
observability surface derived from them:

- `job_id`
- `bead_id`
- `chain_id`
- `parent_job_id`
- `agent_instance_id`
- `host_id`
- `tmux_session_id`
- `tmux_window_id`
- `tmux_pane_id`
- `trace_id`
- worktree path
- branch name
- commit SHA

## Where these fields DO live

- **SQLite** (observability DB) — indexable, joinable, and
  bounded by disk not RAM.
- **Forensic events** (journal, JSONL logs) — appended per event,
  never queried by cardinality.
- **Logs** — stdout/stderr with structured fields.
- **Traces** — spans keyed by trace_id/span_id, not aggregated.
- **Operator queries** — ad-hoc `bd`/`sp`/`xtmux` commands that
  join by identity as needed.

## Allowed Prometheus label dimensions

Keep labels bounded and low-cardinality:

- role (`chain-coordinator`, `executor`, `explorer`, …)
- runtime (`claude`, `pi`)
- outcome (`success`, `failure`, `timeout`, `stalled`)
- phase name (finite set)
- env/tier (`prod`, `staging`, `local`)

If you need to slice a metric by identity, do the slicing in
SQLite/log-query — not by promoting the identity into a label.

## Adding a new metric

1. List the labels you'd need to satisfy the dashboard question.
2. Compute the cardinality: `product of unique values per label`.
3. If any label appears in the "MUST NOT" list above, redesign.
4. If total cardinality > 10k series per metric family, redesign.

## Cross-references

- `docs/architecture/coordination-terminology.md`
- `docs/runtime-compatibility.json` (`contracts.runtime_origin` for
  where identity is properly persisted).
