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

## `ccs-delegation` Skill

### Current State (v5.0.0)
- ✅ Simplified from 486 to 151 lines
- ✅ Keyword-based profile selection
- ✅ AskUserQuestion menus preserved
- ✅ Bilingual IT+EN support

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
- `~/.claude/docs/plans/skill-roadmap.md` (this file)
- Or discuss in `.serena/memories/skills-evolution.md`

---

## References

- [Programmatic Tool Calling docs](../Programmatic tool calling.md)
- [Skills Authoring Guide](../skills-authoring-guide-anthropics.md)
- [Implementation Plan](file:///home/dawid/.gemini/antigravity/brain/6ddd02e0-1586-49b6-8b9f-f570dd8d0e43/implementation_plan.md)
- [Dev Changelog](file:///home/dawid/.claude/dev-changelog.md)
