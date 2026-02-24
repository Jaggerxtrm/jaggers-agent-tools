---
title: "Hook Migration and Delegation Refactoring"
version: 1.0.0
created: 2026-02-01
updated: 2026-02-01T05:15:00+00:00
scope: jaggers-agent-tools-migration
category: ssot
subcategory: infrastructure
domain: [hooks, delegation, python, cli, tooling]
tracks:
  - "cli/**"
status: active
changelog:
  - version: 1.0.0
    date: 2026-02-01
    changes: Initial documentation of hook migration and delegation refactoring
---

# Hook Migration and Delegation Refactoring - SSOT

## Overview

This document captures the complete migration from shell-based hooks to Python-based hooks, the refactoring of the delegation skill system, and the reorganization of the project structure.

## Major Changes

### 1. Hook Migration: Shell → Python

**Status**: ✅ Completed on 2026-02-01

**Motivation**:
- Better error handling and maintainability
- Consistent execution across platforms
- Easier integration with Python-based tooling
- Improved debugging capabilities

**Files Migrated**:

| Shell Script (Deprecated) | Python Replacement | Status |
|---------------------------|-------------------|--------|
| `hooks/pip-venv-guard.sh` | `hooks/pip-venv-guard.py` | ✅ Deleted |
| `hooks/serena-workflow-reminder.sh` | `hooks/serena-workflow-reminder.py` | ✅ Deleted |
| `hooks/skill-suggestion.sh` | `hooks/skill-suggestion.py` | ✅ Deleted |
| `hooks/type-safety-enforcement.sh` | `hooks/type-safety-enforcement.py` | ✅ Deleted |

**Cleanup Performed**:
- ✅ Deleted `.sh` hooks from local `hooks/` directory
- ✅ Deleted `.sh` hooks from `~/.claude/hooks/`
- ✅ Deleted `.sh` hooks from `~/.gemini/hooks/`
- ✅ Deleted `.sh` hooks from `~/.gemini/antigravity/hooks/`
- ✅ Deleted `.sh` hooks from `~/.qwen/hooks/`

**Remaining Files**:
- `hooks/statusline.js` (JavaScript - different purpose)
- `hooks/gsd-check-update.js` (JavaScript - different purpose)

### 2. Delegation Skill Refactoring

**Status**: ✅ Completed (commits 1551d34, 1a65942)

**Architecture Changes**:

#### Before (v5.0.0):
- Skill: `/ccs-delegation` (hardcoded patterns)
- Config: `~/.ccs/config.yaml` (external dependency)
- Backend: CCS only (GLM, Gemini, Qwen)

#### After (v6.0.0):
- **Skill**: `/delegation` or `/delegating` (unified)
- **Config**: `skills/delegating/config.yaml` (self-contained)
- **Backends**: 
  - CCS (cost-optimized models)
  - unitAI (multi-agent workflows)
- **Pattern Matching**: Configuration-driven with priority system

**New Structure**:
```
skills/delegating/
├── SKILL.md              # Main skill logic
├── config.yaml           # Complete configuration (NEW)
└── references/
    └── unitai-workflows.md  # Workflow documentation
```

**Deprecated Structure** (Deleted):
```
skills/ccs-delegation/     # ❌ Completely removed
skills/delegation/         # ❌ Replaced by skills/delegating/
```

**Key Features**:
1. **Configuration-Driven**: All patterns in `config.yaml`
2. **Auto-Selection**: Intelligent backend routing
3. **Workflow Support**: 
   - `parallel-review`: Multi-perspective code review
   - `feature-design`: Architecture planning
   - `bug-hunt`: Systematic debugging
   - `auto-remediation`: Automated fixes
   - `triangulated-review`: Goal-backward validation
4. **Override Flags**: `--glm`, `--gemini`, `--qwen`, `--unitai`
5. **Auto-Focus Detection**: Security, performance, quality parameters

### 3. Serena LSP Workflow Restructuring

**Status**: ✅ Completed

**Changes**:
- **Old**: `skills/serena-lsp-workflow/` (deleted)
- **New**: `skills/using-serena-lsp/` (active)

**Files**:
```
skills/using-serena-lsp/
├── SKILL.md          # Workflow instructions
├── README.md         # Usage guide
└── REFERENCE.md      # Quick reference
```

### 4. New CLI Tooling

**Status**: ✅ Added

**Purpose**: Config Manager for automated installation and synchronization

**Structure**:
```
cli/
├── index.js                  # Main entry point
├── lib/
│   ├── config-injector.js   # settings.json management
│   ├── context.js           # Agent context detection
│   ├── diff.js              # Repository comparison
│   └── sync.js              # Installation/sync logic
├── package.json
└── package-lock.json
```

**Features**:
1. Auto-detects agent paths (`~/.claude`, `~/.gemini`, etc.)
2. Scans for differences between repo and system
3. Install/update via Copy or Symlink
4. Auto-configures `settings.json`

**Usage**:
```bash
npx ./cli
```

### 5. Documentation Reorganization

**New Structure**:
```
docs/
├── delegation-architecture.md        # Delegation system design
├── hook-system-summary.md           # Hook reference
├── plans/
│   └── 2026-01-31-config-manager-cli.md  # CLI implementation plan
└── reference/
    ├── Get started with Claude Code hooks.md
    ├── Hooks reference.md
    ├── Intercept and control agent behavior with hooks.md
    ├── Programmatic tool calling.md
    ├── skills-authoring-guide-anthropics.md
    └── plans/
        └── skill-roadmap.md
```

### 6. Data Directory

**Added**:
```
data/
└── audit.sqlite    # Audit logging database
```

### 8. Gemini Support Integration
**Status**: ✅ Completed on 2026-02-02

**Motivation**:
- Support for Gemini CLI agent environments
- Dynamic configuration generation
- Incompatibility resolution between Claude/Gemini configs

**Changes**:
- **CLI Sync**: Added `transformGeminiConfig` logic
- **Transformer**: Maps Claude events to Gemini equivalents
  - `UserPromptSubmit` → `BeforeAgent`
  - `PreToolUse` → `BeforeTool`
- **Pathing**: Dynamic rewriting of `.claude` paths to `~/.gemini`
- **Filtering**: Removal of unsupported fields (`permissions`, `plugins`)

| Version | Date       | Changes |
|---------|-----------|---------|
| 6.0.0   | 2026-02-01 | Delegation refactoring (config-driven, unitAI support) |
| 5.1.0   | 2026-01-30 | Renamed `p` → `prompt-improving` |
| 5.0.0   | 2026-01-30 | Major refactoring, 90% token reduction |

## Breaking Changes

### For Users:

1. **Hooks**: 
   - ❌ Shell hooks (`.sh`) no longer supported
   - ✅ Use Python hooks (`.py`) instead
   - **Migration**: Automatic (already completed in global directories)

2. **Skills**:
   - ❌ `/ccs-delegation` deprecated
   - ✅ Use `/delegation` or `/delegating`
   - **Migration**: Update workflow references

3. **Configuration**:
   - ❌ `~/.ccs/config.yaml` no longer read
   - ✅ Use `skills/delegating/config.yaml`
   - **Migration**: Copy custom patterns to new config

## Git Status Snapshot (2026-02-01)

**Modified**:
- `README.md` - Updated skill names and documentation
- `hooks/README.md` - Updated hook references

**Deleted (Shell Hooks)**:
- `hooks/pip-venv-guard.sh`
- `hooks/serena-workflow-reminder.sh`
- `hooks/skill-suggestion.sh`
- `hooks/type-safety-enforcement.sh`

**Deleted (Old Skills)**:
- `skills/ccs-delegation/` (entire directory)
- `skills/delegation/` (replaced by `delegating/`)
- `skills/serena-lsp-workflow/` (replaced by `using-serena-lsp/`)

**Added (Python Hooks)**:
- `hooks/pip-venv-guard.py`
- `hooks/serena-workflow-reminder.py`
- `hooks/skill-suggestion.py`
- `hooks/type-safety-enforcement.py`

**Added (New Structure)**:
- `cli/` - Config Manager tooling
- `config/` - Configuration directory
- `data/` - Data storage (audit.sqlite)
- `docs/plans/` - Implementation plans
- `docs/reference/` - Reference documentation
- `skills/delegating/` - Unified delegation skill
- `skills/using-serena-lsp/` - Serena LSP workflow
- `.serena/memories/` - SSOT documentation storage

## Implementation Details

### Hook Migration Technical Details

**Python Implementation Benefits**:
1. **Error Handling**: Try-except blocks with detailed error messages
2. **JSON Parsing**: Native `json` module (vs `jq` dependency)
3. **Type Safety**: Type hints and validation
4. **Cross-Platform**: Works on Windows, macOS, Linux
5. **Testing**: Unit tests possible with pytest
6. **Maintenance**: Single language ecosystem

**Execution Model**:
- All hooks use `#!/usr/bin/env python3` shebang
- Hooks remain executable (`chmod +x`)
- Compatible with Claude Code hook system
- No breaking changes to hook interface

### Delegation Configuration Schema

**config.yaml Structure**:
```yaml
backends:
  ccs:
    profiles:
      glm: { pattern: "typo|test|simple" }
      gemini: { pattern: "document|comment" }
      qwen: { pattern: "refactor|optimize" }
  unitai:
    workflows:
      parallel-review: { pattern: "review|audit" }
      feature-design: { pattern: "design|architect" }
      bug-hunt: { pattern: "debug|bug|error" }
```

**Priority System**:
1. User flags (`--unitai`, `--glm`) override all
2. UnitAI patterns checked first
3. CCS patterns as fallback
4. Manual selection if no match

## Verification

**Tests Performed**:
- ✅ Hook cleanup verified in all global directories
- ✅ Python hooks executable and properly formatted
- ✅ Git status confirms deletions
- ✅ No `.sh` hooks remaining in repository
- ✅ SSOT documentation created and validated

## Next Steps

1. **Testing**: Verify Python hooks work across all agent contexts
2. **Documentation**: Update README.md with Python hook migration notes
3. **User Migration**: Notify users of breaking changes
4. **CLI Testing**: Validate Config Manager installation flow
5. **Workflow Testing**: Test delegation auto-selection with real tasks

## References

- Commit 1a65942: "refactor: Make delegation skill configuration-driven"
- Commit 1551d34: "feat: Implement unified /delegation skill (CCS + unitAI workflows)"
- Commit 5ccd735: "Pre-refactoring backup: Hook improvements and delegation architecture"
- Commit cdd3b34: "Initial commit: v5.1.0 skills and hooks"

## Related Documentation

- `docs/delegation-architecture.md` - Delegation system design
- `docs/hook-system-summary.md` - Hook system overview
- `skills/delegating/SKILL.md` - Delegation skill documentation
- `skills/delegating/config.yaml` - Configuration reference
- `hooks/README.md` - Hook usage guide

---

**Document Maintained By**: Jaggers Agent Tools Project  
**Last Verified**: 2026-02-01  
**Status**: Production-Ready ✅
