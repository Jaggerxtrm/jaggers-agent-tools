XTRM default skills are the small universal operating surface shipped to every XTRM agent.

A default skill must be broadly useful for correct XTRM engineering across ordinary projects.
Domain, maintenance, and organization-specific capabilities belong in optional/user packs and
are enabled through `xt skills`.

Current core routers:
- using-xtrm — system doctrine, durable execution identity, contract/evidence/minimal-engineering rules
- starting-and-resuming-work — re-entry, takeover, context-pressure continuation, stalled-lane recovery
- multiplexing — native-first multi-agent coordination
- planning — substantial work contracts, decomposition, triage and validation planning
- engineering-quality — causal debugging, provenance tracing, review, testing, verification, reduction
- using-specialists — Specialists execution backend (vendored from xtrm-dev/specialists)
- gitnexus — code-graph workflow router
- skill-creator — skill authoring/evaluation
- find-skills — governed third-party discovery/import

`using-xtrm` owns the no-anonymous-mutation invariant. `xt work` is the worker-facing lifecycle
surface and `xt work guide` prints the packaged execution-identity/journal contract. `/planning`
is required when work becomes substantial or another worker will consume it; bounded local work
may use a lightweight `xt work start "..."` check-in.

Keep SKILL.md roots concise. Put phase/domain detail in one-level `references/` and deterministic
mechanics in `scripts/`. Runtime hooks/extensions own deterministic enforcement; skills own judgment
and procedure.
