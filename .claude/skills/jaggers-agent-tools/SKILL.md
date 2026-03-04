# jaggers-agent-tools Development Patterns

> Auto-generated skill from repository analysis

## Overview

This skill teaches the development patterns for the jaggers-agent-tools repository, a Python-based project focused on agent tools and capabilities. The codebase follows a structured approach with conventional commits, organized workflows for feature development, documentation updates, and skill creation. The project emphasizes maintaining comprehensive documentation and memory files for tracking changes and project state.

## Coding Conventions

### File Naming
- Use **camelCase** for file names
- Example: `myFeature.py`, `skillBuilder.py`

### Import Style
- Use **relative imports** within the project
- Example:
```python
from .utils import helper_function
from ..config import settings
```

### Export Style
- Use **named exports** for functions and classes
- Example:
```python
# In module file
def create_skill():
    pass

def update_documentation():
    pass

# Export explicitly
__all__ = ['create_skill', 'update_documentation']
```

### Commit Conventions
- Follow **conventional commit** format
- Common prefixes: `feat`, `docs`, `fix`, `chore`, `refactor`
- Keep commit messages around **60 characters**
- Examples:
  - `feat: add new agent skill creation workflow`
  - `docs: update CHANGELOG with v1.2.0 features`
  - `fix: resolve configuration loading issue`

## Workflows

### Documentation Update Workflow
**Trigger:** When completing a feature or making significant changes  
**Command:** `/update-docs`

1. Update SSOT memory files in `.serena/memories/ssot_*.md`
2. Add version entry to `CHANGELOG.md` with new features/fixes
3. Update `README.md` if public API changed
4. Update related documentation files in `docs/plans/`
5. Commit with message: `docs: update documentation for [feature/version]`

### Feature Development Workflow
**Trigger:** When adding new functionality to the project  
**Command:** `/new-feature`

1. Create design document in `docs/plans/[feature-name]-design.md`
2. Plan implementation in `docs/plans/[feature-name]-implementation.md`
3. Implement feature in appropriate module under `cli/src/`
4. Update configuration files in `config/` if needed
5. Document changes in `CHANGELOG.md`
6. Update memory files in `.serena/memories/`
7. Commit with message: `feat: [brief description of feature]`

### Skill Creation Workflow
**Trigger:** When adding new agent skills or capabilities  
**Command:** `/new-skill`

1. Create skill directory: `skills/[skill-name]/`
2. Write `SKILL.md` with proper frontmatter:
```markdown
---
name: skill-name
description: Brief description
version: 1.0.0
---
```
3. Add supporting scripts in `skills/[skill-name]/scripts/`
4. Create reference documentation in `skills/[skill-name]/references/`
5. Update `config/settings.json` to register the skill
6. Commit with message: `feat: add [skill-name] skill`

### CLI Build and Distribution Workflow
**Trigger:** When making changes to CLI source code  
**Command:** `/build-cli`

1. Modify CLI source files in `cli/src/`
2. Run build process to generate distribution files
3. Update `cli/dist/index.cjs` and `cli/dist/index.cjs.map`
4. Update `cli/package.json` version if needed
5. Test built CLI functionality
6. Commit with message: `build: update CLI distribution files`

### Configuration Update Workflow
**Trigger:** When adding new tools, servers, or changing project settings  
**Command:** `/update-config`

1. Update `config/settings.json` with new configurations
2. Add entries to `config/mcp_servers_optional.json` for MCP servers
3. Update `.serena/project.yml` if project structure changed
4. Update related documentation
5. Test configuration loading
6. Commit with message: `chore: update configuration for [purpose]`

### Planning Document Workflow
**Trigger:** When planning new features or architectural changes  
**Command:** `/new-plan`

1. Create design document: `docs/plans/[plan-name]-design.md`
2. Include requirements, constraints, and architecture decisions
3. Create implementation plan: `docs/plans/[plan-name]-implementation.md`
4. Break down into actionable tasks
5. Reference from other documentation as needed
6. Commit with message: `docs: add planning documents for [feature]`

## Testing Patterns

### Test File Structure
- Test files follow pattern: `*.test.*`
- Place tests near the code they test
- Example: `myFeature.test.py` for `myFeature.py`

### Test Organization
```python
# Example test structure
import unittest
from .myFeature import create_skill

class TestSkillCreation(unittest.TestCase):
    def test_skill_creation(self):
        # Test implementation
        pass
```

## Commands

| Command | Purpose |
|---------|---------|
| `/update-docs` | Update project documentation and memory files after changes |
| `/new-feature` | Create a new feature with planning and implementation |
| `/new-skill` | Create a new agent skill with full documentation |
| `/build-cli` | Build CLI changes and update distribution files |
| `/update-config` | Update configuration files for new integrations |
| `/new-plan` | Create design and implementation planning documents |