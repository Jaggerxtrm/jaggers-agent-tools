# E2E smoke transcript — python-kernel v2 + service-knowledge ext v1

Bead: xtrm-vs7f8. Date: 2026-08-27. Headless `pi` sessions (JSON/RPC modes) with
extensions loaded from the **worktree source** via `--no-extensions -e <ext>`.
Provider: commandcode/deepseek-v4-flash. Fixtures live in the smoke harness
(see `scripts/e2e-smoke.sh` when committed; fixtures were ephemeral under /tmp).

## (a) python-kernel + fixture skill — PASS

Fixture skill `fiskill` with `src/sre_chain/__init__.py` mounted via
`PI_SKILL_ROOTS=<parent-of-skill>`.

| Check | Result | Evidence |
|-------|--------|----------|
| Tool description lists importable module | PASS — `Importable skill modules: sre_chain — pre-imported in namespace; help(x) for docs.` | `a-python-tool-surface.json` |
| In-kernel import works | PASS — `sre_chain.load('e2e')` → `loaded:e2e` | `a-live.jsonl` (transcript excerpt below) |
| `help(sre_chain)` works | PASS — full module doc, functions, FILE path | `a-live.jsonl` |
| Skill mutation via `write_marker` | PASS — `marked:/tmp/...` | `a-live.jsonl` |
| 3MB output truncation + temp path | PASS — `[full output: /tmp/pi-py-kernel-*/cell-4.out]` in reply; head+marker+tail | `a-live.jsonl` |
| Audit entries in details | PASS — `audit: [{'op':'write','path':'/tmp/smoke/out/a-marker.txt'}]` | `a-live.jsonl` |
| auditPolicy ON flags out-of-session write | PASS — `[audit policy] blocked 1 mutation(s) outside session cwd` + `details.auditPolicy: blocked 1 out-of-session writes` | `a-audit-policy-on.jsonl` |
| reload_skills re-imports changed module | PASS — `reload_skills: sre_chain: ok` | `a-reload-skills.jsonl` |

Live excerpt (python tool result, truncated for brevity):

```
loaded:e2e
Help on package sre_chain:
  NAME sre_chain - sre_chain fixture...
  FUNCTIONS load(what='default') / run(dry_run=False) / write_marker(path)
marked:/tmp/smoke/out/a-marker.txt
xxx...[truncated 3000001 chars]...xxx
[full output: /tmp/pi-py-kernel-QEmQo0/cell-4.out]
```

## (b) service-knowledge + canonical registry fixture — PASS

Fixture repo `regrepo` with `.xtrm/skills/infra/service-knowledge/service-registry.json`
(2 services: `db-expert` with `last_sync_ref=abc12345`, `auth-svc` un-synced).

| Check | Result | Evidence |
|-------|--------|----------|
| Command registered | PASS — `service-knowledge:status` | `b-sk-context-note.json`, RPC `get_commands` |
| before_agent_start context note | PASS — `<service_knowledge_context> service registry: 1 pack(s), 2 service(s) … drift: none detected` | `b-sk-context-note.json` |
| Note reaches LLM context | PASS — model answered `db-expert` + `auth-svc` (injected marker probe) | live run |
| Status command output | PASS — services + last_sync_ref + git HEAD + drift marker + `suggested action: run /updating-service-knowledge` | `b-status-output.json` |

## (c) registry-less repo — PASS (zero surface)

Fixture `noregrepo` (no `.xtrm/skills` registry at all).

| Check | Result | Evidence |
|-------|--------|----------|
| No tools registered | PASS — `tools: []` | `c-zero-surface.json` |
| No commands registered | PASS — `commands: []` | `c-zero-surface.json` |
| No event handlers | PASS — `events: []`, no context note | `c-zero-surface.json` |

## (d) real-repo read-only probe — PASS (conservative self-gating)

The canonical mercury/infra registry was not present on this machine. Probed real
repos with non-canonical layouts instead — all correctly yield ZERO surface,
proving the resolver only registers for the canonical
`<pack>/<service-knowledge|service-skills>/service-registry.json` shape under a
non-reserved pack:

| Repo | Layout | Result |
|------|--------|--------|
| `dev/vaultctl` | `.xtrm/skills/local-legacy/service-skills-set/service-registry.json` — **reserved pack name** `local-legacy`, umbrella not `service-skills` | zero surface (correct) |
| `dev/specialists/.worktrees/*` | `.claude/service-registry.json` — legacy flat layout | zero surface (correct, canonical resolver does not fall back to `.claude`) |

Evidence: `d-real-repo-probe.json` (`commands: []`).

## Audit findings surfaced by the smoke

1. **Discovery import-name mismatch (fixed)**: `discoverSkillModules` used the
   skill directory name as the import name; the tool description then listed a
   name that differed from the actual kernel-mounted module when
   `skillDir ≠ src/<pkg>`. Fixed to use the package dir basename. Regression
   test added. (The first smoke run showed `fiskill` while the kernel imported
   `sre_chain`.)
2. **session_start return-value injection is not a documented pi mechanism
   (fixed)**: the context note used `pi.on("session_start", …)` returning
   `{message}`. Verified empirically that only `before_agent_start` return
   `{message}` injection reaches the LLM. Switched the note to
   `before_agent_start`. Unit tests updated.
3. **auditPolicy env knob (added)**: `PI_KERNEL_AUDIT_POLICY=1` enables the
   policy hook headlessly (was code-option-only), making the e2e exercise
   possible without code changes.

## Harness

- `probe.ts` / `probe2.ts` / `probe3.ts` / `probe4.ts` — extension-surface
  capture (registerTool/registerCommand/on interception + handler invocation).
- `e2e-smoke.sh` — full run: cases (a)–(d).
- `audit-live.sh` — auditPolicy-on + reload live runs.
- Fixtures: `fiskill/`, `regrepo/`, `noregrepo/` (ephemeral, under /tmp).

All artifacts committed under `packages/pi-extensions/docs/e2e-smoke/`.
