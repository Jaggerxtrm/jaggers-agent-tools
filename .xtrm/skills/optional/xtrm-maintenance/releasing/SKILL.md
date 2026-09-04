---
name: releasing
description: >
  Cut and verify a repository release from a clean reviewed tree. Use when the operator
  asks to ship/tag/publish a version. Resolve the repository's live package/build/release
  commands first, run package/prepublish/test/review gates before mutating version/tag
  state, then publish and verify the released artifact. Do not use a remembered XTRM
  wrapper as authority.
disable-model-invocation: true
---

# Releasing

A release is a state transition over already-reviewed work. Do not mix implementation or
unrelated cleanup into the release diff.

## Resolve the live release contract

Before mutation, inspect:

```bash
git status --short
git branch --show-current
git tag --sort=-v:refname | head -5
```

Then read the repository's current package manifest, release docs, CI/release workflows
and changelog tooling. Use their current scripts rather than commands copied from this
skill.

For Core/xtrm-tools specifically, the current package scripts include the authoritative
prepublish chain. Run the live `npm run prepublishOnly` rather than reconstructing that
chain by hand when shipping Core.

## Required order

```text
resolve current release contract
  -> clean tree + expected branch/base
  -> choose/confirm version
  -> inspect package contents / dry-run
  -> prepublish and repository release guards
  -> full relevant tests/build
  -> independent review evidence when policy requires it
  -> mutate changelog/version
  -> commit/tag/push
  -> publish
  -> verify remote tag + registry/artifact + installed/runtime surface
```

The pre-mutation gates matter. Do not bump a version first and then discover that the
package or tests are invalid.

## Changelog/version

Respect the repository's current changelog generator. If `npm version` or another version
hook generates the release section, use that mechanism instead of hand-writing a second
one. If the project has no version manifest and ships only by tag, do not invent one.

Before version mutation, verify what version currently exists remotely/at the package
registry. A failed publish followed by a blind retry can create an unintended extra
version bump; reconcile local tag/manifest/registry state first.

## Package and release evidence

For an npm package, useful evidence usually includes:

```bash
npm pack --dry-run
npm run prepublishOnly
npm test
```

Add repository-specific integration/smoke tests. For XTRM tooling, include any documented
global-surface smoke because package installation into a user's HOME is a different
boundary from source-tree tests.

When the release carries production-impacting behavior, obtain the repository-required
review/test/security gates before publishing. `/using-specialists` can supply independent
review roles, but the final release decision remains with the owning XTRM workflow/operator
policy.

## Release mutation

After all required gates pass:

1. generate/promote the changelog through the current repository mechanism;
2. update the version manifest(s) exactly once;
3. rebuild tracked artifacts when required;
4. verify `git diff --stat` contains only expected release artifacts;
5. commit the release state;
6. create the release tag;
7. push the branch and tag without force;
8. publish the package/artifact when applicable.

Do not use retired `xt release prepare/publish` behavior merely because an old document
mentions it.

## Post-release proof

A successful publish command is not sufficient. Verify the released identity through the
consumer-facing boundary:

```text
remote tag/commit exists
registry/release reports intended version
package/artifact is retrievable
installed CLI/runtime reports intended version when applicable
global or deployment smoke passes when required
working tree is clean
```

Persist the released version, commit/tag, package identity, gate evidence, and any
remaining follow-up. If post-release verification fails, stop and diagnose/recover; do
not silently create another version.
