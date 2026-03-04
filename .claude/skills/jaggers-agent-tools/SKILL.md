# jaggers-agent-tools Development Patterns

> Auto-generated skill from repository analysis

## Overview

The jaggers-agent-tools repository is a Python-based toolkit for managing AI agent workflows and tools. It follows a structured approach with conventional commits, SSOT (Single Source of Truth) memory documentation, and modular skill development. The codebase emphasizes documentation-driven development with comprehensive design documents and automated workflow management.

## Coding Conventions

### File Naming
- Use **camelCase** for file names: `fileName.py`, `configManager.py`
- Test files follow pattern: `*.test.*`
- Skill documentation: `SKILL.md` (uppercase)
- Memory files: `ssot_*.md` format in `.serena/memories/`

### Import Style
```python
# Use relative imports
from .utils import helper_function
from ..config import settings
from . import module_name
```

### Export Style
```python
# Use named exports
def public_function():
    pass

def another_helper():
    pass

# Explicit exports
__all__ = ['public_function', 'another_helper']
```

### Commit Conventions
- Use conventional commit format: `type: description`
- Common prefixes: `feat:`, `docs:`, `fix:`, `chore:`, `refactor:`
- Keep messages around 60 characters
- Examples: `feat: add new CLI command`, `docs: update skill documentation`

## Workflows

### Version Release Documentation
**Trigger:** When releasing a new version of the software
**Command:** `/release-version`

1. Update `CHANGELOG.md` with new version entry including features, fixes, and breaking changes
2. Update version references in documentation files
3. Update `README.md` version table if applicable
4. Update relevant SSOT memory files in `.serena/memories/`
5. Commit with message: `chore: release version X.Y.Z`

### SSOT Memory Documentation  
**Trigger:** When documenting system changes or architectural decisions
**Command:** `/update-memory`

1. Identify the relevant SSOT memory file in `.serena/memories/`
2. Update memory content with new information or decisions
3. Batch update multiple related memory files if needed
4. Regenerate INDEX sections in memory files
5. Commit with: `docs: update SSOT memories for [component]`

### Skill Development Workflow
**Trigger:** When adding or modifying a skill
**Command:** `/new-skill`

1. Create skill directory: `skills/[skill-name]/`
2. Create `SKILL.md` with metadata, description, and usage instructions
3. Add supporting scripts in appropriate directories
4. Update configuration files:
   - `config/settings.json`
   - `config/mcp_servers_optional.json`
5. Add hooks if needed: `hooks/*.cjs`
6. Update documentation and reference materials
7. Commit with: `feat: add [skill-name] skill`

### CLI Feature Development
**Trigger:** When adding or modifying CLI functionality  
**Command:** `/cli-feature`

1. Modify CLI source files in `cli/src/**/*.ts`
2. Build and update distribution files:
   - `cli/dist/index.cjs`
   - `cli/dist/index.cjs.map`
3. Update package dependencies in `cli/package*.json` if needed
4. Update related documentation or SSOT memories
5. Test the CLI functionality
6. Commit with: `feat: add CLI [feature-name]`

### Design Document Creation
**Trigger:** When planning a new feature or system component
**Command:** `/design-doc`

1. Create design document in `docs/plans/[feature]-design.md`
2. Include sections: Problem, Solution, Architecture, Implementation
3. Create implementation plan: `docs/plans/[feature]-implementation.md`
4. Review and iterate on design
5. Follow up with implementation commits
6. Commit with: `docs: add design document for [feature]`

### Configuration Integration
**Trigger:** When integrating a new tool or MCP server
**Command:** `/integrate-tool`

1. Add configuration entry to:
   - `config/mcp_servers_optional.json` for MCP servers
   - `config/settings.json` for general tools
2. Create supporting skill in `skills/[tool-name]/`
3. Add hooks if needed: `hooks/[tool-name].cjs`
4. Create supporting scripts as needed
5. Update documentation
6. Test integration
7. Commit with: `feat: integrate [tool-name]`

## Testing Patterns

Tests follow the `*.test.*` naming pattern. While the specific framework is not detected, maintain these practices:

```python
# Test file example: moduleNameTest.py or module.test.py
import unittest
from .moduleUnderTest import function_to_test

class TestModuleName(unittest.TestCase):
    def setUp(self):
        # Setup test data
        pass
    
    def test_function_behavior(self):
        # Test specific functionality
        result = function_to_test(input_data)
        self.assertEqual(result, expected_output)
```

## Commands

| Command | Purpose |
|---------|---------|
| `/release-version` | Document and release a new version |
| `/update-memory` | Update SSOT memory files with new information |
| `/new-skill` | Create or modify a skill with full documentation |
| `/cli-feature` | Develop new CLI functionality |
| `/design-doc` | Create comprehensive design documents |
| `/integrate-tool` | Add new tools or MCP servers to the system |