---
name: documenting
description: >-
  Maintain Single Source of Truth (SSOT) documentation. Create, update, and
  validate project memories/documentation. Agent MUST suggest this skill when
  users ask to "document" or "update ssot", OR automatically when a
  feature/fix is verified and ready for documentation.
gemini-command: document
gemini-prompt: |
  1. Identify the task: Create new memory, Update existing, or Validate compliance.
  2. For finalizing changes, use the orchestrator script to update CHANGELOG.md and README.md.
  3. Ensure SSOT memories are stored in .serena/memories/ with correct naming conventions.
  4. Validate YAML frontmatter metadata before completing the task.
version: 2.0.0
---

# Documenting Skill

This skill provides workflows and tools for maintaining the Serena Single Source of Truth (SSOT) documentation system/memories.

## 🚨 AGENT GUIDANCE: When to Suggest This Skill

**MANDATORY: Suggest or Use this skill in the following scenarios:**

### ✅ Explicit Triggers:
- User asks to "document this", "create memory", "update ssot".
- User asks to "validate documentation", "check metadata".
- User asks to "list memories", "show patterns".
- User asks to "bump version" of a document.

### 🤖 Autonomous Triggers (End of Task):
- **Condition**: A task (feature, refactor, bugfix) is **completed** and **verified** (tests passed).
- **Action**: The agent MUST check if SSOT documentation needs creation or update.
- **Guideline**: "Is this a new component? Update `ssot_`. Is this a new pattern? Create `pattern_`. Did I change architecture? Update `ssot_`."

### 📋 Detection Pattern:
```javascript
const shouldDocument = 
  /(document|ssot|memory|metadata|changelog|bump version)/i.test(userMessage) ||
  (taskCompleted && (newFeature || refactor || architectureChange));
```

---

## Core Capabilities

1. **Create Memories**: Generate new SSOT documents with correct metadata and structure.
2. **Update Memories**: Bump versions and maintain changelogs.
3. **Validate Compliance**: Ensure files follow naming conventions and metadata schemas.
4. **Navigate**: List and find memories by category.

## Workflows

**🚨 MANDATORY FIRST STEP FOR ALL WORKFLOWS:**

Before using ANY Serena tools (`write_memory`, `read_memory`, `search_for_pattern`, etc.) or symbolic operations, you MUST activate the project:

```javascript
mcp__plugin_serena_serena__activate_project({ project: "/path/to/current/working/directory" })
```

**Why this is critical**: Without project activation, Serena cannot access memories or locate files, causing operations to fail or loop indefinitely. This step establishes the working context.

---

### 1. Creating a New Memory

To create a new documentation file:

1. **Choose a Category**:
   - `ssot`: For system components (Single Source of Truth)
   - `pattern`: For reusable design patterns
   - `plan`: For implementation plans
   - `reference`: For cheat sheets and API docs

2. **Generate Template**:
   Use the `generate_template.py` script to create a file with the correct boilerplate.

   ```bash
   # Example: Create a new SSOT
   python3 scripts/generate_template.py ssot ssot_analytics_newcomponent_2026-01-20.md \
     title="New Component SSOT" domain="analytics"
   ```

3. **Fill Content**:
   Edit the generated markdown file to add your content.

### 2. Updating an Existing Memory

When modifying an existing memory:

1. **Edit Content**: Make your changes to the markdown body.
2. **Bump Version**: Use the `bump_version.sh` helper to determine the next version.

   ```bash
   # Check current version
   grep "version:" my_file.md

   # Calculate next version
   bash scripts/bump_version.sh 1.0.0 patch
   ```

3. **Update Frontmatter**:
   - Update `version` field
   - Update `updated` timestamp
   - Add entry to `changelog`

### 3. Validating Compliance

Ensure your files meet the standards:

```bash
# Validate a specific file
python3 scripts/validate_metadata.py my_file.md
```

### 4. Listing Memories

Find memories by category:

```bash
# List all SSOTs
bash scripts/list_by_category.sh ssot

# List all Patterns
bash scripts/list_by_category.sh pattern
```

### 5. Document a Completed Change (NEW)

**When**: After completing and verifying a feature, bugfix, or refactor

**Interactive Mode (Recommended)**:

1. **Use the orchestrator**:
   ```bash
   python3 scripts/orchestrator.py . feature "Description of change" \
     --scope=component-name \
     --category=domain
   ```

2. **Review suggestions**:
   - Orchestrator will update CHANGELOG.md automatically
   - Provides suggestions for README.md updates
   - Provides suggestions for CLAUDE.md updates
   - Creates/updates SSOT memory if relevant

3. **Apply manual updates**:
   - Review and apply README suggestions
   - Review and apply CLAUDE.md suggestions
   - Validate all changes

**Manual Mode**:

1. **Update CHANGELOG.md**:
   ```bash
   python3 scripts/changelog/add_entry.py CHANGELOG.md Added "New feature description"
   ```

2. **Update SSOT** (if architectural change):
   ```bash
   python3 scripts/generate_template.py ssot .serena/memories/ssot_domain_component_2026-02-01.md \
     title="Component SSOT" \
     scope="domain-component" \
     domain="domain"
   # Edit the generated file
   ```

3. **Update README.md** (if user-facing change):
   - Add to ## Features section
   - Update ## Usage examples
   - Update ## Installation if needed

4. **Update CLAUDE.md** (if architecture/setup changed):
   - Update ## Architecture section
   - Update ## Development Environment
   - Update ## Key Files & Directories

5. **Validate all documentation**:
   ```bash
   python3 scripts/orchestrator.py . validate
   ```

### 6. Release a New Version (NEW)

**Workflow**:

1. **Ensure all changes documented**:
   ```bash
   # Check [Unreleased] section has content
   grep -A 20 "## \[Unreleased\]" CHANGELOG.md
   ```

2. **Bump CHANGELOG version**:
   ```bash
   python3 scripts/changelog/bump_release.py CHANGELOG.md 1.2.0
   ```

3. **Update version in project files**:
   - `pyproject.toml` / `package.json`
   - `__init__.py` / version files
   - SSOT memory versions (if applicable)

4. **Validate**:
   ```bash
   python3 scripts/changelog/validate_changelog.py CHANGELOG.md
   ```

5. **Commit and tag**:
   ```bash
   git add CHANGELOG.md [other version files]
   git commit -m "chore: release v1.2.0"
   git tag -a v1.2.0 -m "Release 1.2.0"
   git push && git push --tags
   ```

## Change Type Classification

Use orchestrator with these change types:

- **feature**: New functionality
- **bugfix**: Bug corrections
- **refactor**: Code restructuring (no behavior change)
- **breaking**: Breaking API changes
- **docs**: Documentation-only changes
- **chore**: Maintenance tasks

Maps to CHANGELOG categories:
- feature → Added
- bugfix → Fixed
- refactor → Changed
- breaking → Changed (with **BREAKING** prefix)
- docs → Changed
- chore → Changed

## Naming Conventions

Files must follow: `[category]_[domain]_[subdomain]_[date].md`

- **ssot**: `ssot_analytics_volatility_2026-01-14.md`
- **pattern**: `pattern_refactoring_security_2025-12.md`
- **plan**: `plan_implementation_feature.md`

See `references/taxonomy.md` for full details.

## Additional Resources

### Reference Files
- **`references/taxonomy.md`**: Detailed naming conventions and domain hierarchy.
- **`references/metadata-schema.md`**: Required YAML frontmatter fields.
- **`references/versioning-rules.md`**: Semantic versioning guidelines.

### Examples
- **`examples/example_ssot_analytics.md`**: Complete SSOT example.
- **`examples/example_pattern.md`**: Design pattern example.
- **`examples/example_reference.md`**: Reference doc example.

### Scripts
- **`scripts/generate_template.py`**: Template generator.
- **`scripts/validate_metadata.py`**: Metadata validator.
- **`scripts/bump_version.sh`**: Version bumping utility.
- **`scripts/list_by_category.sh`**: Category listing utility.

## ⚠️ Critical Constraints

1. **NEVER skip project activation** - Call `mcp__plugin_serena_serena__activate_project()` before ANY Serena operation
2. **Use the current working directory** - Pass the actual project path, not a placeholder
3. **Activate once per session** - After activation, all subsequent memory/file operations will work correctly
4. **Check activation status** - If memory operations fail or files aren't found, you likely forgot to activate