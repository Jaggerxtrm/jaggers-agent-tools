---
name: ccs-delegation
description: >-
  Delegate deterministic tasks to cost-optimized models via CCS CLI.
  Agent MUST proactively suggest this skill when detecting simple, well-scoped
  tasks (tests, refactors, typos, docs). Uses interactive AskUserQuestion menu
  for delegation choice and profile selection. Auto-selects optimal profile
  (glm/gemini/qwen/custom) via keyword detection. Excludes complex
  architecture, security-critical code, performance optimization, breaking changes.
version: 5.0.0
---

# CCS Delegation

Delegate deterministic tasks to cost-optimized models via CCS CLI.

## 🚨 AGENT GUIDANCE: When to Suggest This Skill

**MANDATORY: Suggest CCS delegation BEFORE starting these tasks:**

### ✅ Always Suggest For:
- **Typo fixes**: "fix typo in README", "correct spelling"
- **Add tests**: "add unit tests", "write tests for X"
- **Simple refactors**: "refactor parseConfig", "extract helper function"
- **Documentation**: "add docstrings", "update API docs"
- **Type fixes**: "add type hints", "fix TypeScript types"
- **Simple updates**: "update dependencies", "bump version"
- **Code formatting**: "format code", "fix linting"

### ❌ Never Suggest For:
- **Architecture decisions**: "implement OAuth", "design database schema"
- **Security-critical**: "add authentication", "fix XSS vulnerability"
- **Complex debugging**: "fix the bug" (unknown cause), "investigate performance"
- **Performance optimization**: "make this faster", "optimize queries"
- **Breaking changes**: "migrate to new API", "refactor entire module"
- **Design discussions**: any task requiring decisions/clarifications

### 📋 Detection Pattern:
```typescript
const shouldSuggestCCS =
  /(typo|test|refactor|update|fix spelling|add docs|format|lint)/i.test(userMessage) &&
  !/(implement|design|debug|investigate|optimize|migrate|architecture)/i.test(userMessage);
```

### 🎯 How to Suggest:
When pattern matches, IMMEDIATELY use AskUserQuestion (see Interactive Menu section below).

---

## Interactive Menu (AskUserQuestion)

When suggesting CCS delegation, ALWAYS use this interactive flow:

### Step 1: Delegation Choice

```typescript
AskUserQuestion({
  questions: [{
    question: "This looks like a good candidate for CCS delegation (cost-optimized execution). How would you like to proceed?",
    header: "Execution",
    multiSelect: false,
    options: [
      {
        label: "Delegate to CCS (Recommended)",
        description: "Execute via cost-optimized model. Auto-selects best profile based on task keywords. Saves main session tokens."
      },
      {
        label: "Work in main session",
        description: "Execute in current Claude session. Better for tasks requiring discussion, decisions, or complex context."
      }
    ]
  }]
});
```

**If user selects "Delegate to CCS"** → Continue to Step 2
**If user selects "Work in main session"** → Execute task normally (don't use CCS)

### Step 2: Profile Selection (Optional)

```typescript
AskUserQuestion({
  questions: [{
    question: "Which profile should handle this task?",
    header: "Profile",
    multiSelect: false,
    options: [
      {
        label: "Auto-select (Recommended)",
        description: "Analyzes task keywords and chooses optimal profile: glm (cost-optimized), gemini (reasoning/long-context), or qwen."
      },
      {
        label: "Force GLM",
        description: "Cost-optimized model. Best for: tests, refactors, typos, simple tasks."
      },
      {
        label: "Force Gemini",
        description: "Reasoning/long-context model. Best for: architecture analysis, complex thinking, large codebases."
      },
      {
        label: "Force Qwen",
        description: "Alternative model. Good for: code quality analysis, pattern detection."
      }
    ]
  }]
});
```

**Profile handling:**
- "Auto-select" → Use keyword-based selection (see Profile Selection Logic)
- "Force X" → Use specified profile, skip analysis

---

## Profile Selection Logic (Keyword-Based)

**Simple keyword detection** (no complex scoring, fast execution):

```javascript
function selectProfile(task) {
  const taskLower = task.toLowerCase();
  
  // Cost-optimized for simple tasks
  if (/typo|test|doc|fix spelling|format|lint|add type/.test(taskLower)) {
    return { profile: 'glm', reason: 'Simple deterministic task' };
  }
  
  // Reasoning for analysis/thinking tasks
  if (/think|analyze|reason|debug|investigate|evaluate/.test(taskLower)) {
    return { profile: 'gemini', reason: 'Requires reasoning' };
  }
  
  // Long-context for architecture/codebase tasks
  if (/architecture|entire|all files|codebase|analyze all/.test(taskLower)) {
    return { profile: 'gemini', reason: 'Requires long context' };
  }
  
  // Default: cost-optimized
  return { profile: 'glm', reason: 'Default cost-optimized' };
}
```

**Override:** If task contains `--{profile}` flag, extract and use that profile directly.

---

## Execution Flow

### For Direct Invocation (`/ccs [task]` or `use ccs [task]`)

1. **Parse override flag** (if present: `--glm`, `--gemini`, etc.)
2. **Auto-select profile** using keyword-based logic above
3. **Execute delegation**: `ccs {profile} -p "{task}"`
4. **Report results**: Profile, Cost, Duration, Exit code

### For Continuation (`/ccs:continue [follow-up]`)

1. **Detect last profile** from `~/.ccs/delegation-sessions.json`
2. **Execute continuation**: `ccs {profile}:continue -p "{follow-up}"`
3. **Report results**: Session #, Incremental cost, Total cost

---

## Decision Framework

**Delegate when:**
- Simple refactoring, tests, typos, documentation
- Deterministic, well-defined scope
- No discussion/decisions needed

**Keep in main when:**
- Architecture/design decisions
- Security-critical code
- Complex debugging requiring investigation
- Performance optimization
- Breaking changes/migrations

---

## Example Delegations

**Good candidates:**
- `/ccs add unit tests for UserService using Jest`
  → Auto-selects: glm (simple task)
- `/ccs analyze entire architecture in src/`
  → Auto-selects: gemini (long-context)
- `/ccs think about the best database schema design`
  → Auto-selects: gemini (reasoning)
- `/ccs --qwen review code quality in api/`
  → Forces: qwen (override)

**Bad candidates (keep in main):**
- "implement OAuth" (too complex)
- "improve performance" (requires profiling)
- "fix the bug" (needs investigation)

---

## Troubleshooting

See [references/troubleshooting.md](references/troubleshooting.md) for common issues and solutions.

---

## Notes

- **Version 5.0.0**: Simplified from v4.2.0, removed complexity scoring, smart context, fallback chain, parallel delegation, history tracking
- **Token optimized**: Reduced from 103KB to ~8KB references (-92%)
- **Functionality**: Core workflows intact, advanced features removed
- **Performance**: Faster skill loading (\<1s vs 5-8s previously)
