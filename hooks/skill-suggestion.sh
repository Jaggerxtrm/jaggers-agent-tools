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

# Pattern detection for /ccs delegation (simple tasks - IT + EN, flexible)
CCS_PATTERNS=(
  # Correzioni / Corrections
  "^(fix|correggi|risolvi).*typo"
  "^(fix|correggi).*spelling"

  # Test semplici
  "^(add|aggiungi|crea|create).*test"
  "^(genera|generate).*(test|unit|case)"

  # Refactoring semplice
  "^(estrai|extract).*(function|method|funzione|metodo)"
  "rename.*variable|rinomina.*variabile"

  # Documentazione
  "^(add|aggiungi).*(doc|docstring|comment)"
  "^(aggiorna|update).*comment"

  # Formattazione
  "^(format|formatta|lint|indenta|indent)"

  # Type hints
  "^(add|aggiungi).*(type|typing|hint)"

  # Modifiche semplici
  "^(rimuovi|remove|elimina|delete).*(import|unused)"
  "^(modifica|modify|cambia|change).*(name|nome)"
)

# Pattern detection for /p prompt improvement (IT + EN)
P_PATTERNS=(
  # Azioni generiche che beneficiano di struttura
  "analiz|analyz|esamina|studia|review|rivedi"
  "implementa|implement|create|crea"
  "spiega|explain|descri|describe"
  "^(come|how|what|cosa|perch|why)"
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

# Conversational patterns (greetings, simple acknowledgments - don't suggest)
CONVERSATIONAL_PATTERNS=(
  # Saluti / Greetings
  "^(ciao|hi|hello|hey|buongiorno|buonasera|salve)([!.]|$)"
  "^(good morning|good afternoon|good evening)([!.]|$)"

  # Ringraziamenti / Thanks
  "^(grazie|thanks|thank you|merci|thx)([!.]|$)"
  "^(grazie mille|thanks a lot|many thanks)([!.]|$)"

  # Acknowledgments
  "^(ok|okay|va bene|perfetto|perfect|fine|d'accordo|agreed?)([!.]|$)"
  "^(si|sì|yes|no|nope|yeah|yep)([!.]|$)"

  # Congedi / Goodbyes
  "^(arrivederci|addio|ciao|bye|goodbye|see you|ci vediamo)([!.]|$)"

  # Domande conversazionali molto semplici
  "^come stai\?$|^how are you\?$|^come va\?$"
  "^tutto bene\?$|^all good\?$|^everything ok\?$"
)

# Function to check if prompt matches pattern
matches_pattern() {
  local text="$1"
  local pattern="$2"
  # Use /bin/grep explicitly to avoid rg alias issues
  echo "$text" | /bin/grep -qiE "$pattern"
}

# Check exclusions first
for pattern in "${EXCLUDE_PATTERNS[@]}"; do
  if matches_pattern "$PROMPT" "$pattern"; then
    echo "{}"
    exit 0  # Complex task, don't suggest
  fi
done

# Check conversational patterns (don't suggest for greetings/acknowledgments)
for pattern in "${CONVERSATIONAL_PATTERNS[@]}"; do
  if matches_pattern "$PROMPT" "$pattern"; then
    echo "{}"
    exit 0  # Conversational message, don't suggest
  fi
done

# Check delegation patterns (simple keyword trigger)
SUGGEST_DELEGATION=false
if matches_pattern "$PROMPT" "delegate"; then
  SUGGEST_DELEGATION=true
fi

# Check CCS delegation patterns (only if not delegation workflow)
SUGGEST_CCS=false
if [ "$SUGGEST_DELEGATION" = false ]; then
  for pattern in "${CCS_PATTERNS[@]}"; do
    if matches_pattern "$PROMPT" "$pattern"; then
      SUGGEST_CCS=true
      break
    fi
  done
fi

# Check /p improvement patterns
SUGGEST_P=false
WORD_COUNT=$(echo "$PROMPT" | wc -w)

# Check if prompt matches task patterns first
for pattern in "${P_PATTERNS[@]}"; do
  if matches_pattern "$PROMPT" "$pattern"; then
    SUGGEST_P=true
    break
  fi
done

# Only suggest for very short prompts if they also look like tasks
# (avoid false positives on conversational messages)
if [ "$WORD_COUNT" -lt 6 ] && [ "$SUGGEST_P" = false ]; then
  # Check if it contains at least one verb or task keyword
  if matches_pattern "$PROMPT" "(creare|create|fare|do|aggiungere|add|modificare|modify|controllare|check|verificare|verify|testare|test)"; then
    SUGGEST_P=true
  fi
fi

# Generate suggestion message (systemReminder for Claude, not user)
if [ "$SUGGEST_DELEGATION" = true ]; then
  cat <<EOF
{
  "systemReminder": "💡 Claude Internal Reminder: User mentioned 'delegate'. Consider using the /delegate skill which will present an AskUserQuestion menu for profile selection (CCS simple tasks or unitAI workflows). The user will choose the profile - do NOT auto-execute."
}
EOF

elif [ "$SUGGEST_CCS" = true ]; then
  # Simple task - suggest /ccs for cost-optimized execution
  cat <<EOF
{
  "systemReminder": "💡 Claude Internal Reminder: This appears to be a simple, deterministic task (typo/test/format/doc). Consider using the /ccs skill for cost-optimized delegation (GLM-4-Flash, Gemini-Flash, or Qwen). The skill will present an AskUserQuestion menu for profile selection."
}
EOF

elif [ "$SUGGEST_P" = true ]; then
  # Vague prompt - suggest /prompt-improving
  cat <<EOF
{
  "systemReminder": "💡 Claude Internal Reminder: This prompt appears vague or could benefit from structure. Consider using the /prompt-improving skill to add XML structure, examples, and thinking space before proceeding. This is optional - use your judgment."
}
EOF

else
  # No suggestion
  echo "{}"
fi

exit 0
