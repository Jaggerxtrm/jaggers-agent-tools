---
title: "Service Skills Set — SSOT"
domain: "project-skills"
tracks:
  - "project-skills/service-skills-set/**"
version: "1.0.0"
created: "2026-02-23"
updated: "2026-02-23"
changelog:
  - version: "1.0.0"
    date: "2026-02-23"
    summary: "Initial SSOT — documents the complete service-skills-set system including trinity, hooks, installer, and 3-phase workflow."
---

# Service Skills Set — SSOT

## Location

```
project-skills/service-skills-set/
```

The canonical source for project-specific Claude Code service skill infrastructure. Installed into target projects via `install-service-skills.py`.

---

## Architecture

### Trinity Skills

Three workflow skills are installed into `.claude/skills/` of any target project:

| Skill | Invocation | Role |
|---|---|---|
| `creating-service-skills` | `/creating-service-skills` | 3-phase workflow: scaffold → Serena deep dive → hook registration |
| `using-service-skills` | Auto (SessionStart) | Catalog injection + skill activation |
| `updating-service-skills` | `/updating-service-skills` | Drift detection and sync |

### Scripts

Each trinity skill has scripts under its `scripts/` subdirectory:

- `creating-service-skills/scripts/bootstrap.py` — shared registry CRUD, project root resolution
- `creating-service-skills/scripts/scaffolder.py` — Phase 1: generate SKILL.md skeleton + script stubs + official docs detection
- `creating-service-skills/scripts/deep_dive.py` — Phase 2: prints Serena LSP-driven research protocol
- `using-service-skills/scripts/cataloger.py` — SessionStart: outputs XML catalog of registered services (~150 tokens)
- `using-service-skills/scripts/skill_activator.py` — PreToolUse: territory/command-based skill enforcement
- `updating-service-skills/scripts/drift_detector.py` — PostToolUse: file-to-service matching + drift alert

### Git Hooks

```
.claude/git-hooks/
├── doc_reminder.py      — pre-commit: warns on source change without SSOT update (non-blocking)
└── skill_staleness.py   — pre-push: warns if SKILL.md older than staged service files (non-blocking)
```

Installed idempotently via marker-based append to `.githooks/` then activated to `.git/hooks/`.

### Service Registry

`.claude/skills/service-registry.json` (installed in target project):

```json
{
  "services": {
    "<service-id>": {
      "name": "...",
      "territory": ["src/<svc>/**/*.py"],
      "skill_path": ".claude/skills/<service-id>/SKILL.md",
      "description": "...",
      "last_sync": "ISO8601"
    }
  }
}
```

---

## Hook Wiring (settings.json)

Three Claude Code hooks wired at install time:

```json
{
  "hooks": {
    "SessionStart": [{"hooks": [{"type": "command",
      "command": "python3 \"$CLAUDE_PROJECT_DIR/.claude/skills/using-service-skills/scripts/cataloger.py\""}]}],
    "PreToolUse": [{"matcher": "Read|Write|Edit|Glob|Grep|Bash",
      "hooks": [{"type": "command",
        "command": "python3 \"$CLAUDE_PROJECT_DIR/.claude/skills/using-service-skills/scripts/skill_activator.py\""}]}],
    "PostToolUse": [{"matcher": "Write|Edit",
      "hooks": [{"type": "command",
        "command": "python3 \"$CLAUDE_PROJECT_DIR/.claude/skills/updating-service-skills/scripts/drift_detector.py\" check-hook",
        "timeout": 10}]}]
  }
}
```

**Note:** `SessionStart` is NOT supported in skill frontmatter — must live in `settings.json`.  
**Note:** PostToolUse in `settings.json` fires always-on (not just when skill is active in session).

---

## 3-Phase Workflow (creating-service-skills)

### Phase 1 — Scaffold

```bash
python3 "$CLAUDE_PROJECT_DIR/.claude/skills/creating-service-skills/scripts/scaffolder.py" \
  create <service-id> <territory-path> "<description>"
```

- Reads `docker-compose*.yml`, `Dockerfile`, `requirements.txt`, `Cargo.toml`, `package.json`
- Produces `SKILL.md` with `[PENDING RESEARCH]` markers
- Auto-detects official doc URLs from 30+ technology mappings
- Writes script stubs: `health_probe.py`, `log_hunter.py`, `data_explorer.py`, `references/deep_dive.md`
- Registers service in `service-registry.json`

### Phase 2 — Agentic Deep Dive

Claude fills all `[PENDING RESEARCH]` markers using Serena LSP tools:
- `get_symbols_overview` — map module structure
- `find_symbol` — read specific functions
- `search_for_pattern` — find log strings, SQL, env vars
- `find_referencing_symbols` — trace data flows

Rule: Do NOT read entire files. Map first, then read only what you need.

### Phase 3 — Hook Registration (verification)

- Confirm `PreToolUse` hook in `.claude/settings.json` points to `skill_activator.py`
- Verify territory globs in `service-registry.json`
- Inform user: skill auto-activates on territory file access and service-name commands

---

## Installer

```bash
# Run from inside target project directory
python3 /path/to/jaggers-agent-tools/project-skills/service-skills-set/install-service-skills.py
```

Path constants in installer (after `service-skills-set/` reorganization):

```python
SCRIPT_DIR = Path(__file__).parent.resolve()      # service-skills-set/
REPO_ROOT  = SCRIPT_DIR.parent.parent.resolve()   # jaggers-agent-tools/
SKILLS_SRC = SCRIPT_DIR / ".claude"               # service-skills-set/.claude/
GIT_HOOKS  = SKILLS_SRC / "git-hooks"             # service-skills-set/.claude/git-hooks/
```

Idempotent — safe to re-run after updates.

---

## Key Constraints

- `allowed-tools` in skill frontmatter: Claude Code native names only (`Read`, `Write`, `Bash(python3 *)`, `Grep`, `Glob`) — NOT MCP/Serena tool names
- `disable-model-invocation: true` must NOT be used in workflow/knowledge skills (prevents AI processing)
- Only `PreToolUse`, `PostToolUse`, `Stop` are valid in skill-level `hooks` frontmatter
- Bootstrap path resolution: scripts use 3-level relative path from installed location → `creating-service-skills/scripts/`

---

## Bootstrap Cross-Reference Pattern

All scripts that need registry access import bootstrap:

```python
BOOTSTRAP_DIR = Path(__file__).parent.parent.parent / "creating-service-skills" / "scripts"
sys.path.insert(0, str(BOOTSTRAP_DIR))
from bootstrap import get_project_root, load_registry, get_skills_root
```

This resolves correctly to `.claude/skills/creating-service-skills/scripts/` after installation in any project.
