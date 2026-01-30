#!/bin/bash
#
# skill-suggestion.sh
# UserPromptSubmit hook for proactive skill suggestions
#
# Purpose: Analyze user prompts and suggest /p or /ccs when beneficial
# Performance: Sub-100ms execution, no LLM calls
# Configuration: Opt-in via settings.json skillSuggestions.enabled

# Read JSON input from stdin
INPUT=$(cat)

# Extract user prompt from JSON
PROMPT=$(echo "$INPUT" | jq -r '.prompt // empty')

# Exit if no prompt or if hook is disabled
if [ -z "$PROMPT" ]; then
  exit 0
fi

# Check if skill suggestions are enabled
CONFIG_FILE="$HOME/.claude/settings.json"
if [ -f "$CONFIG_FILE" ]; then
  ENABLED=$(jq -r '.skillSuggestions.enabled // false' "$CONFIG_FILE")
  if [ "$ENABLED" != "true" ]; then
    exit 0
  fi
fi

# Pattern detection for /ccs delegation (IT + EN, flexible)
CCS_PATTERNS=(
  # Correzioni / Corrections
  "typo|errore|errori|spelling|ortograf"
  "correggi|fix|sistema|repair|risolv"
  
  # Test
  "test|unit.*test|integration.*test"
  "aggiungi.*test|add.*test|crea.*test|create.*test"
  
  # Refactoring
  "refactor|rifattoriz|riorganiz|restructur"
  "estrai|extract.*function|extract.*method"
  
  # Documentazione
  "doc|docstring|comment|commento"
  "aggiorna.*doc|update.*doc|migliora.*doc|improve.*doc"
  
  # Formattazione
  "format|formatta|lint|indenta|indent"
  
  # Type hints
  "type|typing|tipo|tipi|hint"
  "add.*type|aggiungi.*tipo"
  
  # Modifiche semplici
  "rimuovi|remove|elimina|delete"
  "modifica|modify|cambia|change"
)

# Pattern detection for /p prompt improvement (IT + EN)
P_PATTERNS=(
  # Azioni generiche che beneficiano di struttura
  "analiz|analyz|esamina|studia|review|rivedi"
  "implementa|implement|create|crea"
  "spiega|explain|descri|describe"
  "come|how|what.*is|cosa.*è|perch|why"
  
  # Prompt molto corti (qualsiasi lingua)
  "^.{1,35}$"  # < 35 caratteri totali
)

# Exclusion patterns (complex tasks - don't suggest, IT + EN)
EXCLUDE_PATTERNS=(
  "archit|design|progett"
  "security|sicurezz|auth|oauth"
  "bug|debug|investig|indaga"
  "performance|ottimizz|optim"
  "migra|breaking.*change"
  "complex|compless"
)

# Function to check if prompt matches pattern
matches_pattern() {
  local text="$1"
  local pattern="$2"
  echo "$text" | grep -qiE "$pattern"
}

# Check exclusions first
for pattern in "${EXCLUDE_PATTERNS[@]}"; do
  if matches_pattern "$PROMPT" "$pattern"; then
    exit 0  # Complex task, don't suggest
  fi
done

# Check CCS delegation patterns
SUGGEST_CCS=false
for pattern in "${CCS_PATTERNS[@]}"; do
  if matches_pattern "$PROMPT" "$pattern"; then
    SUGGEST_CCS=true
    break
  fi
done

# Check /p improvement patterns
SUGGEST_P=false
WORD_COUNT=$(echo "$PROMPT" | wc -w)
if [ "$WORD_COUNT" -lt 8 ]; then
  # Very short prompts benefit from structure
  SUGGEST_P=true
else
  for pattern in "${P_PATTERNS[@]}"; do
    if matches_pattern "$PROMPT" "$pattern"; then
      SUGGEST_P=true
      break
    fi
  done
fi

# Generate suggestion message
if [ "$SUGGEST_CCS" = true ]; then
  cat <<EOF
{
  "systemMessage": "💡 **Skill Suggestion**: This task may benefit from \`/ccs\` delegation (cost-optimized execution). Type \`/ccs [task]\` to delegate, or continue normally."
}
EOF
elif [ "$SUGGEST_P" = true ]; then
  cat <<EOF
{
  "systemMessage": "💡 **Skill Suggestion**: This prompt could be improved with \`/prompt-improving\` (adds XML structure, examples, thinking space). Type \`/prompt-improving \"$PROMPT\"\` or continue normally."
}
EOF
else
  # No suggestion
  echo "{}"
fi

exit 0
