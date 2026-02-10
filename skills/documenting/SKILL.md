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
- **Guideline**: "Is this a new component? Update `_ssot`. Is this a new pattern? Create `_pattern`. Did I change architecture? Update `_ssot`."

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
   python3 scripts/generate_template.py ssot analytics_newcomponent_ssot.md \
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
python3 scripts/validate_metadata.py my_file_ssot.md
```
