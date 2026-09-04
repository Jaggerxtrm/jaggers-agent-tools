XTRM default skills are the small universal operating surface shipped to every XTRM agent.

A default skill must be required for correct XTRM operation across ordinary projects. Domain,
method, maintenance, and organization-specific capabilities belong in optional/user packs and
are enabled through `xt skills`.

Current core routers:
- using-xtrm — system doctrine, contract/evidence/minimal-engineering rules
- starting-and-resuming-work — continuity, takeover, context-pressure handoff
- multiplexing — native-first multi-agent coordination
- planning — work contracts, decomposition, triage and validation planning
- using-specialists — Specialists execution backend (vendored from xtrm-dev/specialists)
- gitnexus — code-graph workflow router
- skill-creator — skill authoring/evaluation
- find-skills — governed third-party discovery/import

Keep SKILL.md roots concise. Put phase/domain detail in one-level `references/` and deterministic
mechanics in `scripts/`. Runtime hooks/extensions own deterministic enforcement; skills own judgment
and procedure.
