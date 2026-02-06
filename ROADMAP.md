# Skills Roadmap

Planned improvements and feature additions for Claude Code skills.

---

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

---

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

---

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

---

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

---

#### Phase 5: Contextual Prefill Suggestions (v8.0.0)

**Goal:** Suggest relevant prefill patterns based on task type.

**Mechanism:**
- Detect task category (analysis, coding, debugging, etc.)
- Show AskUserQuestion menu with recommended prefills
- User can accept, customize, or skip

**Example:**
```typescript
AskUserQuestion({
  questions: [{
    question: "This looks like a debugging task. Would you like to use a debugging-optimized prefill?",
    multiSelect: false,
    options: [
      { label: "Yes, use debugging prefill", description: "Adds systematic investigation structure" },
      { label: "No, standard improvement", description: "Apply basic XML structure only" }
    ]
  }]
})
```

**Timeline:** Q2 2027

---

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

---

#### Phase 2: Custom Profile Management (v6.0.0)

**Goal:** User-defined delegation profiles.

**Implementation:**
- Config file: `~/.ccs/profiles.json`
- Define custom profiles with specific models/parameters
- Reference in skill via `--profile custom-name`

**Timeline:** Q3 2026

---

## Cross-Skill Features

### Skill Discovery Hook (v5.2.0)

**Goal:** Proactive skill suggestions beyond `/prompt-improving` and `/ccs`.

**Implementation:**
- Extend `skill-suggestion.sh` to detect other skills
- Pattern matching for custom skills in `~/.claude/skills/`
- Dynamic suggestion based on user prompt content

**Timeline:** Q2 2026

---

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

---

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

---

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

---

## Version History

| Version | Release    | Changes                                |
| ------- | ---------- | -------------------------------------- |
| 5.1.0   | 2026-01-30 | Renamed `p` → `prompt-improving`       |
| 5.0.0   | 2026-01-30 | Major refactoring, 90% token reduction |
| 4.2.0   | Pre-2026   | Feature-rich baseline (155KB)          |

---

## Contributing

Suggest roadmap items by creating issues in:
- `ROADMAP.md` (this file)
- Or discuss in `.serena/memories/skills-evolution.md`

---

## CLI Architecture Improvements

**Source:** Multi-agent orchestration session (Gemini ↔ Qwen collaboration, 2026-02-03)

### Current Architecture Assessment

**Components Identified:**
- CLI (Node.js sync orchestrator)
- Skills (SKILL.md → .toml transformation)
- Hooks (event-driven Python/JS)
- Documentation (SSOT pattern in `.serena/memories/`)

**Strengths:**
- Zero-cloning install via `npx github:Jaggerxtrm/jaggers-agent-tools`
- Vault Protection (atomic merge with PROTECTED_KEYS)
- Cross-agent compatibility (Claude ↔ Gemini)
- Token efficiency (75-80% via serena-lsp)

**Critical Weaknesses Identified:**
1. **Atomic Inconsistency**: Linear sync iteration can fail mid-process, leaving environment in "Frankenstein" state
2. **Conflict Blindness**: No version manifest for detecting drift during backports
3. **Namespace Collision**: Generic skill names can collide with MCP servers or internal commands

---

### Phase 1: Transactional Sync with Rollback (HIGH PRIORITY)

**Problem:** Mid-sync failures leave the agent environment in an inconsistent state.

**Solution:** Session Snapshot pattern with automatic rollback.

**Implementation:**
```javascript
// cli/lib/sync.js
async function executeSync(items) {
  const snapshot = await createSnapshot();
  try {
    for (const item of items) {
      await syncItem(item);
    }
    await validateEnvironment(); // Post-sync smoke test
  } catch (error) {
    console.error('Sync failed, rolling back...');
    await rollback(snapshot);
    throw error;
  }
}
```

**Files to Modify:**
- `cli/lib/sync.js` - Add snapshot/rollback logic
- `cli/lib/snapshot.js` (NEW) - Snapshot management
- `cli/lib/validate.js` (NEW) - Post-sync validation

**Success Criteria:**
- Failed sync leaves environment in pre-sync state
- User can manually trigger `--rollback` to previous session
- Sync log tracks which files were modified

**Timeline:** Q2 2026

---

### Phase 2: Manifest-Based Versioning (HIGH PRIORITY)

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

---

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
    source: 'jaggers-agent-tools',
    version: skill.version
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

---

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

---

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
      'UserPromptSubmit': 'BeforeAgent',
      'PreToolUse': 'BeforeTool'
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

---

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

---

### Implementation Priority

| Priority | Phase | Impact | Effort | Timeline |
|----------|-------|--------|--------|----------|
| 🔴 HIGH | Transactional Sync | Prevents data loss | Medium | Q2 2026 |
| 🔴 HIGH | Manifest Versioning | Prevents conflicts | Medium | Q2 2026 |
| 🟡 MEDIUM | Namespace Prefixes | Prevents collisions | Low | Q3 2026 |
| 🟡 MEDIUM | Observability | Improves debugging | Low | Q3 2026 |
| 🟢 LOW | Transformation Refactor | Code quality | Medium | Q4 2026 |

---

### Multi-Agent Collaboration Insights

**Methodology:** 3-turn handshake protocol (Gemini → Qwen → Gemini)

**Key Finding:** Neither agent independently identified all critical issues:
- **Gemini** excelled at pattern recognition and design intent analysis
- **Qwen** excelled at edge case identification and resilience concerns
- **Synthesis** produced concrete, prioritized improvements

**Recommendation:** Use `/orchestrating-agents` skill for complex architectural reviews.

---

## References

- [Programmatic Tool Calling docs](../Programmatic tool calling.md)
- [Skills Authoring Guide](../skills-authoring-guide-anthropics.md)
- [Implementation Plan](file:///home/dawid/.gemini/antigravity/brain/6ddd02e0-1586-49b6-8b9f-f570dd8d0e43/implementation_plan.md)
- [Dev Changelog](file:///home/dawid/.claude/dev-changelog.md)
- [Orchestrating Agents Skill](/home/dawid/.claude/skills/orchestrating-agents/SKILL.md)
