---
name: security-bootstrap
description: >
  Bootstrap or reconcile a repository security baseline using XTRM-preserved templates
  and scripts for dependency, secret, SAST, and local/CI checks. Use when a repository has
  missing or partial security automation. Verify current GitHub capabilities, scanner
  versions, workflow policy, and existing repo conventions before applying templates;
  never treat the preserved template snapshot as current external-service authority.
disable-model-invocation: true
---

# Security Bootstrap

This skill preserves the concrete bootstrap assets from the former `security-pipeline`
workflow without preserving stale assumptions about GitHub plans, action versions, scanner
releases, or where every check should run.

## Diagnose before copying

Inventory the target repository first:

```text
existing dependency update configuration
existing CI/workflows
secret scanning / gitleaks or equivalent
SAST / semgrep or equivalent
OSV/dependency scanner
local hooks and their latency
branch/ruleset requirements
language/ecosystem manifests
container / GitHub Actions / deployment surfaces
```

Do not install duplicate scanners merely because this skill ships a template for them.
Current repository policy and current GitHub/platform capabilities win over the historical
baseline.

## Preserved assets

The skill carries:

```text
scripts/security-bootstrap.sh
templates/.github/workflows/{osv-scanner,semgrep,gitleaks}.yml
templates/.gitleaks.toml
templates/.semgrepignore
templates/.pre-commit-config.yaml
templates/.githooks/pre-push.template
templates/scripts/{security-scan,semgrep-diff}.sh
```

Resolve this skill's installed directory before invoking `scripts/security-bootstrap.sh`.
Review the generated diff before committing it.

## Placement policy

Do not assume every heavy security check belongs in every pre-push hook. XTRM's current
DevOps guidance separates fast local developer feedback from authoritative CI/deploy or
scheduled checks when repeated local execution creates routine `--no-verify` bypasses.
Use the current `xtrm/docs/devops/git-hooks-vs-ci-policy.md` and repository policy when
choosing placement.

A useful baseline generally covers:

- dependency/advisory scanning;
- secret detection;
- language/ecosystem SAST where useful;
- GitHub Actions and build/deployment dependency review;
- minimal local fast checks;
- authoritative CI or scheduled/deploy checks for heavier scans;
- explicit allowlists with tracked reasons rather than blanket suppression.

## Current-source rule

Before adding or updating third-party Actions/scanners, verify current official guidance,
release versions, required permissions, and supported configuration. Pin GitHub Actions
according to current project supply-chain policy. Do not copy the old skill's hard-coded
prices, versions, or capability claims.

## Verify the result

After bootstrap/reconcile:

1. inspect every created/changed workflow and config file;
2. confirm paths and ecosystems match the repository;
3. run the local security helper where applicable;
4. validate workflow syntax and required permissions;
5. execute/observe CI rather than assuming a copied workflow works;
6. record accepted pre-existing findings separately from regressions/new findings;
7. document any intentionally omitted scanner and why.

Use `/security-ops` for security investigation/review. Use `/updating-dependencies` for a
specific dependency bump/advisory case. This skill only establishes or repairs the
security automation baseline.
