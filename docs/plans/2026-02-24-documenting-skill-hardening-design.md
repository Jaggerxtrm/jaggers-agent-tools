# Documenting Skill Hardening — Design

**Date**: 2026-02-24
**Status**: Approved
**Scope**: `skills/documenting/`

---

## Problem Statement

The `/documenting` skill has the right infrastructure (scripts, templates, references) but fails on its core promise:

- **Never auto-triggers** — git hooks don't fire at the right moment; no Claude-level mechanism detects documentation drift
- **No drift detection** — no way to know which memories are stale when invoking manually
- **CHANGELOG step missing** — the existing `changelog/` scripts are not wired into the skill workflow
- **SKILL.md workflow is vague** — agent has to guess what to write, when, and where
- **Memories are opaque** — a 500-line memory requires full sequential read; no internal navigation

---

## Approach A — Selected Design

Four components that compose into a complete system, modelled on service-skills-set patterns.

---

### Component 1: `tracks:` Frontmatter Field

Add a `tracks:` field to the memory metadata schema. Every memory declares which file paths it documents.

```yaml
---
title: "Service Skills Set — SSOT"
domain: "project-skills"
version: "1.0.0"
updated: "2026-02-24"
tracks:
  - "project-skills/service-skills-set/**"
  - "project-skills/service-skills-set/.claude/**"
changelog:
  - version: "1.0.0"
    date: "2026-02-24"
    summary: "Initial."
---
```

**Rules:**
- `tracks:` is optional but required for drift detection to work
- Globs follow `fnmatch` syntax (same as service-skills-set territories)
- Memories without `tracks:` are treated as undriftable (e.g. reference docs, taxonomy)

**Migration:** `validate_metadata.py` warns when `tracks:` is absent but not an error (backwards compatible). A migration pass updates existing memories.

---

### Component 2: `drift_detector.py`

New script at `skills/documenting/scripts/drift_detector.py`.

**Interface:**

```bash
# Scan all memories for drift against recent commits
python3 drift_detector.py scan [--since N]   # default: last 20 commits

# Check a specific memory
python3 drift_detector.py check <memory-name>

# Called by Stop hook — reads from env, outputs JSON
python3 drift_detector.py hook
```

**Logic (`scan`):**
1. List all memories in `.serena/memories/` via `list_memories`
2. For each memory with `tracks:` frontmatter, extract globs
3. Run `git log --name-only --since=<date>` to get recently modified files
4. Match modified files against `tracks:` globs using `fnmatch`
5. Compare match timestamps against memory `updated:` field
6. Report stale memories with: memory name, stale since, modified files that triggered

**Output (scan):**
```
[Drift Report] 2 memories stale:

  ssot_cli_hooks_2026-02-03
    Stale since: 2026-02-20 (14 days)
    Modified files: hooks/skill-suggestion.py, hooks/pre-commit.py

  ssot_jaggers-agent-tools_service_skills_set_2026-02-23
    Stale since: 2026-02-24 (today)
    Modified files: project-skills/service-skills-set/.claude/settings.json

Run /documenting to update.
```

**Output (hook mode):** JSON for Claude Code hook consumption:
```json
{
  "hookSpecificOutput": {
    "hookEventName": "Stop",
    "additionalContext": "[Docs Drift] 2 memories are stale: ssot_cli_hooks, ssot_service_skills_set.\nRun /documenting to sync."
  }
}
```

---

### Component 3: Stop Hook

New entry in `settings.json` (installed by CLI sync):

```json
"Stop": [{
  "hooks": [{
    "type": "command",
    "command": "python3 \"$CLAUDE_PROJECT_DIR/.serena/memories/../../../jaggers/skills/documenting/scripts/drift_detector.py\" hook",
    "timeout": 5
  }]
}]
```

**Behaviour:**
- Runs `drift_detector.py hook` at session end
- Script checks git diff for session-written files vs `tracks:` globs
- **Produces no output when nothing is stale** — zero token cost in the common case
- Injects a one-line reminder only when stale memories are found
- Uses `git diff HEAD~1..HEAD --name-only` to limit scope to the current session's changes

**Token cost:** ~0 when clean. ~30 tokens (one line) when stale. Never more than that.

---

### Component 4: Intra-Memory Auto-Index

Every memory gets a `<!-- INDEX -->` block immediately after the frontmatter, auto-generated from `##` headings + first sentence of each section.

**Format:**

```markdown
---
frontmatter...
---

<!-- INDEX: auto-generated — do not edit manually -->
| Section | Summary |
|---|---|
| [Architecture](#architecture) | Trinity of 3 skills + scripts + service registry |
| [Hook Wiring](#hook-wiring) | SessionStart, PreToolUse, PostToolUse configs in settings.json |
| [3-Phase Workflow](#3-phase-workflow) | scaffold → Serena deep dive → hook registration |
| [Installer](#installer) | Single-purpose install-service-skills.py, idempotent |
| [Key Constraints](#key-constraints) | allowed-tools rules, disable-model-invocation, SessionStart |
<!-- END INDEX -->

---

## Architecture
...
```

**Generation rules:**
- Scan all `## Heading` lines (not `###` — top-level sections only)
- Extract first non-empty sentence from each section body as summary
- If section has no prose (only sub-headings or code), use `<heading text>` as placeholder summary
- Regenerate the block in-place between `<!-- INDEX -->` and `<!-- END INDEX -->`

**Wired into:**
- `generate_template.py` — creates stub index with empty summaries on new memory creation
- `validate_metadata.py` — regenerates index on every validation run

**Agent usage pattern:**
```
1. read_memory("target") → agent reads only the INDEX block (~20 lines)
2. search_for_pattern("## Hook Wiring", relative_path=".serena/memories/target.md")
3. Read specific section only — never the full 500-line document
```

---

## SKILL.md Workflow Rewrite

The SKILL.md body is rewritten with a clear decision tree and explicit steps:

```
When /documenting is invoked:

1. Run drift_detector.py scan → identify stale memories
2. Decide action:
   - New feature shipped? → create or update SSOT memory
   - Bug fixed / refactor? → update relevant SSOT + bump version
   - Just CHANGELOG entry? → run changelog/add_entry.py
   - Nothing stale? → confirm to user, done

3. For each stale/new memory:
   a. activate_project()
   b. Read memory INDEX block only
   c. Edit specific stale sections
   d. Bump version, update `updated:` timestamp
   e. Re-run validate_metadata.py (regenerates INDEX)

4. CHANGELOG step (always):
   - python3 scripts/changelog/add_entry.py <version> <type> "<summary>"
```

---

## Files to Create / Modify

| File | Action | Notes |
|---|---|---|
| `skills/documenting/scripts/drift_detector.py` | **Create** | New — scan, check, hook subcommands |
| `skills/documenting/scripts/validate_metadata.py` | **Modify** | Add: `tracks:` validation, INDEX regeneration |
| `skills/documenting/scripts/generate_template.py` | **Modify** | Add: stub INDEX block, `tracks:` field in frontmatter |
| `skills/documenting/references/metadata-schema.md` | **Modify** | Document `tracks:` field |
| `skills/documenting/SKILL.md` | **Modify** | Rewrite workflow section with decision tree |
| `skills/documenting/templates/*.md.template` | **Modify** | Add `tracks:` and `<!-- INDEX -->` stub |
| `config/settings.json` | **Modify** | Add Stop hook entry |
| Existing memories in `.serena/memories/` | **Migrate** | Add `tracks:` frontmatter to each |

---

## Non-Goals

- No cross-memory index file (Serena already has `list_memories`)
- No LLM calls in Stop hook (must be pure Python, <5s)
- No breaking changes to existing memory format (all additions are backwards-compatible)
- No marksman LSP configuration (intra-memory index solves the navigation problem without it)
