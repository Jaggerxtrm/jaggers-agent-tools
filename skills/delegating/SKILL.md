---
name: delegating
description: >-
  Delegate tasks to cost-optimized models (CCS) or multi-agent orchestration (Gemini/Qwen).
  Use when the user asks to "delegate" a task, or for simple deterministic tasks (typos, tests),
  complex code reviews, or large-scale refactoring that can be offloaded.
gemini-command: delegate
gemini-prompt: |
  1. Analyze the task for keywords:
     - simple tasks (typo, test, doc, format) -> CCS
     - complex tasks (review, implement feature, debug) -> Orchestration (Gemini/Qwen)
  2. If ambiguous, use ask_user to confirm the execution path (Delegate vs Main Session).
  3. Execute via the optimal backend and report results including backend type and cost indicator.
version: 7.0.0
---

# Delegating Tasks

Delegate tasks to cost-optimized models (CCS) or multi-agent orchestration workflows (Gemini/Qwen).

## When to Suggest

**Task Pattern → Backend Mapping** (auto-selection logic):

| Task Pattern                  | Backend     | Cost   | Reason                         |
|-------------------------------|-------------|--------|--------------------------------|
| `typo\|test\|doc\|format`     | CCS (GLM)   | LOW    | Simple deterministic           |
| `think\|analyze\|reason`      | CCS (Gemini)| MEDIUM | Requires reasoning             |
| `review.*(code\|security)`    | Orchestration| HIGH   | Multi-agent code review        |
| `implement.*feature`          | Orchestration| HIGH   | Full development workflow      |
| `validate.*commit`            | Orchestration| MEDIUM | Security+Quality validation    |
| `debug\|bug.*unknown`         | Orchestration| HIGH   | Root cause investigation       |

**Never Suggest For:**
- Architecture decisions requiring human judgment
- Security-critical without review
- Performance optimization (needs profiling first)

---

## Interactive Menu

### Step 1: Delegation Choice
```typescript
ask_user({
  questions: [{
    question: "This task can be delegated. How would you like to proceed?",
    header: "Execution",
    multiSelect: false,
    options: [
      {
        label: "Delegate (Recommended)",
        description: "Execute via optimal backend. Saves main session tokens and uses cost-efficient models."
      },
      {
        label: "Work in main session",
        description: "Execute in current Claude session. Better for tasks requiring discussion or complex context."
      }
    ]
  }]
});
```

**If user selects "Delegate"** → Continue to Step 2
**If user selects "Work in main session"** → Execute task normally (don't delegate)

### Step 2: Backend Selection
```typescript
ask_user({
  questions: [{
    question: "Which backend should handle this task?",
    header: "Backend",
    multiSelect: false,
    options: [
      {
        label: "Auto-select (Recommended)",
        description: "Analyzes task keywords and selects optimal backend/profile automatically"
      },

      // CCS Simple
      {
        label: "GLM - Cost-optimized",
        description: "Fast model for tests, typos, formatting [LOW COST]"
      },
      {
        label: "Gemini - Reasoning",
        description: "Analysis, thinking, architecture tasks [MEDIUM COST]"
      },
      {
        label: "Qwen - Quality",
        description: "Code quality, pattern detection [MEDIUM COST]"
      },

      // Multi-Agent Orchestration
      {
        label: "Multi-Agent Orchestration",
        description: "Direct Gemini/Qwen collaboration for complex tasks (review, feature dev, debugging) [HIGH COST]"
      }
    ]
  }]
});
```

---

## Auto-Selection Logic

**Configuration-Driven:** All pattern matching is defined in [config.yaml](config.yaml), not hardcoded.

### Configuration Structure

The skill reads `config.yaml` to determine:
1. **Available backends** (CCS profiles + Orchestration workflows)
2. **Pattern mappings** (task keywords → backend selection)
3. **Priority order** (Orchestration workflows checked before CCS)
4. **Default fallback** (when no pattern matches)

---

## Orchestration Workflow Selection (Autonomous)

When `backend: 'orchestration'` is selected, **Claude autonomously** chooses the appropriate workflow and orchestrates between `gemini` and `qwen` CLI tools.

### Selection Process

1. **Load config** - Read workflow definitions from `config.yaml`
2. **Match patterns** - Determine which orchestration pattern (collaborative, handshake, troubleshoot) applies.
3. **Execute turn protocol** - Use CLI commands sequentially:
   - `gemini -p "..."`
   - `qwen "..."`
   - `gemini -r latest -p "..."` (to refine)

### Turn Protocols

| Workflow | Protocol |
| :--- | :--- |
| **handshake** | 1 turn: Agent A (Gemini) proposes -> Agent B (Qwen) validates. |
| **collaborative** | 3 turns: Gemini designs -> Qwen critiques -> Gemini refines. |
| **troubleshoot** | 4 turns: Gemini hypothesis -> Qwen verification -> Gemini root cause -> Final synthesis. |

---

## Execution Flow

### For Direct Invocation (`/delegation [task]` or `/delegate [task]`)

1. **Parse override flag** (if present: `--glm`, `--gemini`, `--orchestrate`, etc.)
2. **Auto-select backend** using keyword-based logic.
3. **Route to appropriate backend:**
   - **CCS**: `ccs {profile} -p "{task}"`
   - **Orchestration**:
     - Use `gemini -p` or `qwen` based on the selected pattern.
     - Capture output and pipe to the next agent as needed.
4. **Report results**: Backend, Workflow (if Orchestration), Cost indicator, Duration.

---

## Examples

### Auto-Selection Examples

**CCS Simple:**
- `/delegate add unit tests for UserService` → CCS (GLM)
- `/delegate think about the best database schema` → CCS (Gemini)

**Orchestration Workflows:**
- `/delegate review this code for security issues` → Orchestration (parallel-review)
- `/delegate implement OAuth authentication feature` → Orchestration (feature-design)
- `/delegate debug crash on startup` → Orchestration (bug-hunt)

---

## Notes

### Version 7.0.0 - Direct Orchestration
- **Independent of unitAI**: Now uses direct `gemini` and `qwen` CLI calls.
- **Unified backends**: CCS (cost-optimized) + Direct Orchestration.
- **Config-driven**: All behavior defined in `config.yaml`.
- **Reference**: Uses patterns from [orchestrating-agents](../orchestrating-agents/SKILL.md).
