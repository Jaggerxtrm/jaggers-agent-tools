---
title: Delegating Skill
version: 1.0.0
updated: 2026-02-23
domain: skills
tracks:
  - "skills/delegating/**"
  - "hooks/skill-suggestion.py"
scope: delegating
category: ssot
changelog:
  - 1.0.0: Initial documentation after skill hardening (v7.0.0 → hardened).
---

# Delegating Skill

Routes tasks to cost-optimized agents (CCS/GLM, Gemini, Qwen) or multi-agent orchestration (Gemini+Qwen) instead of handling them in the main Claude session.

## Location

- **Source of truth**: `skills/delegating/SKILL.md` (syncs to `~/.claude/skills/delegating/SKILL.md`)
- **Config**: `skills/delegating/config.yaml` (pattern → backend mappings)
- **References**: `skills/delegating/references/`

## Frontmatter (Official Fields Only)

```yaml
name: delegating
description: >-
  Proactively delegates tasks to cost-optimized agents before working in main session.
  MUST suggest for: tests, typos, formatting, docs, refactors, code reviews, feature
  implementation, debugging, commit validation. ...
allowed-tools: Bash
```

Unsupported fields removed: `version`, `gemini-command`, `gemini-prompt`.

## Backend Routing

| Task Pattern | Backend | Cost |
|---|---|---|
| typo, test, doc, format, lint | CCS (GLM) | LOW |
| think, analyze, reason | CCS (Gemini) | MEDIUM |
| review code/security, security audit | Orchestration | HIGH |
| implement feature, build feature | Orchestration | HIGH |
| debug, root cause, crash | Orchestration | HIGH |
| validate commit, pre-commit | Orchestration | MEDIUM |

## CCS Execution Inside Claude Code

CCS spawns Claude Code subprocesses. When `$CLAUDECODE` is set, the nested session guard blocks it.

**Fix**: Always use `env -u CLAUDECODE ccs {profile} -p "{task}"` for CCS calls.

This was confirmed safe: parent session survives, GLM-4.7 responds correctly (tested 2026-02-23).

## Interactive Flow

1. `AskUserQuestion` — "Delegate or work in main session?"
2. If delegate → `AskUserQuestion` — backend selection (Auto / GLM / Gemini / Qwen / Orchestration)
3. Execute via appropriate CLI:
   - CCS: `env -u CLAUDECODE ccs {profile} -p "{task}"`
   - Gemini: `gemini -p "{task}"`
   - Qwen: `qwen "{task}"`
   - Orchestration: sequential gemini/qwen turns per workflow protocol

## Orchestration Workflows

| Workflow | Protocol |
|---|---|
| handshake | Gemini proposes → Qwen validates (1 turn each) |
| collaborative | Gemini designs → Qwen critiques → Gemini refines (3 turns) |
| troubleshoot | Gemini hypothesis → Qwen verify → Gemini root cause → synthesis (4 turns) |

## Auto-Triggering

Three layers:
1. **`skillSuggestions.enabled: true`** in `settings.json` — UI suggestion chips
2. **Description keywords** — auto-loads SKILL.md when prompt matches
3. **`skill-suggestion.py` UserPromptSubmit hook** — injects system_message reminder

## References
- `skills/delegating/SKILL.md`
- `skills/delegating/config.yaml`
- `hooks/skill-suggestion.py`
- `~/.ccs/.claude/skills/ccs-delegation/SKILL.md` (CCS subprocess context, separate)
