# Skills Roadmap

Planned improvements and feature additions for Claude Code skills.



## Completed in v2.1.9 (2026-03-15)

- ✅ Unified `quality-gates` project skill (replaced separate py/ts-quality-gate)
- ✅ Added `main-guard-post-push.mjs` hook for post-push workflow reminders
- ✅ GitNexus impact analysis reminder hook for UserPromptSubmit
- ✅ Documentation audit and updates (README.md, testing.md)
- ✅ Removed obsolete `vault-pattern-implementation.md`





## Serena MCP Tool Compaction — `pi-serena-compact`

### Status: ✅ Completed (2026-03-22)

Created a Pi extension that compacts verbose output from Serena/GitNexus MCP tools, reducing CLI bloat while preserving essential information.

**Problem:** Serena MCP tools produce detailed output that spans dozens of lines. Unlike native tool renderers, MCP tool output appeared in full.

**Solution:** `pi-serena-compact` intercepts `tool_result` events for Serena/GitNexus tools and truncates output:
- Default: 6 lines max, 180 chars per line
- Preserved tools (`read_file`, `execute_shell_command`): 12 lines max
- Respects expanded view toggle (press `e` in TUI)

**Location:** `packages/pi-extensions/extensions/pi-serena-compact/`

**Documentation:** [pi-extensions.md](docs/pi-extensions.md#pi-serena-compact)

**Survives reinstalls:** Synced from `packages/pi-extensions/extensions/` → `~/.pi/agent/extensions/` during `xtrm install`.


## Pi UI Ownership

### Status: ✅ Completed (2026-07-10)

`xtrm-ui` now owns XTRM themes, header, editor density, and native/external tool
presentation. `custom-footer` is the sole footer owner. The extension no longer
contains footer toggles, duplicate external chrome modes, or result-compaction
settings.



## `install-service-skills` — Include `AGENTS.md` in Installation

### Current State

`jaggers-config install-service-skills` copies the Trinity skills and wires hooks into a target project's `.claude/` directory, but does not copy any agent context documentation to the project root.

### Planned Enhancement

Include `AGENTS.md` (or a project-scoped variant) as part of the `install-service-skills` installation flow so every project that uses jaggers-agent-tools automatically gets:

- GitNexus MCP reference (already in current `AGENTS.md`)
- bd (beads) issue tracking reference
- Any future agent tooling context

**Implementation:**
- Copy repo `AGENTS.md` to the target project root during `installServiceSkills()`
- If `AGENTS.md` already exists in the target, merge (append new sections not already present) rather than overwrite
- Add the file to the manifest so it's tracked for future sync/drift detection

**Priority:** 🟡 Medium — low effort, high value for new project onboarding

**Timeline:** Next minor release



## `prompt-improving` Skill

### Current State (v5.1.0)

- ✅ Simplified from 118 to 64 lines
- ✅ Context detection (3 categories)
- ✅ AskUserQuestion for ambiguous prompts
- ✅ XML structure from reference files
- ✅ Renamed from `p` following naming convention

### Future Enhancements

#### Phase 1: Programmatic Tool Calling Integration (v6.0.0)

**Goal:** Enable batch prompt improvement via code execution for multi-prompt workflows.

**Use Case:**

```python
# User: "Improve these 10 prompts for me"
prompts = [
    "analyze logs",
    "implement oauth",
    "fix bug in payment",
    ...
]

improved = []
for prompt in prompts:
    result = await prompt_improving(prompt)
    improved.append(result)

# Return only improved versions, not intermediate analysis
```

**Implementation:**

- Add `allowed_callers: ["code_execution_20250825"]` to skill tool definition
- Update skill to work as async Python function
- Enable batch processing (10-100 prompts → single aggregated output)
- Token savings: N prompts × M tokens → 1x aggregated result

**Breaking Changes:**

- Requires beta header: `advanced-tool-use-2025-11-20`
- API-only feature (not available in Claude Desktop)

**Dependencies:**

- Anthropic Programmatic Tool Calling (currently beta)
- Code execution tool enabled

**Timeline:** Q2 2026 (when PTC exits beta)



#### Phase 2: Quality Scoring Restoration (v6.1.0)

**Goal:** Re-introduce lightweight quality metrics without token overhead.

**Approach:**

- Simple 0-5 score (not 0-100 like v4.2.0)
- Inline heuristics (no separate reference file)
- Report score ONLY if requested explicitly

**Criteria:**

1. Structure (XML tags present)
2. Examples (multishot included)
3. Clarity (task well-defined)
4. Thinking space (reasoning included)
5. Constraints (limitations specified)

**Usage:**

```
/prompt-improving "analyze logs" --score
→ Returns improved prompt + quality assessment
```

**Timeline:** Q3 2026



#### Phase 3: Template Library (v7.0.0)

**Goal:** Pre-built templates for common tasks.

**Templates:**

- `analysis` - Log/data analysis tasks
- `coding` - Code generation/refactoring
- `debugging` - Bug investigation
- `architecture` - Design decisions
- `documentation` - Docs writing

**Usage:**

```
/prompt-improving "fix auth bug" --template debugging
→ Applies debugging-specific XML structure
```

**Implementation:**

- New reference file: `templates.md` (5-10KB)
- Template selection via keyword detection
- Override via `--template` flag

**Timeline:** Q4 2026



#### Phase 4: Chain-of-Thought Auto-Detection (v7.1.0)

**Goal:** Automatically add `<thinking>` tags for complex reasoning tasks.

**Detection:**

- Analyze prompt complexity (ambiguity, dependencies, constraints)
- Insert chain-of-thought structure if score > threshold
- Preserve user's original structure if already present

**Example:**

```
Before: "Find the root cause of the performance issue"
After:
<investigation>
  <thinking>
    Let me analyze this systematically:
    1. Identify symptoms
    2. Check system metrics
    3. Trace execution flow
    4. Isolate bottleneck
  </thinking>
  <description>Find the root cause of the performance issue</description>
  <approach>Systematic performance analysis</approach>
</investigation>
```

**Timeline:** Q1 2027



#### Phase 5: Contextual Prefill Suggestions (v8.0.0)

**Goal:** Suggest relevant prefill patterns based on task type.

**Mechanism:**

- Detect task category (analysis, coding, debugging, etc.)
- Show AskUserQuestion menu with recommended prefills
- User can accept, customize, or skip

**Example:**

```typescript
AskUserQuestion({
  questions: [
    {
      question:
        "This looks like a debugging task. Would you like to use a debugging-optimized prefill?",
      multiSelect: false,
      options: [
        {
          label: "Yes, use debugging prefill",
          description: "Adds systematic investigation structure",
        },
        {
          label: "No, standard improvement",
          description: "Apply basic XML structure only",
        },
      ],
    },
  ],
});
```

**Timeline:** Q2 2027



## `documenting` Skill

Add more metadata for clear identification of involved scripts/files in the documentations, so that a script referenced by the skill can find them more easily.

## `delegating` Skill

### Current State (v6.0.0)

- ✅ Unified CCS + unitAI backend support
- ✅ Configuration-driven patterns (`config.yaml`)
- ✅ Auto-focus detection
- ✅ Replaces legacy `/ccs-delegation`

### Future Enhancements

#### Phase 1: Success Rate Tracking (v5.2.0)

**Goal:** Track delegation success/failure rates per profile.

**Implementation:**

- Log delegation outcomes to `~/.ccs/delegation-log.json`
- Show success rate in AskUserQuestion menu
- Suggest profile switch if success rate < 70%

**Timeline:** Q2 2026



#### Phase 2: Custom Profile Management (v6.0.0)

**Goal:** User-defined delegation profiles.

**Implementation:**

- Config file: `~/.ccs/profiles.json`
- Define custom profiles with specific models/parameters
- Reference in skill via `--profile custom-name`

**Timeline:** Q3 2026



## Cross-Skill Features

### Skill Discovery Hook (v5.2.0)

**Goal:** Proactive skill suggestions beyond `/prompt-improving` and `/ccs`.

**Implementation:**

- Extend `skill-suggestion.sh` to detect other skills
- Pattern matching for custom skills in `~/.claude/skills/`
- Dynamic suggestion based on user prompt content

**Timeline:** Q2 2026



### Skill Composition (v6.0.0)

**Goal:** Chain multiple skills together.

**Example:**

```
/prompt-improving "fix auth" | /ccs --profile glm
→ Improve prompt, then delegate to CCS
```

**Implementation:**

- Pipe operator support in skill invocation
- Output of skill 1 → input of skill 2
- Requires skill output standardization

**Timeline:** Q4 2026



## Deprecation Timeline

### v4.2.0 Features (Removed in v5.0.0)

- ❌ Quality metrics (11KB) - **REMOVED**
- ❌ Context detection rules (10KB) - **REMOVED**
- ❌ Complexity scoring (14KB) - **REMOVED**
- ❌ Smart context gathering (16KB) - **REMOVED**
- ❌ Fallback chain (15KB) - **REMOVED**
- ❌ Parallel delegation (17KB) - **REMOVED**
- ❌ Delegation history (15KB) - **REMOVED**

**Reasoning:** 90% token overhead for <5% usage. Core functionality preserved.



## MCP Integration

### Long-Term Vision (v9.0.0+)

**Goal:** Expose skills as MCP tools for cross-client compatibility.

**Challenges:**

- MCP tools currently can't use Programmatic Tool Calling
- Skills rely on Claude Code-specific features (AskUserQuestion)
- Requires MCP protocol extensions

**Wait for:**

- MCP + PTC compatibility
- MCP standardization of interactive dialogs

**Timeline:** 2028+



## Version History

| Version | Release    | Changes                                |
| ------- | ---------- | -------------------------------------- |
| 5.1.0   | 2026-01-30 | Renamed `p` → `prompt-improving`       |
| 5.0.0   | 2026-01-30 | Major refactoring, 90% token reduction |
| 4.2.0   | Pre-2026   | Feature-rich baseline (155KB)          |



## Contributing

Suggest roadmap items by creating issues in:

- `ROADMAP.md` (this file)
- Or discuss in `.serena/memories/skills-evolution.md`



## CLI Architecture Improvements

**Status:** Major refactor completed in v2.0.0 (2026-03-12)

### Current Architecture (v2.1.9)

**Components:**
- CLI (TypeScript, tsup bundle)
- Skills (SKILL.md with YAML frontmatter)
- Hooks (event-driven Python/JS scripts)
- Documentation (SSOT pattern in `.serena/memories/` and root .md files)
- Project Skills (modular, plug-and-play packages)

**Strengths:**
- Zero-cloning install via `npx github:Jaggerxtrm/xtrm-tools`
- Claude Code exclusive focus (no fragile cross-agent translation)
- Transactional sync with rollback protection
- Manifest tracking for drift detection
- Token efficiency (75-80% via serena-lsp)
- Professional UX (spinners, themed output, clean errors)

**Architecture Decision (v2.0.0):**
Removed multi-agent hook translation for Gemini/Qwen due to:
- Fragile, undocumented hook ecosystems
- Technical debt from maintaining translations
- Focus on robust, well-tested Claude Code support



### Phase 1: Universal Configuration Hub (COMPLETED v1.5.0)

**Goal:** Centralize MCP and Hooks into a Single Source of Truth with multi-tool compilation.

**Implementation:**
- ✅ **Decoupled Canonical Sources**: `config/mcp_servers.json` and `config/hooks.json`.
- ✅ **Professional Adapter**: `ConfigAdapter` with cross-platform format transformation.
- ✅ **Strict Pruning**: `executeSync` respects `mode: prune` for environment hygiene.
- ✅ **Dynamic Injection**: Unified handling of `settings.json` for Claude, Gemini, and Qwen.
- ✅ **Manifest Tracking**: Initial implementation of `.jaggers-sync-manifest.json`.



### Phase 2: Advanced Env Var & Path Resolution (COMPLETED v1.5.1)

**Goal:** Professional handling of environment variable syntax and path expanding.

**Implementation:**
- ✅ **EnvVarTransformer**: Recursive transformation between `${VAR}`, `${env:VAR}`, and `{env:VAR}`.
- ✅ **Safe Path Expansion**: Intelligent resolution of `~/` and `${HOME}` across all config fields.



### Phase 3: Transactional Sync & Rollback (HIGH PRIORITY)

**Problem:** Mid-sync failures leave the agent environment in an inconsistent state.

**Solution:** Session Snapshot pattern with automatic rollback.

**Timeline:** Q2 2026



### Phase 4: Full Multi-Tool Support (Cursor & VS Code) (MEDIUM PRIORITY)

**Goal:** Extend the Hub to support Cursor rules and standard VS Code settings.

**Implementation:**
- [ ] Support for `.cursorrules` generation.
- [ ] Automatic `mcp.json` deployment for Cursor.
- [ ] VS Code `settings.json` synchronization.

**Timeline:** Q3 2026



### Phase 5: Manifest-Based Versioning (HIGH PRIORITY)

**Problem:** Silent versioning conflicts during backports, no drift detection.

**Solution:** `sync-manifest.json` with sha256 hashes and version tracking.

**Implementation:**

```json
// ~/.claude/sync-manifest.json or ~/.gemini/sync-manifest.json
{
  "version": "1.0.0",
  "lastSync": "2026-02-03T10:30:00Z",
  "components": {
    "skills/delegating/SKILL.md": {
      "sha256": "abc123...",
      "version": "6.0.0",
      "modified": false
    },
    "hooks/skill-suggestion.py": {
      "sha256": "def456...",
      "version": "1.2.0",
      "modified": true
    }
  }
}
```

**Workflow:**

1. Before sync: Compare local manifest hashes with repo versions
2. If drift detected: Trigger interactive 3-way merge or conflict prompt
3. After sync: Update manifest with new hashes and timestamps

**Files to Modify:**

- `cli/lib/manifest.js` (NEW) - Manifest management
- `cli/lib/sync.js` - Add manifest comparison before sync
- `cli/lib/merge.js` (NEW) - 3-way merge for conflicts

**Success Criteria:**

- Sync detects local modifications before overwriting
- User prompted to resolve conflicts interactively
- Backports can't silently regress to older versions

**Timeline:** Q2 2026



### Phase 3: Namespace Prefixes & Collision Detection (MEDIUM PRIORITY)

**Problem:** Skill/command name collisions with MCP servers or other plugins.

**Solution:** Provider prefix strategy with collision registry.

**Implementation:**

```javascript
// cli/lib/transform-gemini.js
function transformSkillToCommand(skill) {
  const commandName = `j:${skill.name}`; // Prefix with 'j:'

  // Check for collisions
  const registry = loadRegistry();
  if (registry[commandName]) {
    console.warn(`Collision detected: ${commandName}`);
    // Offer interactive resolution
  }

  registry[commandName] = {
    source: "jaggers-agent-tools",
    version: skill.version,
  };
  saveRegistry(registry);

  return generateTomlCommand(commandName, skill);
}
```

**Files to Modify:**

- `cli/lib/transform-gemini.js` - Add prefix logic
- `cli/lib/registry.js` (NEW) - Collision detection
- `~/.gemini/command-registry.json` (NEW) - Command tracking

**Success Criteria:**

- Commands prefixed with `j:` (e.g., `/j:delegate`)
- Collision warnings before overwriting existing commands
- Registry tracks command ownership and versions

**Timeline:** Q3 2026



### Phase 4: Observability & Validation (MEDIUM PRIORITY)

**Problem:** Difficult to debug sync issues, no visibility into what changed.

**Solution:** Comprehensive logging and validation.

**Implementation:**

1. **Sync Log:**

```bash
# ~/.claude/sync.log or ~/.gemini/sync.log
[2026-02-03 10:30:15] SYNC START (session-abc123)
[2026-02-03 10:30:16] MODIFIED skills/delegating/SKILL.md (v6.0.0)
[2026-02-03 10:30:17] ADDED hooks/pip-venv-guard.py (v1.0.0)
[2026-02-03 10:30:18] VALIDATION PASSED
[2026-02-03 10:30:19] SYNC COMPLETE
```

2. **Post-Sync Validation:**

```javascript
async function validateEnvironment() {
  // Check skill files are valid markdown
  // Check hooks are executable
  // Check settings.json is valid JSON
  // Run smoke test (e.g., `claude --version`)
}
```

3. **Strict Mode:**

```bash
npx ./cli --strict
# Fails sync if ANY drifted files found without user approval
```

**Files to Modify:**

- `cli/lib/logger.js` (NEW) - Structured logging
- `cli/lib/validate.js` - Environment validation
- `cli/index.js` - Add `--strict` flag

**Success Criteria:**

- Every sync creates timestamped log entry
- Post-sync validation detects corrupted files
- `--strict` mode prevents accidental overwrites

**Timeline:** Q3 2026



### Phase 5: Transformation Logic Refactoring (LOW PRIORITY)

**Problem:** Regex-based path rewriting is hard to debug, mixed with sync logic.

**Solution:** Dedicated `Resolver` class for transformation logic.

**Implementation:**

```javascript
// cli/lib/resolver.js
class ConfigResolver {
  constructor(targetEnv) {
    this.targetEnv = targetEnv; // 'claude' or 'gemini'
    this.pathMappings = loadPathMappings();
  }

  resolveHookPath(repoPath) {
    return this.pathMappings[this.targetEnv].hooks(repoPath);
  }

  resolveEventName(claudeEvent) {
    const eventMap = {
      UserPromptSubmit: "BeforeAgent",
      PreToolUse: "BeforeTool",
    };
    return eventMap[claudeEvent] || claudeEvent;
  }
}
```

**Files to Modify:**

- `cli/lib/resolver.js` (NEW) - Centralized transformation logic
- `cli/lib/transform-gemini.js` - Use Resolver class
- `cli/lib/sync.js` - Decouple from transformation details

**Success Criteria:**

- Transformation logic isolated from sync orchestration
- Easier to debug path resolution issues
- Simpler to add new agent types in future

**Timeline:** Q4 2026



### Acceptable Trade-offs

**Documented Decisions:**

1. **Mapping Maintenance Burden:**
   - **Trade-off:** Manually maintain `transform-gemini.js` tool mappings (e.g., `Edit` → `replace`)
   - **Rationale:** Necessary for cross-agent fidelity; over-abstraction would create leaky abstractions
   - **Accept:** Manual maintenance required

2. **Testing Complexity:**
   - **Trade-off:** Validating every Claude/Gemini version combination is unfeasible
   - **Rationale:** Runtime validation via post-sync smoke tests is more practical
   - **Accept:** Runtime validation replaces exhaustive pre-deployment testing

3. **Transformation Overhead:**
   - **Trade-off:** Some performance cost for dynamic config transformation
   - **Rationale:** Enables single-repo, multi-agent support without code duplication
   - **Accept:** 75-80% token efficiency gains outweigh transformation cost



### Implementation Priority

| Priority  | Phase                   | Impact              | Effort | Timeline |
| --------- | ----------------------- | ------------------- | ------ | -------- |
| 🔴 HIGH   | Transactional Sync      | Prevents data loss  | Medium | Q2 2026  |
| 🔴 HIGH   | Manifest Versioning     | Prevents conflicts  | Medium | Q2 2026  |
| 🟡 MEDIUM | Namespace Prefixes      | Prevents collisions | Low    | Q3 2026  |
| 🟡 MEDIUM | Observability           | Improves debugging  | Low    | Q3 2026  |
| 🟢 LOW    | Transformation Refactor | Code quality        | Medium | Q4 2026  |



### Multi-Agent Collaboration Insights

**Methodology:** 3-turn handshake protocol (Gemini → Qwen → Gemini)

**Key Finding:** Neither agent independently identified all critical issues:

- **Gemini** excelled at pattern recognition and design intent analysis
- **Qwen** excelled at edge case identification and resilience concerns
- **Synthesis** produced concrete, prioritized improvements

**Recommendation:** Use `/orchestrating-agents` skill for complex architectural reviews.



## References

- [Programmatic Tool Calling docs](../Programmatic tool calling.md)
- [Skills Authoring Guide](../skills-authoring-guide-anthropics.md)
- [Implementation Plan](file:///home/dawid/.gemini/antigravity/brain/6ddd02e0-1586-49b6-8b9f-f570dd8d0e43/implementation_plan.md)
- [Dev Changelog](file:///home/dawid/.claude/dev-changelog.md)
- [Orchestrating Agents Skill](/home/dawid/.claude/skills/orchestrating-agents/SKILL.md)
