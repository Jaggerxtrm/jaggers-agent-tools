# board-audit — install & operational manual

A one-shot script that exports the local `bd` board + relevant merged PRs into a single ChatGPT-web-friendly bundle for periodic board audits.

**Extracted from** the 2026-07-22 infra ChatGPT audit workstream (bd `infra-1evu`, `infra-koe2`, `infra-bkr7`, `infra-0chg`, `infra-4co7`).

---

## Install (any host)

Prereqs: `bd` (beads), `gh` (GitHub CLI, authenticated), `python3`.

**Recommended — symlink to the repo file** so future edits (upstream PRs, local
tweaks) apply immediately with no re-install step:

```bash
# Run from inside a checkout of xtrm-dev/core (or wherever the script lives).
mkdir -p ~/bin ~/.local/bin
SRC="$(git rev-parse --show-toplevel)/.xtrm/skills/default/issue-triage/resources/board-audit"
ln -sf "$SRC" ~/bin/board-audit
ln -sf ~/bin/board-audit ~/.local/bin/board-audit   # ~/.local/bin is usually on PATH
```

**Fallback — frozen copy** (only if you deliberately want a snapshot pinned to
the current script version and won't pick up future fixes automatically):

```bash
mkdir -p ~/bin ~/.local/bin
SRC="$(git rev-parse --show-toplevel)/.xtrm/skills/default/issue-triage/resources/board-audit"
cp "$SRC" ~/bin/board-audit
chmod +x ~/bin/board-audit
ln -sf ~/bin/board-audit ~/.local/bin/board-audit
```

Sanity-check either path:

```bash
which board-audit
board-audit --help
```

Verify it can reach GitHub:

```bash
gh auth status
# → "Logged in to github.com as <you>"
```

And `bd`:

```bash
bd stats
```

## Run

```bash
cd <any-mercury-repo>       # git working tree with bd + gh set up
board-audit
```

Takes ~2 min for a ~200-PR repo. Overwrites the bundle on re-run.

## Output

Single file to attach to ChatGPT web:

```
/tmp/board-audit-<repo>/audit-bundle-YYYYMMDD.md
```

Intermediate files kept alongside (if you want to iterate on the prompt without re-exporting data):

```
/tmp/board-audit-<repo>/
├── audit-bundle-YYYYMMDD.md   ← attach THIS
├── audit-prompt.md            ← prompt only
├── beads.jsonl                ← all non-closed beads
├── prs.md                     ← per-PR markdown (full body + all commits)
└── current-state.md           ← bd stats snapshot
```

## What's in the bundle

1. **Prompt** — 6-bucket classification + 13 additional passes:
   - Buckets: A live / B silently shipped / C superseded / D stale / E blocked-in-fact / F ambiguous
   - Passes: (1) ponytail description criticism, (2) dependency rewiring, (3) codebase drift, (4) metric-emission via Prometheus MCP, (5) Jira ↔ bd cross-check, (6) sister-repo relocations, (7) silent supersedes, (8) zombie epics, (9) stale-tone sweep, (10) follow-up gap, (11) duplicate/adjacent, (12) hard validation / no-regression, (13) existing-library reuse
2. **beads.jsonl** — every non-closed bead with full fields
3. **prs.md** — merged PRs since `min(bead.created) - 7d`, each with number/title/date/author/URL, files changed with +/- line counts, **full body**, **all commits with short SHA + headline**

## Auto-window (why the PR count varies)

The PR window is scoped to the oldest open bead's creation date minus a 7-day buffer. If the oldest bead is 75 days old you get ~75 days of PRs; fresh board falls back to 90 days. Guarantees full silent-ship detection coverage without wasting API calls on PRs older than any open bead.

## Overrides

Rarely needed:

```bash
BOARD_AUDIT_PR_SINCE=2026-01-01 board-audit    # explicit start date
BOARD_AUDIT_PR_LIMIT=1000 board-audit          # raise the 500-PR safety cap
```

## Using the output on ChatGPT web

1. Open a ChatGPT web session with browsing + tool use (Pro tier).
2. Attach the single bundle file.
3. Type: **"run the audit"**.
4. Wait ~15–25 minutes.
5. Paste the resulting audit back to whichever coordinator agent will execute the recommendations.

The prompt tells ChatGPT to verify claims with its GitHub, Jira, and web-search tools. If a bead can't be verified, it goes into bucket F rather than being closed by inference.

## What to do with the audit result

Feed it back to a Claude/pi session in the target repo with:

> "here is a ChatGPT audit of the board — execute the mechanical B/C/D/E findings in a batch, surface only genuinely-operator decisions at the end"

The 2026-07-22 infra run reduced the open board **108 → 68 beads (−37%)** in a single session with this pattern.

## Pitfalls / gotchas

- **Zsh PATH:** if `board-audit` isn't found, `~/bin` isn't on your interactive PATH. Symlinking to `~/.local/bin` (step 2 of Install) usually fixes it. `hash -r` if the shell has cached "not found".
- **GitHub cardinality trap:** `gh pr list --json commits` collapses above ~50 PRs. The script side-steps by doing a cheap list first then a per-PR `gh pr view` loop.
- **Bundle size:** ~600K for 200 PRs. ChatGPT web handles it. If you hit an upload limit, drop `BOARD_AUDIT_PR_LIMIT` or narrow `PR_SINCE`.
- **Empty board:** falls back to 90d-ago PR window.
- **gh auth expired:** the PR loop will spam warnings; re-auth with `gh auth login`.

## Iterating on the prompt

The prompt lives inline in the script inside a `<<'PROMPT_EOF'` heredoc. Edit `~/bin/board-audit` directly (and re-`cp` back into this resource dir when you like the change). Placeholders substituted at emit time:

- `%REPO%` — GitHub owner/name
- `%DATE%` — today
- `%BEAD_COUNT%` — non-closed bead count
- `%PR_LIMIT%` — safety cap
- `%PR_SINCE%` — auto-computed start date

## Related memories

- `board-audit-tool` (bd remember key) — feature-level notes on this tool
- `feedback_no_premature_readiness_claims` — audit ships defaults, operator ratifies
- `feedback_coordinator_acts_doesnt_ask` — execute B/C/D mechanically, surface only genuine decisions

## Files in this resource

- `board-audit` — the script itself (executable)
- `README.md` — this file (install + operational manual)

The atomic zettel version of the ops-only manual lives at `~/second-mind/zettlekasten/board-audit.md`.
