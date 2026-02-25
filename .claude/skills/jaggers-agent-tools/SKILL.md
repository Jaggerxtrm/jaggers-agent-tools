# jaggers-agent-tools Development Patterns

> Auto-generated skill from repository analysis

## Overview

This codebase is a Python-based agent tools repository that implements CLI commands, core utilities, and skill management systems. The project follows conventional commit patterns and maintains comprehensive documentation through SSOT (Single Source of Truth) memories, implementation plans, and automated changelog management.

## Coding Conventions

### File Naming
- Use camelCase for file names
- Test files follow `*.test.*` pattern
- Skills use structured directories: `skills/*/SKILL.md`
- Plans follow descriptive naming: `*-design.md`, `*-implementation.md`

### Import Style
```python
# Use relative imports
from .core import utilities
from ..utils import helpers
```

### Export Style
```python
# Use named exports
__all__ = ['function_name', 'ClassName']

def function_name():
    pass

class ClassName:
    pass
```

### Commit Messages
- Follow conventional commits format
- Use prefixes: `feat:`, `docs:`, `fix:`, `chore:`, `refactor:`
- Keep messages around 60 characters average
- Examples:
  ```
  feat: add new CLI command for skill management
  docs: update SSOT memory for feature workflow
  fix: resolve import path in core utilities
  ```

## Workflows

### Documentation Workflow
**Trigger:** When documenting features, changes, or implementing documentation improvements
**Command:** `/document-feature`

1. Create or update SSOT memory files in `.serena/memories/ssot_*.md`
2. Add version entry to `CHANGELOG.md` with detailed changes
3. Create implementation plans in `docs/plans/` directory
4. Update related documentation files for consistency
5. Commit with `docs:` prefix

### Feature Development
**Trigger:** When adding new functionality to the CLI tool
**Command:** `/add-cli-command`

1. Create or modify CLI command files in `cli/src/commands/`
2. Update core utilities in `cli/src/core/` as needed
3. Modify supporting utilities in `cli/src/utils/`
4. Build distribution files using build process
5. Document changes in `CHANGELOG.md`
6. Update relevant SSOT memories
7. Commit with `feat:` prefix

### Skill Management
**Trigger:** When working with agent skills and their associated tooling
**Command:** `/update-skill`

1. Create or update `SKILL.md` files in appropriate skill directory
2. Add supporting Python scripts in `skills/*/scripts/`
3. Update skill configurations and dependencies
4. Add entries to `config/settings.json` if needed
5. Test skill functionality
6. Commit with `feat:` or `docs:` prefix

### Configuration Sync
**Trigger:** When modifying MCP servers, settings, or project configurations
**Command:** `/sync-config`

1. Update configuration files in `config/` directory
2. Rebuild CLI distribution to include changes
3. Update related settings in `.gemini/settings.json`
4. Sync changes to `cli/.gemini/settings.json`
5. Verify configuration consistency across environments
6. Commit with `chore:` prefix

### Planning Workflow
**Trigger:** When planning new features or architectural changes
**Command:** `/create-plan`

1. Create design document in `docs/plans/` with `-design.md` suffix
2. Create corresponding implementation plan with `-implementation.md` suffix
3. Update related documentation to reference new plans
4. Review and refine planning documents
5. Commit with `docs:` prefix

### Build Distribution
**Trigger:** When CLI source code is modified and needs to be distributed
**Command:** `/build-cli`

1. Update CLI source files in `cli/src/` directory
2. Run build process to generate `cli/dist/index.cjs`
3. Verify source maps are generated (`cli/dist/index.cjs.map`)
4. Update package files if dependencies changed
5. Test distribution locally
6. Commit with appropriate prefix (`feat:`, `fix:`, or `chore:`)

## Testing Patterns

```python
# Test files follow *.test.* pattern
# Example: feature_manager.test.py

def test_feature_functionality():
    """Test description following docstring conventions"""
    # Arrange
    setup_data = create_test_data()
    
    # Act
    result = feature_function(setup_data)
    
    # Assert
    assert result.status == 'success'
    assert len(result.data) > 0
```

## Commands

| Command | Purpose |
|---------|---------|
| `/document-feature` | Create comprehensive documentation with SSOT memories and changelog |
| `/add-cli-command` | Implement new CLI functionality with proper structure |
| `/update-skill` | Manage agent skills and their supporting files |
| `/sync-config` | Update and synchronize configuration across environments |
| `/create-plan` | Create design and implementation planning documents |
| `/build-cli` | Build and distribute CLI changes |