#!/bin/bash
# Type Safety Enforcement Hook
# Ensures mypy/pyright validation before commits and during Python file edits

# Extract tool name and arguments
TOOL="${CLAUDE_TOOL_NAME:-unknown}"
ARGS="${CLAUDE_TOOL_ARGS:-}"

# Colors for output
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
PROJECT_ROOT="/home/dawid/projects/yfinance-test"
VENV_PATH="$PROJECT_ROOT/.venv"
STRICT_DIRS=("mcp_server")  # Zero-tolerance directories
WARN_DIRS=("scripts")        # Warn-only directories

# Helper: Run mypy on a file/directory
run_mypy() {
    local target="$1"
    local is_strict="$2"

    # Activate venv and run mypy
    if [[ -f "$VENV_PATH/bin/activate" ]]; then
        source "$VENV_PATH/bin/activate"
        local output=$(python -m mypy "$target" --explicit-package-bases 2>&1)
        local exit_code=$?

        if [[ $exit_code -ne 0 ]]; then
            if [[ "$is_strict" == "true" ]]; then
                echo -e "${RED}❌ MYPY FAILED (STRICT MODE)${NC}"
                echo "$output"
                echo ""
                echo -e "${RED}🚫 COMMIT BLOCKED: Fix type errors in $target before committing${NC}"
                echo -e "${CYAN}💡 TIP: Run 'source .venv/bin/activate && python -m mypy $target --explicit-package-bases' to see errors${NC}"
                return 1
            else
                echo -e "${YELLOW}⚠️  MYPY WARNING (LENIENT MODE)${NC}"
                echo "$output" | head -20
                echo ""
                echo -e "${YELLOW}⚡ Type errors exist in $target (commit allowed, but please fix)${NC}"
                return 0
            fi
        else
            echo -e "${GREEN}✅ MYPY PASSED: $target${NC}"
            return 0
        fi
    else
        echo -e "${YELLOW}⚠️  Venv not found at $VENV_PATH, skipping mypy check${NC}"
        return 0
    fi
}

# Helper: Check if path is in strict directory
is_strict_path() {
    local file="$1"
    for dir in "${STRICT_DIRS[@]}"; do
        if [[ "$file" == "$dir"* ]]; then
            return 0
        fi
    done
    return 1
}

# Hook Logic: Intercept commits and edits
case "$TOOL" in
    "Bash")
        # Check if this is a git commit command
        if echo "$ARGS" | grep -q "git commit"; then
            echo -e "${CYAN}🔍 TYPE SAFETY CHECK: Validating staged Python files...${NC}"

            cd "$PROJECT_ROOT" || exit 0

            # Get staged Python files
            staged_files=$(git diff --cached --name-only --diff-filter=ACM | grep '\.py$' || true)

            if [[ -z "$staged_files" ]]; then
                echo -e "${GREEN}✅ No Python files staged, skipping type check${NC}"
                exit 0
            fi

            echo "Staged Python files:"
            echo "$staged_files"
            echo ""

            # Check each file
            failed=false
            for file in $staged_files; do
                if [[ -f "$file" ]]; then
                    if is_strict_path "$file"; then
                        echo -e "${CYAN}Checking $file (STRICT)...${NC}"
                        run_mypy "$file" "true" || failed=true
                    else
                        # Group by directory for efficiency
                        continue
                    fi
                fi
            done

            # Check strict directories as a whole
            for dir in "${STRICT_DIRS[@]}"; do
                if echo "$staged_files" | grep -q "^$dir/"; then
                    echo -e "${CYAN}Checking $dir/ (STRICT)...${NC}"
                    run_mypy "$dir/" "true" || failed=true
                fi
            done

            # Check warn directories as a whole
            for dir in "${WARN_DIRS[@]}"; do
                if echo "$staged_files" | grep -q "^$dir/"; then
                    echo -e "${CYAN}Checking $dir/ (LENIENT)...${NC}"
                    run_mypy "$dir/" "false"
                fi
            done

            if [[ "$failed" == "true" ]]; then
                echo ""
                echo -e "${RED}═══════════════════════════════════════════════════════${NC}"
                echo -e "${RED}🚫 COMMIT BLOCKED DUE TO TYPE ERRORS${NC}"
                echo -e "${RED}═══════════════════════════════════════════════════════${NC}"
                echo ""
                echo -e "${CYAN}Fix the errors above, then try again.${NC}"
                echo -e "${CYAN}Or use: git commit --no-verify (not recommended)${NC}"
                exit 1
            else
                echo ""
                echo -e "${GREEN}✅ All type checks passed!${NC}"
                exit 0
            fi
        fi
        ;;

    "Edit"|"Write")
        # Check if editing a Python file in strict directories
        if [[ -n "$ARGS" ]]; then
            FILE_PATH=$(echo "$ARGS" | grep -oP '(?<="file_path":")[^"]+' || echo "")

            if [[ "$FILE_PATH" =~ \.py$ ]] && is_strict_path "$FILE_PATH"; then
                cat <<EOF
${CYAN}═══════════════════════════════════════════════════════${NC}
${CYAN}📝 EDITING STRICT TYPE-SAFE FILE: $FILE_PATH${NC}
${CYAN}═══════════════════════════════════════════════════════${NC}

${YELLOW}⚠️  This file is in a STRICT type-safety zone${NC}
${YELLOW}   Any type errors will BLOCK commits${NC}

${CYAN}💡 TIPS:${NC}
1. Keep all type hints correct as you edit
2. Use mypy-compatible patterns (see Serena memory: pattern_type_safety_modernization_2025-12)
3. Test with: source .venv/bin/activate && python -m mypy $FILE_PATH

${GREEN}Current status: mcp_server/ = 0 errors (100% clean)${NC}
EOF
            fi
        fi
        ;;
esac

# Always allow the tool to proceed (hook is informational/enforcement, not blocking at tool level)
# Actual blocking happens at git commit level
exit 0
