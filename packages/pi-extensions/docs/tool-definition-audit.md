# Tool-definition audit — python-kernel v2 + service-knowledge v1

Bead: xtrm-vs7f8. Enumerates every registered tool / command / context note
across both extensions and verifies each factual claim against runtime
behavior (headless pi sessions + unit tests).

## Registered surface

| Extension | Kind | Name | Notes |
|-----------|------|------|-------|
| python-kernel | tool | `python` | sequential; params `code` (req), `reset`, `reload_skills` |
| python-kernel | event | `session_shutdown` | kills kernels (no LLM-facing surface) |
| service-knowledge | command | `service-knowledge:status` | registry status + drift |
| service-knowledge | event | `before_agent_start` | injects `<service_knowledge_context>` message |

## python tool — sentence-by-sentence

Description (base): "Execute Python code in a persistent interpreter. Variables,
imports, and functions persist across calls until reset: true. Code runs with
your user permissions and is not sandboxed — treat a cell like any shell
command. Run shell commands with subprocess when needed; for a project's own
tests, scripts, and CLIs use the project's documented environment instead."

| Claim | Verified? | Evidence |
|-------|-----------|----------|
| State persists across calls until reset | ✓ | unit + smoke: `x=41` then `x+1` → 42; reset clears → NameError |
| Runs with user permissions, not sandboxed | ✓ | `pythonBin` is user python; no sandbox in driver |
| Prelude: `json, re, os, sys, subprocess, Path` | ✓ (now) | smoke import + **fix: was wiped by reset** (see finding 4) |
| Importable skill modules listed when mounted | ✓ (now) | smoke: `Importable skill modules: sre_chain`; **fix: used wrong name** (finding 1) |
| `reset: true` clears namespace, returns to cwd | ✓ | unit: reset → NameError on prior var; cwd restored |
| `reload_skills` re-imports modules | ✓ | smoke: `reload_skills: sre_chain: ok` |
| 3MB output truncated with temp path | ✓ | smoke: `[truncated 3000001 chars]` + `[full output: …/cell-4.out]` |
| Shape hint on sized result | ✓ | unit: `list len=100000`; note: only for eval-expression results (print() → no hint) |
| Audit entries in details | ✓ | smoke: `audit: [{op: write, path: …}]` |
| auditPolicy flags out-of-session writes | ✓ | smoke: `[audit policy] blocked 1 mutation(s) outside session cwd` |

Prompt guidelines: each bullet matches behavior (persistence, reset, chdir,
user permissions, project env preference).

## service-knowledge:status command — sentence-by-sentence

Description: "Show service registry status: services, last_sync_ref vs git HEAD,
drift marker, suggested action".

| Claim | Verified? | Evidence |
|-------|-----------|----------|
| Lists services + last_sync_ref | ✓ | mercury: 17 services with refs |
| Compares vs git HEAD | ✓ (now) | **fix: 8-char ref slice vs 7-char short sha never matched** (finding 5) |
| Drift marker presence | ✓ | mercury: absent; unit: PRESENT path |
| Suggested action | ✓ (now) | mercury: correct reconcile suggestion; in-sync → "none" (unit) |

## Context note (before_agent_start)

Content: `<service_knowledge_context> service registry: N pack(s), M service(s)
… drift: …`. Verified reaching LLM (smoke: model answered the service ids).

## Audit findings (all fixed)

1. **Discovery listed skill-dir name, not import name** — tool description said
   `fiskill` while the kernel mounted `sre_chain`. Fixed: use package dir
   basename. Regression test.
2. **session_start return-value injection is not a documented pi mechanism** —
   context note used it; switched to `before_agent_start` `{message}` injection
   (verified reaching LLM). Unit tests updated.
3. **PI_KERNEL_AUDIT_POLICY env knob** added so the policy hook is exercisable
   headlessly (was code-option-only).
4. **prelude + `_AUDIT` wiped by `reset: true`** — the documented prelude and
   audit list vanished after any reset. Fixed: `_apply_prelude()` re-injects
   both (durable kernel invariants). Regression test.
5. **last_sync_ref vs git HEAD length mismatch** — registry refs sliced to 8
   chars, `git rev-parse --short` gives 7 (or more when ambiguous); in-sync
   repos were falsely flagged. Fixed: `--short=7` + 7-char slice. Regression
   test with a real git repo.

## Non-issues checked

- `executionMode: "sequential"` — verified in probe (`executionMode` field).
- Parameters schema — `code` required, `reset`/`reload_skills` optional
  (probe captured typebox shape).
- Zero-surface self-gating — verified: registry-less repo registers no tool,
  no command, no handler.
