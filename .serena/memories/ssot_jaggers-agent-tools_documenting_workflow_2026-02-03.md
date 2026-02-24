---
title: "Project Documentation Workflow"
version: 1.0.0
created: 2026-02-03
updated: 2026-02-03T12:00:00+00:00
scope: jaggers-agent-tools
category: ssot
subcategory: workflow
domain: [documentation, ssot, changelog, readme, claude-md]
tracks:
  - "skills/documenting/**"
status: active
changelog:
  - version: 1.0.0
    date: 2026-02-03
    changes: Initial documentation of the project-wide documentation update workflow.
---

# Project Documentation Workflow - SSOT

## Overview

This document defines the mandatory process for updating documentation within the `jaggers-agent-tools` project. Documentation is treated as a first-class citizen and must be updated alongside any functional changes.

## Core Documentation Artifacts

| Artifact | Location | Purpose |
|----------|----------|---------|
| **Changelog** | `CHANGELOG.md` | Public record of all changes, versions, and migrations. |
| **README** | `README.md` | User-facing entry point, feature highlights, and installation guides. |
| **Claude Guide** | `CLAUDE.md` | Agent-facing technical reference, common commands, and architecture overview. |
| **SSOT Memories** | `.serena/memories/` | Deep technical knowledge base and single source of truth for domains. |
| **Skill Docs** | `skills/<skill-name>/` | Internal logic (`SKILL.md`) and user guides (`README.md`). |

## Installation & Distribution

### 1. Zero-Cloning Installation (Preferred)
The project supports direct execution via `npx` without the need to clone the repository manually.

```bash
npx -y github:Jaggerxtrm/jaggers-agent-tools
```

### 2. Manual Update Logic
When the repository is updated, users should run the local CLI to sync changes:
```bash
npx ./cli
```

## Update Workflow

### 1. Automated Documentation (Orchestrator)

The primary tool for documenting changes is the **Documenting Orchestrator**. It automates the update of `CHANGELOG.md` and provides suggestions for other files.

**Mandatory for all features, bugfixes, and refactors.**

```bash
# Workflow:
PYTHONPATH=/home/dawid/.gemini/skills/documenting \
cd /home/dawid/.gemini/skills/documenting && \
python3 scripts/orchestrator.py /home/dawid/projects/jaggers-agent-tools \
  [type] "[Description]" --scope=[scope] --category=[category]
```

**Types**: `feature`, `bugfix`, `refactor`, `breaking`, `docs`, `chore`.

### 2. Updating SSOT Memories

If a change introduces a new domain or fundamentally alters an existing one:

1. **Generate Template**:
   ```bash
   python3 /home/dawid/.gemini/skills/documenting/scripts/generate_template.py ssot .serena/memories/ssot_...md \
     title="[Title]" domain="[Domain]" ...
   ```
2. **Backfill Knowledge**: Ensure the memory captures the *why* and *how* of the implementation.
3. **Link Memories**: Reference relevant SSOTs in the `Related Documentation` section of new files.

### 3. Manual Polish

Always review and apply the suggestions provided by the orchestrator:
- **README.md**: Add new features to the ## Features section and update usage examples.
- **CLAUDE.md**: Ensure new critical files or common commands are added to the technical guide.
- **Skill READMEs**: Update if parameters or behaviors changed.

### 4. Versioning & Releases

When preparing a release:
1. Ensure `[Unreleased]` section in `CHANGELOG.md` is populated.
2. Use `scripts/changelog/bump_release.py` to finalize the version.
3. Update version strings in `orchestrating-agents.skill` (repackage if necessary) and project metadata.

## Standards & Quality

- **Conciseness**: Follow the Anthropic "Concise is Key" principle.
- **Gerund Naming**: Skills must use gerund naming (e.g., `documenting`, `orchestrating-agents`).
- **Validation**: Run the orchestrator in validation mode before finalizing a task.
  ```bash
  python3 scripts/orchestrator.py /path/to/project validate
  ```

## Related Documentation

- `skills/documenting/SKILL.md` - Technical instructions for the documenting skill.
- `ssot_jaggers-agent-tools_migration_2026-02-01.md` - History of hook and delegation migrations.