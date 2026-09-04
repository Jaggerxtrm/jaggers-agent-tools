---
name: security-ops
description: >
  Optional security stack for sensitive-diff review, secrets/dependency/static-analysis
  evidence, auth/input/config risk, and secure operational changes. Use when work touches
  credentials, authn/authz, untrusted input, dependency/lockfiles, migrations, agent/MCP
  configuration, production networking, or when an explicit security audit is requested.
---

# Security Ops

Security review is threat/evidence driven, not a fixed scanner checklist.

1. Identify the changed trust boundary and assets at risk.
2. Review the actual diff/config/runtime path.
3. Run repository-approved secrets/dependency/static scanners where applicable.
4. Verify findings; scanner output is a lead, not authority.
5. Check failure behavior, least privilege, redaction, rollback, and observability.
6. Persist blocking findings in the work contract/review evidence.

Use the project's existing security pipeline and current CLI help rather than installing a
second scanner stack from this skill. Do not log secrets or paste credentials into public
research/tools.

For production-sensitive work, independent security review should be separate from the
writer when the XTRM contract/scrutiny requires it.