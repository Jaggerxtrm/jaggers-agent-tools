# ccs-delegation

Delegates deterministic tasks to cost-optimized models via CCS CLI.

## Purpose

Identifies simple, well-scoped tasks that can be executed on cheaper models (glm, gemini, qwen) instead of the main Claude session. Saves tokens and reduces costs by delegating refactoring, tests, typos, documentation, and other deterministic work to specialized execution profiles.

## Invocation

```bash
# Direct invocation
/ccs [task description]

# Natural language
use ccs to [task description]

# With profile override
/ccs --glm [task]
/ccs --gemini [task]
```

## Associated Hooks

**skill-suggestion.sh**

Proactively suggests CCS delegation when detecting:
- Typo corrections and spelling fixes
- Test creation (unit, integration)
- Code refactoring
- Documentation updates
- Type hint additions
- Formatting and linting
- Simple modifications

Pattern matching supports both Italian and English:
- `typo|errore|spelling|ortograf`
- `test|unit.*test|aggiungi.*test`
- `refactor|rifattoriz|riorganiz`
- `doc|docstring|commento`

## Interactive Workflow

The skill uses AskUserQuestion dialogs for user-friendly interaction:

### Step 1: Delegation Choice

```
Execution: This looks like a good candidate for CCS delegation (cost-optimized execution). How would you like to proceed?

Options:
1. Delegate to CCS (Recommended) - Execute via cost-optimized model. Auto-selects best profile based on task keywords. Saves main session tokens.
2. Work in main session - Execute in current Claude session. Better for tasks requiring discussion, decisions, or complex context.
```

### Step 2: Profile Selection

```
Profile: Which profile should handle this task?

Options:
1. Auto-select (Recommended) - Analyzes task keywords and chooses optimal profile
2. Force GLM - Cost-optimized model. Best for: tests, refactors, typos
3. Force Gemini - Reasoning/long-context model. Best for: architecture analysis, complex thinking
4. Force Qwen - Alternative model. Good for: code quality analysis
```

## Profile Selection Logic

Simple keyword-based heuristic automatically selects the optimal execution profile:

### GLM (Cost-Optimized)
Triggers on: `typo|test|doc|fix spelling|format|lint|add type`
- Simple deterministic tasks
- Quick turnaround
- Minimal cost

### Gemini (Reasoning/Long-Context)
Triggers on: `think|analyze|reason|debug|investigate|evaluate`
- Complex analysis
- Architectural decisions
- Large codebase navigation

### Qwen (Alternative)
Fallback for general tasks
- Code quality review
- Pattern detection

## Task Suitability

### Good Candidates (Always Delegate)
- Fix typos in README.md
- Add unit tests for UserService
- Refactor parseConfig function to use async/await
- Update API documentation
- Add type hints to utils.py
- Format code according to style guide

### Poor Candidates (Keep in Main Session)
- Implement OAuth 2.0 (too complex)
- Fix the bug (unknown cause, needs investigation)
- Improve performance (requires profiling)
- Design database schema (architectural decision)
- Migrate to new API (breaking changes)

## Configuration

No additional configuration required beyond hook setup.

## Examples

### Example 1: Simple Refactor

```
User: use ccs to refactor parseConfig to use async/await

Profile Selected: glm (keyword: "refactor")
Execution: ccs glm -p "refactor parseConfig to use async/await"
Result: Task completed, 85% cost savings vs main session
```

### Example 2: Architecture Analysis

```
User: /ccs analyze entire architecture in src/

Profile Selected: gemini (keywords: "analyze entire")
Execution: ccs gemini -p "analyze entire architecture in src/"
Result: Long-context analysis performed
```

### Example 3: Manual Profile Override

```
User: /ccs --qwen review code quality in api/

Profile Selected: qwen (forced via --qwen flag)
Execution: ccs qwen -p "review code quality in api/"
Result: Quality analysis with custom profile
```

## Continuation Support

Continue previous delegation session:

```
/ccs:continue [follow-up task]
```

The skill automatically detects the previous session and continues with the same profile.

## Version History

- **v5.0.0** (2026-01-30): Simplified from 486 to 151 lines, keyword-based selection
- **v4.2.0** (Pre-2026): Complex scoring system with smart context gathering

## Removed Features (v4.2.0 → v5.0.0)

For 90% token reduction, the following advanced features were removed:
- Quantitative complexity scoring (0-10 scale)
- Smart context gathering (4-level system)
- Fallback chain (auto-retry on failure)
- Parallel delegation (batch processing)
- Delegation history tracking (learning system)

Core delegation functionality preserved. Users can still manually select profiles and attach context via `@file` syntax if needed.

##Related Documentation

- [Main README](../../README.md)
- [CHANGELOG](../../CHANGELOG.md)
- [ROADMAP](../../ROADMAP.md) - See profile tracking and custom profiles plans
- [Hook Documentation](../../hooks/README.md)
- [Troubleshooting Reference](references/troubleshooting.md)

## Troubleshooting

**Delegation not suggested**
- Check prompt contains delegation keywords
- Verify `skill-suggestion.sh` is executable and configured
- Try explicit invocation: `/ccs [task]`

**Wrong profile selected**
- Use manual override: `/ccs --glm [task]`
- Update keyword patterns in skill if needed
- Provide more specific task description

**CCS command not found**
- Install CCS CLI: Follow CCS installation guide
- Verify PATH includes CCS binary location
- Check `which ccs` shows valid path
