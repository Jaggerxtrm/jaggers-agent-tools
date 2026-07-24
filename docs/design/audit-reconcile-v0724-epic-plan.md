# Audit Reconcile v0724 — Epic Plan

**Source report:** `docs/design/audit-reconcile-v0724.md` (3113 lines; authoritative content lines 1–1360).
**Verified state:** Core `main@428a27bf` (v0.11.2); xtmux `048b742d` (0.2.2); Specialists `05c57e56` (3.21.1) + #206–#208 unreleased.
**Repos:** `~/dev/core`, `~/dev/xtmux`, `~/dev/specialists`.
**Umbrella bd epic:** `xtrm-wiy5n`.
**Track split (mandatory, doc §Final):** **Track A** = close the existing audit. **Track B** = build deterministic orchestration. Do not mix in one PR series.

---

## Audit-informed deltas (helpers overrode the doc)

Three parallel `general-purpose` audit helpers (one per repo) verified every claim against HEAD. Their overrides are canonical for this plan:

| Doc proposal | Helper verdict | Action |
|---|---|---|
| **MSG-01** ack semantics: prefer Option B (successful queue) | REJECT Option B; keep Option A (SQLite row read) + `// ponytail:` comment on crash window | Option A stays; document truth |
| **MSG-03** exact-inbound rewrite | CUT 3.a (`message-get` per row = N round-trips for zero data) and 3.c (summary-promotion guardrail already exists in `pi-inbox-reply.ts`) | Only 3.b survives: flip ack after continuation queue |
| **MSG-04** assigned to Core | 100 % xtmux — all files live in `xtmux/hooks/claude/` | Reassign fully to xtmux lane |
| **MSG-05** transitions: waiting + done + error + cancelled + stalled | Start terminal-only (done/error/cancelled). `stalled` not in canonical enum. `waiting` = follow-up, only if measured | 3 seams in `writeUnifiedHandoff`; reuse `xtrm.forensic.v1` payload shape |
| **MSG-06** quarantine hooks | Files already unwired from `hooks.json`. Delete outright. Update `plugin-era-cleanup.ts` at same time (doc missed the coupling) | Atomic with MSG-05 marker removal in `supervisor.ts:2686,2748` |
| **DOC-02** slim skills — `multiplexing` ~402 lines | Actually 685 lines. Delete is bigger. `pr-reviewer` at 208 lines is not "moderately heavy" — light-touch only | Targets stand; slim aggressively |
| **`chain-coordinator`** in Core scope | Owned by Specialists (`config/specialists/chain-coordinator.specialist.json`) | Reassign to specialists lane |
| **`--background`** = help-line lie | Also in `src/index.ts:1228-1239` and PARSED by `run.ts:115,944,974`. Also trained by `evals.json:71,75,185,193` | Decide fate of CLI branch; fix all four surfaces |
| **`open-issues.json`** removal | 466 KB currently tracked; leak confirmed. Immutable-runner P0 stays separate track (bd `unitAI-tmeqw.12`) | `git rm` + `.gitignore`, one PR |
| **EVAL-01/02** matrix + framework | No shared harness. Per-repo unit tests + tiny grep-scripts per gate | No lint framework |
| **`xtmux-events` rendering** (user-requested extra) | Broken today: `agents.turn.done` invisible; all `sp job.*` terminal events invisible; `agent.ready` singular-vs-plural regex miss; beads cursor `T>space` ASCII bug re-emits every 2s; `messages.cancelled`/`reply.*`/`send.rejected`/`monitor.*`/`wait.wake.orphan`/`audit.*`/`bd.commented` dropped | Widen jq filter + fix cursor comparison in `scripts/test-session-events.sh` |
| **MSG-05 verified parent** | Already available: `status.spawn_origin.runtime_origin` (captured at spawn, verified via `xtmux context --current --json`) | Read at seam, no new resolver |
| **`evals.json`** | Trains agents on forbidden `sp merge` — contradicts skill rule #9 | Regenerate alongside DOC-01 |

---

## Sprints

### Sprint 0 — Tooling prereqs (ONE PR, core, no specialists)

Rationale: we're about to use `/multiplexing` for the rest. Slim it first.

- Slim `.xtrm/skills/default/multiplexing/SKILL.md` (685 → 120–160)
- Slim `multiplexing-team/SKILL.md` (341 → 100–140)
- Slim `using-specialists/SKILL.md` (256 → 120–150)
- Slim `deploy-monitor/SKILL.md` (263 → 140–180)
- `pr-reviewer/SKILL.md` (208): light-touch (≈50-line trim); DOC-03 policy fixes bundled here
- Update `cli/src/core/plugin-era-cleanup.ts` — remove `specialists-complete.mjs` / `specialists-session-start.mjs` legacy-dedup rows (coupled to MSG-06 landing)
- Add `scripts/check-skill-root-budget.mjs` (30 lines: `wc -l` per named root, fail over budget)

**DoD:** all 5 roots ≤ budget; skill-root-budget check green; multiplexing skill reflects the retrieval hierarchy (`message-get`, `agent-last`, `sp result --json`).

### Sprint 1 — Track A P1 closure (3 lanes parallel via `/multiplexing`)

**Lane core-P1** (executor + reviewer per fix):
- Topology projection ledger schema: add `minItems: 6`, `uniqueItems: true`, `contains` per source name (doc §A1)
- Cross-repo worktree projection (`cli/src/core/topology-projection.ts:306,392`)
- Obligations route resolves selected pane (`cli/src/core/topology-views.ts:261`)
- Integration view PR-join per Specialist job branch (`topology-views.ts:198-214`)
- Serena provisioning vs matcher/permission alignment (`.xtrm/config/hooks.json`, `pi/settings.json.template`)
- Semgrep recovery: gate `git reset --mixed` on actual HEAD change (`scripts/semgrep-diff.sh:98`)
- Pi-only Beads cache: verify Pi runtime reuses `.xtrm/hooks/beads-status-cache.mjs` (don't write a second writer)
- `--subordinate --reuse` worktree order (`cli/src/utils/worktree-session.ts`)

**Lane xtmux-P1** (one PR, direct edits):
- `scripts/test-session-events.sh:148,157,238-239,316-319` — fix beads cursor text-compare, capture cursor before setup
- Same PR: widen jq filter to render `agents.turn.done`, `agent.ready`, `sp job.completed/failed/cancelled`, message reply/rejection variants, `monitor.*`, `wait.wake.orphan`, `audit.*`, `bd.commented` (user extra ask — cheaper to land with the cursor fix)

**Lane specialists-P1** (one PR, direct edits):
- `git rm open-issues.json` + `.gitignore`
- Immutable-runner P0 stays deferred (bd `unitAI-tmeqw.12`); note in PR description

**DoD:** all three lanes merged; `xtmux-events` renders end-to-end for a live `sp run … && bd close …` scenario.

### Sprint 2 — Track A P2 + MSG semantic wave (3 lanes parallel via `/multiplexing`)

Full specialist chain per lane: `executor` → `reviewer` → `test-runner`. `security-auditor` on specialists lane MSG-05 seam. `debugger` only on failures.

**Lane xtmux-P2:**
- Positioned bounded transcript tail read (`hooks/claude/claude-agent-turn-capture.mjs:57-63`)
- Fallback completed-turn row when transcript empty (`claude-agent-turn-capture.mjs:85-86`)
- Populate `tmux_server_id` (`src/domains/identity/runtime-context.ts:17,102-120`)
- **MSG-01** — keep Option A; add `// ponytail:` crash-window comment; align README `:113`, `docs/observability-redesign.md:44`, `agent-state-hooks.md`
- **MSG-02** — preserve `expectsReply` in `extensions/coordination-json.ts`; guard `pi-auto-monitor.ts:66-77` to skip FYI; extend existing `pollTimer` in `pi-inbox-reply.ts:293-300` for sender-owned reconciliation (NO new daemon)
- **MSG-03.b** — flip ack after `sendUserMessage` succeeds (`pi-inbox-reply.ts:170-174` vs `:268-283`)
- **MSG-04.a** — 6 lines in `claude-agent-turn-capture.mjs:80-113` for parent-FYI parity (mirror `extensions/pi-agent-state.ts:188-201` wire format)
- **MSG-04.b** — one Stop-hook: `xtmux obligations list` → stderr reminder. No new widget.

**Lane specialists-P2:**
- Fix `sp integration record` publication branch target (`src/cli/merge.ts:949`)
- Flag-shape guard in `src/cli/integration.ts:57-95` required() helper
- Delete `--background` from `src/cli/help.ts:124` + `src/index.ts:1228-1239`; decide fate of `run.ts:115,944,974` parse branch (recommend: delete branch too, doc "use shell `&`")
- Label `sp merge` / `sp epic merge` `[broken]` in help; update `config/skills/using-specialists/evals/evals.json:71,75,185,193` to stop training on them
- Establish clean test baseline (`test:supervisor` etc.)
- **MSG-05** — `emitParentNotification(statusSnapshot)` helper called from `writeUnifiedHandoff` terminal sites (`supervisor.ts:2539,2572`) + terminal `updateJobStatus('error')`. Terminal-only for v1. Reuse `xtrm.forensic.v1` payload shape; try/catch wraps send so delivery failure never rolls back completion.
- **DOC-01** — rewrite `config/skills/using-specialists/references/monitoring.md`: remove "Sleep Timers Are Mandatory" (line 7), private-SQLite section (61-119), `completed` spelling (5 sites), polling-first, "DB is authoritative" (line 118). Teach the `sp result --json` / `sp resume` / `message-get` / `agent-last` hierarchy in ~30 lines.
- **Chain-coordinator prompt fixes** (`config/specialists/chain-coordinator.specialist.json:28`):
  - s/turn_end/agent_end/
  - Add Pi/Claude asymmetry warning ("Claude does not auto-FYI parent")
  - Inline 12-line XTMUX COMMUNICATION INVARIANTS block
  - Tag `// TODO: resolver` on hardcoded chain order (Track B removes it)

**Lane core-P2:**
- **DOC-04** — inline 12-line invariant block into `.xtrm/config/instructions/claude-top.md` + `agents-top.md`; s#/skill-using-xtrm#/using-xtrm# (`claude-top.md:99`)
- **MSG-06** — `git rm .xtrm/hooks/specialists/specialists-complete.mjs specialists-session-start.mjs`; prune rows in `.xtrm/registry.json:81,89`; `plugin-era-cleanup.ts` already handled in Sprint 0
- **DOC-03** — `deploy-monitor/SKILL.md:33` add `--expects-reply=false --json` to ready/PASS examples; `pr-reviewer/SKILL.md:142-143,188` fix addressing to `--from/--from-pane/--to/--to-pane`; add `--json` to verdict sends (140-149); add one sentence distinguishing sprint-judge vocab from Specialists reviewer PASS/PARTIAL/FAIL
- **Re-vendor** updated Specialists `monitoring.md` into Core after DOC-01 lands

**Cross-repo gate:** MSG-05 + MSG-06 must merge in the same release window; bd cross-repo `blockedBy` declared.

**DoD:** all three lanes merged; MSG-05 → Core reminder cycle → `message-get` → `sp result --json` works end-to-end in a `pi coordinator` + `sp run` demo.

### Sprint 3 — Container smoke-test harness + coordinated release

**Sprint 3a — Smoke-test container (helper-built, blocking gate):**

Build a reusable smoke-test harness. Alpine container. Verifies:
1. `xt`, `sp`, `xtmux` package install from npm registry
2. Update mechanisms (`xt update --apply`, `npm i -g @jaggerxtrm/xtmux@latest`, `npm i -g @jaggerxtrm/specialists@latest`)
3. Clone all 3 xtrm repos into container; run pre-edit trio-init; snapshot state
4. Apply edits (or fetch a target branch); re-run init; diff
5. Systematic verification: hook wiring intact, registry parity, skill roots within budget, `xtmux-events` renders live scenario, `sp run` completes and terminal notification lands

Ownership: `executor` specialist builds the container + verification scripts; `reviewer` gates. Lives at `scripts/smoke-container/` (or `docker/smoke/`). Ponytail: single `Dockerfile` + one `verify.sh`; no compose, no orchestrator, no Kubernetes.

**Sprint 3b — EVAL gates:**
- **EVAL-01** — per-repo unit tests for the cross-runtime matcher matrix (doc §8, 11 scenarios). No shared harness — each repo owns its half.
- **EVAL-02** — grep-scripts: `check-skill-root-budget.mjs` (already Sprint 0), `check-forbidden-phrases.mjs` (bans `--background`, `capture-pane` as result protocol, `completed` status spelling, `session:pane` addressing), `check-vendored-specialists-skill-parity.mjs` (hash equality upstream vs `.xtrm/skills/default/using-specialists/references/monitoring.md`)

**Sprint 3c — Release wave (blocked by 3a green):**
- Release Specialists 3.21.2 (#206–#208 + MSG-05 + DOC-01 + chain-coordinator + help honesty)
- Release xtmux 0.2.3 (P2 fixes + MSG-01..04 + `xtmux-events` fixes)
- Release Core 0.11.3 (slims + MSG-06 + DOC-03/04 + re-vendored monitoring.md)
- Extended live Suite C lane

**DoD:** smoke-test container green on all three released artifacts; live Suite C passes packed installs; audit closable per doc §Definition of done.

### Sprint 4 — Track B (deferred placeholder epic)

Track B lives in a separate bd epic. Not decomposed here. Must integrate with:

- `~/dev/specialists/docs/design/roadmap/specialists-roadmap.md`
- `~/dev/specialists/docs/design/roadmap/enhanced-prd.md`

The Specialists team is planning major chain-templates work in those docs. Sprint 4 is the XTRM integration surface for that program — canonical chain templates + resolver + exact dispatch, per audit doc §B1. Also picks up MSG-05 `waiting`-notification follow-up only if measured need.

Placeholder issue records: block Track B start until Track A closed; link to Specialists roadmap + PRD; assign no children yet.

---

## Fan-out helpers per sprint

| Sprint | Coordinator | Panes | Specialists |
|---|---|---|---|
| 0 | direct edits (small) | 1 | none |
| 1 | `/multiplexing` (v2) | 3 | `executor` + `reviewer` on core lane; direct on xtmux + specialists lanes |
| 2 | `/multiplexing` | 3 | full chain per lane; `security-auditor` on MSG-05 seam; `debugger` only on failure |
| 3a | `/multiplexing` (single helper for harness) | 1 | `executor` + `reviewer` |
| 3b | direct edits | 1 | none |
| 3c | `/releasing` per repo, coordinated via `/multiplexing` | 3 | `reviewer` gate on each release PR |
| 4 | separate epic | — | tbd from Specialists roadmap |

---

## Cross-repo release gate

Same-release-window policy for the MSG-05 / MSG-06 pair (option 1 per operator):

1. Specialists 3.21.2 build → published to npm
2. xtmux 0.2.3 build → published to npm
3. Core 0.11.3 build → published to npm (MSG-06 marker removal in same version)
4. Sprint 3a smoke-container run against all three released artifacts
5. If any step fails, roll forward (fix + patch release); do not delay only one — the dead-writer/reader gap is worse than a re-release

The smoke container is the checkpoint. Green = release closed.

---

## Definition of done per sprint

**Sprint 0.** 5 skill roots within budgets; skill-root-budget check green; `plugin-era-cleanup.ts` updated for MSG-06 landing.

**Sprint 1.** All P1 items closed; `xtmux-events` renders end-to-end scenario; `open-issues.json` gone from public tree.

**Sprint 2.** All P2 + MSG-01..06 items closed per audit-overridden scope; MSG-05 → Core reminder → `message-get` → `sp result --json` works; chain-coordinator prompt runtime-aware.

**Sprint 3.** Smoke container green on all three released artifacts; audit closable per doc §Definition of done audit-closed criteria; EVAL gates enforced in CI.

**Sprint 4.** N/A — placeholder only.
