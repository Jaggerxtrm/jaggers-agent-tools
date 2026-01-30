#!/bin/bash
# Serena + LSP Workflow Reminder Hook
# Enforces semantic, surgical code editing workflow

# Extract tool name from CLAUDE_TOOL_NAME environment variable
TOOL="${CLAUDE_TOOL_NAME:-unknown}"

# Check if we're about to use inefficient tools on code files
case "$TOOL" in
    "Read")
        # Check if reading a large code file
        if [[ -n "$CLAUDE_TOOL_ARGS" ]]; then
            FILE_PATH=$(echo "$CLAUDE_TOOL_ARGS" | grep -oP '(?<="file_path":")[^"]+' || echo "")
            if [[ "$FILE_PATH" =~ \.(py|ts|js|jsx|tsx|go|rs|java|cpp|c|h)$ ]]; then
                LINE_COUNT=$(wc -l < "$FILE_PATH" 2>/dev/null || echo "0")
                if [[ "$LINE_COUNT" -gt 300 ]]; then
                    cat <<EOF
⚠️  WORKFLOW REMINDER: Large code file (${LINE_COUNT} LOC)

Instead of Read, use Serena for 75-80% token savings:
1. mcp__serena__get_symbols_overview() → See structure first
2. mcp__serena__find_symbol(include_body=true) → Read specific symbols only

See: ~/.claude/skills/serena-lsp-workflow/SKILL.md
EOF
                fi
            fi
        fi
        ;;
    "Edit")
        # Suggest replace_symbol_body for code file edits
        if [[ -n "$CLAUDE_TOOL_ARGS" ]]; then
            FILE_PATH=$(echo "$CLAUDE_TOOL_ARGS" | grep -oP '(?<="file_path":")[^"]+' || echo "")
            if [[ "$FILE_PATH" =~ \.(py|ts|js|jsx|tsx|go|rs|java|cpp|c|h)$ ]]; then
                cat <<EOF
⚠️  WORKFLOW REMINDER: Editing code file

Consider surgical editing with Serena instead:
1. mcp__serena__find_referencing_symbols() → Check impact FIRST
2. mcp__serena__replace_symbol_body() → Atomic, formatting-safe edits

Advantages: Works regardless of whitespace, can't match wrong code
See: ~/.claude/skills/serena-lsp-workflow/SKILL.md
EOF
            fi
        fi
        ;;
    "Grep")
        # Suggest search_for_pattern for code searches
        cat <<EOF
💡 TIP: For code files, mcp__serena__search_for_pattern is more efficient

Serena search advantages:
- Restricts to code files automatically
- Provides symbol context
- Glob patterns for file filtering
- Context lines around matches

See: ~/.claude/skills/serena-lsp-workflow/SKILL.md
EOF
        ;;
esac

# Always allow the tool to proceed (non-blocking reminder)
exit 0
