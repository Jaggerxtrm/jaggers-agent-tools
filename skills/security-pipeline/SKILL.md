---
name: security-pipeline
description: Bootstrap a complete security pipeline (Dependabot + OSV + Semgrep + gitleaks + pre-commit hooks + Codex review + pr-review-gate) on any GitHub repo. Designed for free user-private repos where GitHub Advanced Security is unavailable. Reusable across Python/TypeScript/Go/Rust stacks.
---

# Security Pipeline

Wires a 5-layer security baseline onto any GitHub repo. Originally proven on
the Mercury infra stack but the templates and bootstrap script are
project-agnostic — adapt the allowlists and dependabot ecosystems per repo.

## When to use

- Setting up security on a new repo (any language)
- Existing repo has zero/partial security checks
- User says "set up security pipeline" / "wire dependabot + sast + secret scan"

Do NOT use this skill if the repo already has a working `dependabot.yml` AND
all three workflows (`osv-scanner.yml`, `semgrep.yml`, `gitleaks.yml`).

## Branch model — propose on every bootstrap

Every bootstrap — fresh **or** already-security-bootstrapped — MUST propose
the promoted-only-to-main branch model before wiring anything else:

- `dev` is the integration branch and the repo's default. Feature PRs
  target `dev`; CI runs there.
- `main` is stable/released only, reachable only via an explicit
  `dev → main` promotion PR (or a tagged release). Nothing feature-shaped
  merges directly.
- Feature branches (and worktrees) always cut from `origin/dev`, never
  from `main`.

### Why

Without this split, `main` conflates two lifecycles — the "keep integrating"
surface and the "known-good, deployable" pointer — and every failed feature
PR churns the release branch. Separating them lets the security pipeline's
required checks live on `main` as a **promotion gate** (cheap to enforce,
rare to run) instead of as churn on every feature PR.

Skip only the sub-steps that are already true; never skip the whole section
because the repo "already has security" — an existing pipeline without this
model is exactly the case where the model needs to be added.

### Steps

```bash
# 1. Create `dev` from the current default if missing.
git fetch origin --quiet
git rev-parse --verify origin/dev >/dev/null 2>&1 \
  || git push origin origin/main:refs/heads/dev

# 2. Make `dev` the repo default.
gh repo edit --default-branch dev
git remote set-head origin dev

# 3. Ruleset on `main` — the promotion gate. Required checks match whatever
#    workflows this pipeline ships (adjust the contexts list to match; if
#    the pr-review-gate is enabled, include it here too).
gh api -X POST "/repos/$OWNER/$REPO/rulesets" --input - <<'EOF'
{ "name": "main-protection", "target": "branch", "enforcement": "active",
  "conditions": { "ref_name": { "include": ["refs/heads/main"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "pull_request", "parameters": {
        "required_approving_review_count": 0,
        "allowed_merge_methods": ["merge", "squash", "rebase"] } },
    { "type": "required_status_checks", "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [
          { "context": "OSV scan" }, { "context": "Semgrep scan" },
          { "context": "Gitleaks scan" }, { "context": "pr-review-gate" }
        ] } }
  ]
}
EOF
```

The local pre-push hook already blocks direct pushes to `main`; the ruleset
makes the server enforce the same rule for anyone who pushes without hooks.

If the repo uses worktrees, ship a `scripts/new-worktree.sh` that always
branches from `origin/dev` (never from `main`), plus a matching alias:

```bash
git config alias.wt '!f() { "$(git rev-parse --show-toplevel)/scripts/new-worktree.sh" "$@"; }; f'
```

### Workflow triggers

Workflows shipped by this pipeline should trigger on `[dev, main]` (push and
PR), so both the integration branch and the promotion gate get the same
scans. `scripts/semgrep-diff.sh` derives its baseline dynamically (`@{u}`
→ `origin/dev` → `origin/main`) so no hard-coded baseline needs changing.

## Architecture (5 layers)

```
git commit  ──► pre-commit    (gitleaks staged, ruff, hygiene)          ~1s
git push    ──► pre-push      (semgrep diff-only, osv, anti-main)       ~30s
PR opened   ──► CI            (osv-scanner, semgrep, gitleaks)          ~1m
PR review   ──► Codex         (semantic AI review, optional)            ~2m
PR merge    ──► pr-review-gate (blocks while any LLM-bot thread unresolved)  ~5s
PR merged   ──► Dependabot    (continuous vuln + version PRs)           async
```

Pre-existing debt is NEVER blocked by the push gate — only NEW findings vs
`origin/main`. CI does the full-repo authoritative scan.

## Why this stack on free user-private repos

GitHub Advanced Security (CodeQL, Dependency Review) needs Org/Enterprise
+ ~$49/user/month. Free substitutes:

| GHAS | Free substitute |
|---|---|
| CodeQL | Semgrep `p/security-audit` + `p/secrets` + ecosystem packs |
| Dependency Review | `osv-scanner` action |
| Secret scanning | Native (free for all repos since 2025) |
| Push protection | Native (free for all repos since 2025) |
| Branch protection enforcement | Pre-push hook + `gh pr merge --auto` |

## Quickstart

The skill ships with a bootstrap script that detects ecosystems and copies
templates. From the source repo (where this skill is installed):

```bash
./scripts/security-bootstrap.sh /path/to/target/repo
```

The script:
1. Detects ecosystems (`pip`, `pip-pyproject`, `npm`, `docker`, `gomod`,
   `cargo`, `github-actions`)
2. Generates a tailored `.github/dependabot.yml`
3. Copies the 11 baseline files from `templates/`
4. Opens a `feat(security)` PR
5. Calls `gh api` to enable Dependabot/secret scanning/push protection

## Manual follow-up after bootstrap

The script CAN'T do these — operator walks them per target repo:

1. **Codex Connector** (optional) — install at https://chatgpt.com/codex/cloud/settings/general
2. **Branch protection rule** — Settings → Branches → classic rule for `main`
   - Required checks: `OSV scan`, `Semgrep scan`, `Gitleaks scan`, `pr-review-gate`
   - On free private repos rules don't enforce server-side; the pre-push hook fills the gap
   - If the repo uses the newer **rulesets** API instead of classic protection, add
     the same contexts as a `required_status_checks` rule on the default-branch ruleset.
     One `gh api` PUT does it — see the "Enabling the gate (one-time, per repo)" section.
3. **`make install-hooks`** in the target clone (or run `git config core.hooksPath .githooks`)

## Enabling the gate (one-time, per repo)

`pr-review-gate.yml` runs on every PR after bootstrap, but the check does NOT
block merges until it's added to the required-checks list. Two paths depending
on which protection model the repo uses:

**Classic branch protection** (Settings → Branches → main → Require status checks):
add context `pr-review-gate`. Or via API:

```bash
gh api -X POST /repos/OWNER/REPO/branches/main/protection/required_status_checks/contexts \
  -f 'contexts[]=pr-review-gate'
```

**Rulesets** (Settings → Rules → Rulesets → the ruleset that targets your
default branch): edit and add a `required_status_checks` rule with context
`pr-review-gate`. Or via API — fetch the ruleset, append the rule, PUT it
back (see xtrm-54zwl.6 bead notes for a scripted example).

Bot detection defaults to `codex|coderabbit|claude` (case-insensitive) and is
overridable via the `PR_REVIEW_GATE_BOT_RE` repo variable. Matches only accounts
whose GraphQL `__typename == 'Bot'` AND login matches the regex, so a human
reviewer whose login happens to contain "claude" or "codex" can't trip the gate.
Paginates `reviewThreads` and `reviews` up to 2000 entries each (fails closed
beyond that). Preserves an active `CHANGES_REQUESTED` verdict per bot until the
same bot submits `APPROVED` or `DISMISSED` — later `COMMENTED` reviews do NOT
clear a CR, matching GitHub's native branch-protection semantics.

To manually refresh the gate after resolving a thread (`pull_request_review_thread`
isn't accepted by GitHub Actions despite the docs listing it):

```bash
gh workflow run pr-review-gate.yml -F pr=<n>
```

or click "re-request check-suite" in the PR checks tab, or push any commit.

### Keeping consumer copies in sync

The workflow file is COPIED into each consumer repo by `security-bootstrap.sh`
at install time — there is no auto-sync. When the canonical template in this
repo changes, every consumer needs a manual re-fanout PR. The wave-1 (`xtrm-7cjkv`)
and wave-2 (`xtrm-54zwl.7`) beads document the batch scripts under
`~/.claude/…/scratchpad/` that handle this: worktree per repo, `SKIP=osv-scanner
git push` (osv-scanner chokes on `.git` being a file in worktrees),
`gh pr create --head <branch>` (never rely on cwd inference across repos),
`--admin` merge for ruleset-protected repos with `required_approving_review_count>=1`.
Budget ~30 min operator-driven wall time per fanout wave across ~16 repos.

## Files in `templates/`

| Template | Lands at | Purpose |
|---|---|---|
| `.github/workflows/osv-scanner.yml` | same path | Vuln scan via OSV.dev |
| `.github/workflows/semgrep.yml` | same path | SAST (replaces CodeQL) |
| `.github/workflows/gitleaks.yml` | same path | Secret scan |
| `.github/workflows/pr-review-gate.yml` | same path | Blocks merge on unresolved LLM-bot review threads |
| `.gitleaks.toml` | same path | **Allowlist — adapt per project** (see below) |
| `.semgrepignore` | same path | **Excludes — adapt per project** (see below) |
| `.pre-commit-config.yaml` | same path | Two-stage local gate |
| `.githooks/pre-push.template` | merge into existing `.githooks/pre-push` | Anti-main-push + pre-commit chain |
| `scripts/semgrep-diff.sh` | same path | Diff-only semgrep for push |
| `scripts/security-scan.sh` | same path | Local audit (informational) |

`.github/dependabot.yml` is NOT in `templates/` — it's generated per-repo from
detected ecosystems.

## Adapting allowlists per project

The shipped `.gitleaks.toml` and `.semgrepignore` contain Mercury-specific
paths as **examples**. When applying to a non-Mercury repo, prune what
doesn't apply.

### `.gitleaks.toml` — common allowlist patterns

```toml
[allowlist]
paths = [
    '''^\.env$''',           # gitignored secrets (no-git scan walks fs)
    '''^\.env\..*''',
    # Project-specific machine-generated dirs (drop what doesn't apply):
    '''^\.beads/.*''',       # Mercury-only — issue tracker exports
    '''^\.specialists/.*''', # Mercury-only — specialist runtime state
    '''^\.dolt/.*''',        # Mercury-only — Dolt SQL storage
    # Add your own:
    '''^vendor/.*''',        # Go vendoring
    '''^node_modules/.*''',  # NPM (usually gitignored anyway)
]
```

### `.semgrepignore` — common patterns

```
.env
.env.*
node_modules/
vendor/
**/__pycache__/
**/test_fixtures/
package-lock.json
pnpm-lock.yaml
yarn.lock
poetry.lock
Pipfile.lock
go.sum
Cargo.lock
```

Don't blanket-allowlist findings without a tracked issue explaining why.
Acknowledged debt should be visible.

## Local install (per-clone, after bootstrap merges)

```bash
pip3 install --user --break-system-packages pre-commit semgrep
mkdir -p ~/.local/bin
curl -sL https://github.com/gitleaks/gitleaks/releases/download/v8.21.2/gitleaks_8.21.2_linux_x64.tar.gz \
  | tar -xz -C ~/.local/bin gitleaks
curl -sL https://github.com/google/osv-scanner/releases/download/v2.0.2/osv-scanner_linux_amd64 \
  -o ~/.local/bin/osv-scanner && chmod +x ~/.local/bin/osv-scanner
git config core.hooksPath .githooks
chmod +x .githooks/pre-commit .githooks/pre-push 2>/dev/null
```

Verify: `./scripts/security-scan.sh`.

## Reading Codex feedback on a PR (if Codex is installed)

```bash
gh pr view <num> --json reviews,comments | python3 -c "
import json, sys
d = json.load(sys.stdin)
for r in d.get('reviews', []):
    if 'codex' in r.get('author',{}).get('login','').lower():
        body = r.get('body', '')
        print('👍 no suggestions' if 'automated review suggestions' in body and len(body) < 1500 else body[:1500])
"
```

## Known pitfalls (encoded in the templates)

- **Pre-commit can't install with `core.hooksPath` set** → templates chain
  pre-commit from `.githooks/pre-commit` and `.githooks/pre-push` instead of
  using `pre-commit install`.
- **Semgrep's pre-commit env breaks on Python 3.13** (`pkg_resources` missing)
  → templates use `language: system` pointing at globally installed semgrep.
- **`semgrep ci --error` is invalid** → use `semgrep scan --error`.
- **`actions/dependency-review-action` requires GHAS** → use `osv-scanner` instead.
- **Gitleaks action needs `pull-requests: write`** to post leak summary on PRs.
- **Full-repo semgrep at push stage flags pre-existing debt** → use
  `scripts/semgrep-diff.sh` with `--baseline-commit=$(git merge-base HEAD origin/main)`.
- **`.pre-commit-config.yaml` `default_stages: [pre-commit]`** → otherwise
  ruff/hygiene hooks fire at push too.
- **Squash-merging while iterating with `git commit --amend`** → verify
  `git log --stat <merge-sha>` after merge; missing files require a follow-up PR.
- **Auto-merge disabled** → fall back to `gh pr merge --squash --delete-branch`
  after `gh pr checks --watch`.

## Complementary tools (optional, second opinion)

- `trivy fs` / `trivy image` — container + IaC scanning
- `bandit` — Python-specific SAST (Semgrep `p/python` already covers most)
- `actionlint` — GitHub Actions linter (Semgrep `p/github-actions` covers basics)

## Reference doc

Full pipeline narrative + UI screenshots + per-feature rationale lives in
the Mercury reference at `mercury-infra/SECURITY-PIPELINE.md`, also mirrored
in `~/second-mind/3-resources/github/SECURITY-PIPELINE.md`.
