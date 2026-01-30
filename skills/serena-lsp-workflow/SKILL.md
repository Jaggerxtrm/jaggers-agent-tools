---
name: serena-lsp-workflow
description: Master workflow combining Serena MCP semantic tools with LSP plugins (Pyright, etc.) for efficient, surgical code editing. ALWAYS use for code exploration, editing, and type safety. Achieves 75-80% token savings through semantic symbol-level access.
allowed-tools: mcp__serena__*, Read, Edit, Bash
priority: high
---

# Serena + LSP Master Workflow

**Core Principle**: Use semantic, symbol-level access to understand and edit code without reading entire files. Combine with LSP plugins for real-time analysis.

## When to Use (ALWAYS for code!)

✅ **Use Serena + LSP for ALL:**
- Reading or exploring code files (`.py`, `.ts`, `.js`, `.go`, `.rs`, etc.)
- Understanding code structure and relationships
- Finding symbol definitions and references
- Editing code at the symbol level (functions, classes, methods)
- Type safety improvements (Python with Pyright LSP)
- Refactoring and renaming symbols
- Impact analysis before changes

❌ **DO NOT use Serena for:**
- Non-code files (markdown, JSON, YAML, config files) → use Read tool
- Files <100 lines where you need full context → use Read tool
- Binary files or images

## Complete Serena Tool Reference

### 1. Exploration & Navigation Tools

#### `list_dir`
List files and directories with optional recursion.
```python
mcp__serena__list_dir(
    relative_path=".",  # or "src/analysis"
    recursive=true,
    skip_ignored_files=true  # Respects .gitignore
)
```
**Use when**: Need to see project structure or find file locations

#### `find_file`
Find files by name pattern (wildcards supported).
```python
mcp__serena__find_file(
    file_mask="*volatility*.py",  # Supports * and ?
    relative_path="scripts"
)
```
**Use when**: Know partial filename but not exact path

#### `get_symbols_overview`
**MOST IMPORTANT** - Get high-level code structure without reading the file.
```python
mcp__serena__get_symbols_overview(
    relative_path="scripts/core/analytics.py",
    depth=1  # 0=top-level only, 1=include children (methods), 2+=deeper
)
```
**Use when**: First step exploring any code file >300 LOC
**Returns**: Symbol tree with names, kinds, locations (NO bodies)

#### `find_symbol`
Locate specific symbols (functions, classes, methods) semantically.
```python
mcp__serena__find_symbol(
    name_path_pattern="VolatilityCalculator/analyze_rv_trend",  # Class/method
    # or "analyze_rv_trend"  # Just method name
    relative_path="scripts/core/volatility_suite.py",  # Optional: restrict search
    depth=1,  # Include children
    include_body=true,  # Get source code (only when needed!)
    substring_matching=true,  # Match "get" to "getValue", "getData"
    include_kinds=[5, 6, 12],  # Filter: 5=Class, 6=Method, 12=Function
    exclude_kinds=[]
)
```
**Use when**: Need to find/read specific symbols
**Name path syntax**:
- `"MyClass"` → Find class anywhere
- `"MyClass/my_method"` → Find method in class (relative path)
- `"/MyClass/my_method"` → Exact match (absolute path)
- `"MyClass/my_method[0]"` → Specific overload (Java, C++)

**LSP Symbol Kinds Reference**:
```
1=file, 2=module, 3=namespace, 4=package, 5=class, 6=method,
7=property, 8=field, 9=constructor, 10=enum, 11=interface,
12=function, 13=variable, 14=constant, 15=string, 16=number,
17=boolean, 18=array, 19=object, 20=key, 21=null,
22=enum member, 23=struct, 24=event, 25=operator, 26=type parameter
```

#### `find_referencing_symbols`
**CRITICAL BEFORE EDITING** - Find all places that reference a symbol.
```python
mcp__serena__find_referencing_symbols(
    name_path="calculate_volatility",
    relative_path="scripts/core/analytics.py",
    include_kinds=[],  # Filter what kind of references to include
    exclude_kinds=[]
)
```
**Use when**: Before editing/deleting any symbol (prevents breaking code!)
**Returns**: All references with code snippets and locations

#### `search_for_pattern`
Flexible regex/substring search in code (when symbol names unknown).
```python
mcp__serena__search_for_pattern(
    substring_pattern="def.*volatility",  # Regex (DOTALL enabled)
    relative_path="scripts/core",  # Optional: restrict to directory
    restrict_search_to_code_files=true,  # Only searchable code files
    paths_include_glob="*.py",  # Optional: glob pattern
    paths_exclude_glob="*test*",  # Optional: exclude pattern
    context_lines_before=2,
    context_lines_after=2
)
```
**Use when**: Looking for patterns without knowing exact symbol names
**Regex tips**: Use `.*?` (non-greedy), pattern spans lines with DOTALL

### 2. Editing Tools (Surgical!)

#### `replace_symbol_body`
**PRIMARY EDIT TOOL** - Replace entire symbol definition atomically.
```python
mcp__serena__replace_symbol_body(
    name_path="get_db_engine",
    relative_path="scripts/core/volatility_suite.py",
    body="""def get_db_engine() -> Engine:
    try:
        engine = create_engine(DB_URL)
        return engine
    except Exception as e:
        logging.error(f"Failed to create database engine: {e}")
        raise"""
)
```
**Use when**: Replacing function/method/class definitions
**Advantages**:
- ✅ Works regardless of formatting/whitespace
- ✅ Can't accidentally match wrong code
- ✅ Atomic replacement
- ✅ Safe if surrounding code changes

#### `insert_after_symbol`
Insert code after a symbol's definition ends.
```python
mcp__serena__insert_after_symbol(
    name_path="VolatilityCalculator",  # Insert after this class
    relative_path="scripts/core/analytics.py",
    body="""

class RiskCalculator:
    def calculate_var(self, returns):
        return np.percentile(returns, 5)
"""
)
```
**Use when**: Adding new symbols (functions, classes) to a file

#### `insert_before_symbol`
Insert code before a symbol's definition starts.
```python
mcp__serena__insert_before_symbol(
    name_path="VolatilityCalculator",  # Find first symbol in file
    relative_path="scripts/core/analytics.py",
    body="""from typing import Protocol

"""
)
```
**Use when**: Adding imports, inserting code at file beginning

#### `rename_symbol`
Rename symbol across entire codebase (LSP-powered).
```python
mcp__serena__rename_symbol(
    name_path="calculate_volatility",
    relative_path="scripts/core/analytics.py",
    new_name="compute_volatility"
)
```
**Use when**: Renaming functions/classes/methods safely
**Note**: Updates ALL references automatically!

### 3. Memory Management Tools

#### `write_memory`
Store project decisions, patterns, architecture notes.
```python
mcp__serena__write_memory(
    memory_file_name="architecture_decision_auth_pattern",
    content="""# Authentication Architecture Decision

Date: 2025-12-30
Decision: Use JWT with refresh tokens
Rationale: Better scalability for distributed services
Implementation: See auth_service.py
"""
)
```
**Use when**: Documenting important decisions for future reference

#### `read_memory`
Retrieve stored project knowledge.
```python
mcp__serena__read_memory(
    memory_file_name="architecture_decision_auth_pattern"
)
```
**Use when**: Before starting tasks to get relevant context

#### `list_memories`
Discover available project knowledge.
```python
mcp__serena__list_memories()
```
**Use when**: Starting work on a project, finding related documentation

#### `edit_memory`
Update existing memory files.
```python
mcp__serena__edit_memory(
    memory_file_name="architecture_decision_auth_pattern",
    mode="regex",  # or "literal"
    needle="Use JWT",
    repl="Use JWT with RS256"
)
```
**Use when**: Updating outdated memory information

#### `delete_memory`
Remove obsolete memory files.
```python
mcp__serena__delete_memory(
    memory_file_name="deprecated_pattern"
)
```
**Use when**: User explicitly says information is no longer relevant

### 4. Meta / Thinking Tools

#### `check_onboarding_performed`
Check if project onboarding was completed.
```python
mcp__serena__check_onboarding_performed()
```
**Use when**: First time working on a project

#### `onboarding`
Get instructions for project onboarding.
```python
mcp__serena__onboarding()
```
**Use when**: Onboarding check indicates it's needed

#### `think_about_collected_information`
**MANDATORY** - Reflect after exploration/search operations.
```python
mcp__serena__think_about_collected_information()
```
**Use when**: After find_symbol, search_for_pattern, find_referencing_symbols chains

#### `think_about_task_adherence`
**MANDATORY** - Verify you're still on track for the task.
```python
mcp__serena__think_about_task_adherence()
```
**Use when**: Before insert/replace/delete operations, after long conversations

#### `think_about_whether_you_are_done`
**MANDATORY** - Assess task completion.
```python
mcp__serena__think_about_whether_you_are_done()
```
**Use when**: Think task might be complete

## Standard Workflows

### Workflow 1: Explore Unknown Codebase

```
1. check_onboarding_performed() → See if context exists
2. list_memories() → Find relevant project knowledge
3. read_memory(...) → Load relevant context
4. list_dir(recursive=true) → Understand structure
5. get_symbols_overview(...) → See high-level code structure
6. find_symbol(depth=1) → Drill into specific areas
7. think_about_collected_information() → Reflect
```

### Workflow 2: Add Type Hints (Python + Pyright LSP)

```
1. Read(file) → Pyright LSP analyzes automatically
2. get_symbols_overview(depth=0) → See all functions
3. For each function needing types:
   a. find_symbol(include_body=true) → Get current definition
   b. replace_symbol_body(...) → Add type hints surgically
4. Bash("python -m py_compile ...") → Verify syntax
5. think_about_whether_you_are_done()
```

### Workflow 3: Refactor Function

```
1. find_symbol(include_body=true) → Get current implementation
2. find_referencing_symbols(...) → Find all usages
3. think_about_task_adherence() → Verify approach
4. replace_symbol_body(...) → Update implementation
5. Check each reference location → Update if needed
6. Bash("run tests") → Verify nothing broke
7. think_about_whether_you_are_done()
```

### Workflow 4: Add New Feature

```
1. read_memory(...) → Get relevant architecture context
2. get_symbols_overview(...) → Understand existing structure
3. find_symbol(pattern="similar_feature") → Find similar code
4. insert_after_symbol(...) → Add new classes/functions
5. write_memory(...) → Document new architectural decisions
6. think_about_whether_you_are_done()
```

## LSP Integration

### Pyright (Python)

**Auto-enabled**: Pyright LSP runs in background when reading Python files

**Provides**:
- Type checking and inference
- Missing type annotations detection
- None-safety issues
- Type mismatches
- Return type errors

**Workflow**:
1. `Read(python_file)` → Pyright analyzes automatically
2. LSP feedback: "5 functions missing return types"
3. Use Serena to fix: `find_symbol` → `replace_symbol_body`
4. Verify: `Bash("python -m py_compile")`

### Other LSP Plugins

- **TypeScript**: tsserver-lsp (enable in settings)
- **Go**: gopls-lsp
- **Rust**: rust-analyzer-lsp
- **Java**: jdtls-lsp

**Enable in** `~/.claude/settings.json`:
```json
{
  "enabledPlugins": {
    "pyright-lsp@claude-plugins-official": true,
    "tsserver-lsp@claude-plugins-official": true
  }
}
```

## File Size Guidelines

| Lines of Code | Approach |
|---------------|----------|
| < 100 LOC | Can use `Read` if you need full context |
| 100-300 LOC | Use `get_symbols_overview` first, then targeted `find_symbol` |
| 300-500 LOC | Use Serena exclusively: overview → find → edit |
| 500-1000 LOC | Symbol-level only: `get_symbols_overview(depth=1)` |
| > 1000 LOC | **ALWAYS** Serena: Never read full file |

**Token Savings**: 75-80% compared to reading full files!

## Critical Rules

### ✅ DO:

1. **Always use `get_symbols_overview` first** for code files >300 LOC
2. **Always call `find_referencing_symbols`** before editing/deleting
3. **Always use `replace_symbol_body`** for function/class edits (not `Edit`)
4. **Always call thinking tools** after exploration or before edits
5. **Always use `include_body=true`** only when you need source code
6. **Always verify** with syntax check after surgical edits

### ❌ DO NOT:

1. **Never use `Read`** on large code files (>300 LOC) → use `get_symbols_overview`
2. **Never use `Edit`** for symbol-level changes → use `replace_symbol_body`
3. **Never edit without** calling `find_referencing_symbols` first
4. **Never skip** thinking tools (they prevent mistakes!)
5. **Never use grep/search** on code files → use `search_for_pattern`
6. **Never read** full file when you only need specific symbols

## Integration with Project Skills

This is a **global skill** that works with **project-specific skills**:

**Example**: Python Type Safety
- Global: Serena + LSP workflow (this skill)
- Project: `python-type-safety` skill (project-specific patterns)
- Together: Serena finds symbols → LSP detects issues → Serena fixes surgically

**Example**: Security Patterns
- Global: Serena + LSP workflow
- Project: `security-patterns` skill
- Together: Serena finds SQL queries → validate → fix with parameterization

## Quick Command Reference

| Task | Tool | One-liner |
|------|------|-----------|
| Explore file structure | `get_symbols_overview` | depth=0 for top-level |
| Find function | `find_symbol` | Use name_path_pattern |
| See method bodies in class | `find_symbol` | depth=1, include_body=true |
| Find all usages | `find_referencing_symbols` | ALWAYS before editing |
| Replace function | `replace_symbol_body` | Surgical, atomic |
| Add new function | `insert_after_symbol` | After existing symbol |
| Rename across codebase | `rename_symbol` | LSP-powered, safe |
| Search by pattern | `search_for_pattern` | Regex, context lines |
| Remember decision | `write_memory` | For future reference |
| Check impact | `think_about_task_adherence` | Before major changes |

## Troubleshooting

### "Symbol not found"
- Try `substring_matching=true`
- Use `get_symbols_overview` to see available symbols
- Check `relative_path` is correct
- Verify symbol name spelling (case-sensitive)

### "Too much information returned"
- Use `depth=0` to see less
- Add `include_kinds` filter
- Don't use `include_body=true` unless needed
- Use `relative_path` to narrow search

### "Edit broke code"
- Did you call `find_referencing_symbols` first? (Required!)
- Use `replace_symbol_body` instead of text-based `Edit`
- Check syntax with `python -m py_compile`
- Review all references from `find_referencing_symbols`

### "LSP not working"
- Verify plugin enabled: check `~/.claude/settings.json`
- Ensure language tool installed: `pip install pyright` for Python
- Restart Claude Code if just enabled
- Check file extension matches LSP (.py for Pyright)

---

**Last Updated**: 2025-12-30
**Scope**: Global (applies to all projects)
**Priority**: High (auto-loads for code editing tasks)
**See Also**: `.cursor/rules/serena-smart-coding.mdc` (Cursor compatibility)
