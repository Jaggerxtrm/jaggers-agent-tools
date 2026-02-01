#!/bin/bash
# Test script for skill-suggestion hook

HOOK_PATH="./hooks/skill-suggestion.sh"

# Color codes
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Test cases organized by expected behavior
declare -A test_cases

# Should NOT suggest (conversational)
test_cases[conversational]='
  {"prompt": "ciao"}
  {"prompt": "hello"}
  {"prompt": "grazie"}
  {"prompt": "ok"}
  {"prompt": "va bene"}
  {"prompt": "come stai?"}
'

# Should suggest DELEGATION (complex workflows)
test_cases[delegation]='
  {"prompt": "review this code for security issues"}
  {"prompt": "analizza questo codice per qualità"}
  {"prompt": "implement a new user authentication feature"}
  {"prompt": "design and implement a REST API endpoint"}
  {"prompt": "validate my staged changes before commit"}
  {"prompt": "check pre-commit hooks"}
  {"prompt": "architectural refactoring of the auth module"}
'

# Should suggest CCS (simple tasks)
test_cases[ccs]='
  {"prompt": "fix typo in README"}
  {"prompt": "correggi errori di spelling"}
  {"prompt": "add unit tests for UserService"}
  {"prompt": "generate test cases"}
  {"prompt": "format this file with prettier"}
  {"prompt": "add type hints to this function"}
  {"prompt": "rename variable userId to user_id"}
'

# Should suggest PROMPT-IMPROVING (vague prompts)
test_cases[prompt_improving]='
  {"prompt": "analizza"}
  {"prompt": "explain"}
  {"prompt": "how does this work?"}
  {"prompt": "cosa fa questo?"}
  {"prompt": "implementa qualcosa"}
'

echo -e "${BLUE}Testing skill-suggestion hook...${NC}"
echo "================================"
echo

for category in conversational delegation ccs prompt_improving; do
  echo -e "${BLUE}--- Category: ${category} ---${NC}"

  while IFS= read -r test_input; do
    # Skip empty lines
    [ -z "$test_input" ] && continue

    prompt=$(echo "$test_input" | jq -r '.prompt' 2>/dev/null)
    [ -z "$prompt" ] && continue

    printf "  %-50s" "\"$prompt\""
    result=$(echo "$test_input" | bash "$HOOK_PATH" 2>/dev/null)

    if [ -z "$result" ] || [ "$result" = "{}" ]; then
      if [ "$category" = "conversational" ]; then
        echo -e "[${GREEN}✓${NC}] No suggestion (correct)"
      else
        echo -e "[${RED}✗${NC}] No suggestion (UNEXPECTED)"
      fi
    else
      # Check if it's systemReminder (correct) or systemMessage (incorrect)
      reminder=$(echo "$result" | jq -r '.systemReminder // empty' 2>/dev/null)
      message=$(echo "$result" | jq -r '.systemMessage // empty' 2>/dev/null)

      if [ -n "$message" ]; then
        echo -e "[${RED}✗${NC}] Uses systemMessage (should be systemReminder!)"
        echo "      ${message:0:80}..."
      elif [ -n "$reminder" ]; then
        # Extract suggestion type
        if echo "$reminder" | grep -q "delegation patterns"; then
          suggestion_type="DELEGATION"
          color=$BLUE
        elif echo "$reminder" | grep -q "simple, deterministic"; then
          suggestion_type="CCS"
          color=$YELLOW
        elif echo "$reminder" | grep -q "vague.*prompt-improving"; then
          suggestion_type="PROMPT-IMPROVING"
          color=$YELLOW
        else
          suggestion_type="UNKNOWN"
          color=$RED
        fi

        if [ "$category" = "delegation" ] && [ "$suggestion_type" = "DELEGATION" ]; then
          echo -e "[${GREEN}✓${NC}] ${color}${suggestion_type}${NC}"
        elif [ "$category" = "ccs" ] && [ "$suggestion_type" = "CCS" ]; then
          echo -e "[${GREEN}✓${NC}] ${color}${suggestion_type}${NC}"
        elif [ "$category" = "prompt_improving" ] && [ "$suggestion_type" = "PROMPT-IMPROVING" ]; then
          echo -e "[${GREEN}✓${NC}] ${color}${suggestion_type}${NC}"
        else
          echo -e "[${RED}✗${NC}] ${color}${suggestion_type}${NC} (expected: $category)"
        fi

        # Show context if delegation
        if [ "$suggestion_type" = "DELEGATION" ]; then
          context=$(echo "$reminder" | grep -oP 'delegation patterns for \K[^.]+' | head -1)
          [ -n "$context" ] && echo "      Context: $context"
        fi
      fi
    fi
  done <<< "${test_cases[$category]}"

  echo
done

echo "================================"
echo -e "${GREEN}Test completed!${NC}"
