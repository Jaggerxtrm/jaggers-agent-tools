#!/usr/bin/env python3
import sys
import os

# Add script directory to path to allow importing shared modules
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from agent_context import AgentContext

def get_skill_reminder(agent_type):
    folder = f".{agent_type}"
    return f"""
*** MANDATORY SKILL: Using Serena LSP ***
You are REQUIRED to use semantic tools for all code interactions to ensure safety and token efficiency.

RULES:
1. READING: NEVER read full code files >300 lines.
   - START with `get_symbols_overview(depth=1)` to map the file.
   - READ specific parts with `find_symbol(include_body=True)`.
2. EDITING: NEVER use the generic `Edit` or `replace` tool on code.
   - USE `replace_symbol_body` for atomic updates.
   - USE `insert_after_symbol` / `insert_before_symbol` for additions.
   - ALWAYS run `find_referencing_symbols` before changing signatures.
3. SEARCH: USE `search_for_pattern` instead of grep/find.

Ref: ~/{folder}/skills/using-serena-lsp/SKILL.md
"""

CODE_EXTENSIONS = {'.py', '.ts', '.js', '.jsx', '.tsx', '.go', '.rs', '.java', '.cpp', '.c', '.h'}

def count_lines(filepath):
    try:
        with open(filepath, 'r') as f:
            return sum(1 for _ in f)
    except:
        return 0

try:
    ctx = AgentContext()
    event = ctx.event

    if event == 'SessionStart':
        ctx.allow(additional_context=get_skill_reminder(ctx.agent_type))

    elif event in ['PreToolUse', 'BeforeTool']:
        tool_name = ctx.tool_name
        
        # Rule 1: Block Reading Large Code Files
        if tool_name in ['Read', 'read_file']:
            file_path = ctx.get_file_path()
            _, ext = os.path.splitext(file_path)
            if ext in CODE_EXTENSIONS:
                loc = count_lines(file_path)
                if loc > 300:
                    ctx.block(
                        reason=f"VIOLATION: Reading full file of {loc} lines is forbidden. Use 'get_symbols_overview' and 'find_symbol' to save tokens.",
                        system_message="⚠️ Blocked inefficient file read. Use Serena semantic tools."
                    )

        # Rule 2: Block Generic Edits on Code
        if tool_name in ['Edit', 'replace']:
            file_path = ctx.get_file_path()
            _, ext = os.path.splitext(file_path)
            if ext in CODE_EXTENSIONS:
                 ctx.block(
                    reason=f"VIOLATION: Generic '{tool_name}' is unsafe for code. Use 'replace_symbol_body' or 'insert_after_symbol' for surgical edits.",
                    system_message="⚠️ Blocked unsafe edit. Use Serena semantic tools."
                )

    ctx.fail_open()

except Exception as e:
    # Fail safe: log error but allow operation
    print(f"Hook Error: {e}", file=sys.stderr)
    sys.exit(0)