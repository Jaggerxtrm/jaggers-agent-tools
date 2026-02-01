# Hook System Summary

## Overview

L'hook `skill-suggestion.sh` è un **system reminder interno per Claude**, non un messaggio utente. Aiuta Claude a ricordare di usare le skill appropriate in base al contesto del prompt.

## Come Funziona

### UserPromptSubmit Hook

Quando l'utente invia un prompt:
1. L'hook analizza il prompt
2. Se match pattern specifici, ritorna `{"systemReminder": "..."}`
3. Claude riceve il reminder come system message (invisibile all'utente)
4. Claude decide autonomamente se usare la skill suggerita

### Trigger Patterns

#### 1. DELEGATION (keyword-based)
**Trigger**: parola "delegate" nel prompt

**Reminder**:
```
💡 Claude Internal Reminder: User mentioned 'delegate'.
Consider using the /delegate skill which will present an
AskUserQuestion menu for profile selection (CCS simple tasks
or unitAI workflows). The user will choose the profile -
do NOT auto-execute.
```

**Esempio**:
- User: "delegate this review to cheap model"
- Claude riceve reminder → usa `/delegate` skill → mostra menu AskUserQuestion

#### 2. CCS (simple tasks)
**Trigger**: pattern per task deterministici semplici
- `^(fix|correggi).*typo`
- `^(add|aggiungi).*test`
- `^(format|formatta|lint)`
- `^(add|aggiungi).*(type|hint)`
- etc.

**Reminder**:
```
💡 Claude Internal Reminder: This appears to be a simple,
deterministic task (typo/test/format/doc). Consider using
the /ccs skill for cost-optimized delegation.
```

**Esempio**:
- User: "fix typo in README"
- Claude riceve reminder → usa `/ccs` skill

#### 3. PROMPT-IMPROVING (vague prompts)
**Trigger**:
- Prompt molto corti (< 6 parole) con verbi task
- Pattern generici: `analiz`, `explain`, `^(come|how|what|cosa)`

**Reminder**:
```
💡 Claude Internal Reminder: This prompt appears vague or
could benefit from structure. Consider using the
/prompt-improving skill. This is optional - use your judgment.
```

**Esempio**:
- User: "analizza"
- Claude riceve reminder → usa `/prompt-improving` skill

### Esclusioni

#### Conversational (no reminder)
Pattern conversazionali non triggerano suggestion:
- Saluti: `ciao`, `hello`, `hi`, `buongiorno`
- Ringraziamenti: `grazie`, `thanks`
- Acknowledgments: `ok`, `va bene`, `si/no`
- Congedi: `bye`, `arrivederci`

#### Complex Tasks (no reminder)
Task complessi che richiedono human judgment:
- `archit|design|progett`
- `security|auth|oauth`
- `bug|debug|investig`
- `performance|ottimizz`
- `migra|breaking.*change`

## Principi Chiave

### 1. Always Ask User
**CRITICAL**: La skill di delegation **DEVE SEMPRE** mostrare un menu AskUserQuestion prima dell'esecuzione. NO auto-execution.

```typescript
AskUserQuestion({
  questions: [{
    header: "Delegate",
    question: "Which profile should handle this task?",
    multiSelect: false,
    options: [
      { label: "deep-review", description: "Multi-agent code review [HIGH COST]" },
      { label: "quick-fix", description: "GLM-4-Flash typo fix [LOW COST]" },
      // ...
    ]
  }]
});
```

### 2. systemReminder (NOT systemMessage)
L'hook usa `systemReminder` per comunicare con Claude, **non** `systemMessage` che sarebbe visibile all'utente.

**Corretto**:
```json
{
  "systemReminder": "💡 Claude Internal Reminder: ..."
}
```

**Sbagliato**:
```json
{
  "systemMessage": "💡 Skill Suggestion: ..."  // ❌ Visibile all'utente
}
```

### 3. Output Format
L'hook DEVE SEMPRE ritornare JSON valido:
- Suggestion: `{"systemReminder": "..."}`
- No suggestion: `{}`
- **MAI** exit senza output

## Configuration

### Enable/Disable Hook

```bash
# ~/.claude/settings.json
{
  "skillSuggestions": {
    "enabled": true  // Set to false to disable hook
  }
}
```

### Hook Location

```
hooks/
  skill-suggestion.sh  # UserPromptSubmit hook
```

## Testing

```bash
./test-hook.sh
```

Expected results:
- ✓ Conversational → `{}`
- ✓ "delegate task" → DELEGATION reminder
- ✓ "fix typo" → CCS reminder
- ✓ "analizza" → PROMPT-IMPROVING reminder

## Integration with Delegation System

Vedi: [delegation-architecture.md](./delegation-architecture.md)

Il sistema delegation unificato userà questo hook per:
1. Ricevere reminder quando l'utente scrive "delegate"
2. Presentare menu AskUserQuestion con profili (CCS o unitAI workflows)
3. Eseguire la scelta dell'utente via backend adapters

## Future Enhancements

- [ ] Pattern per detection automatica di unitAI workflows (code review, feature design)
- [ ] Configurazione personalizzabile via `~/.claude/hook-config.yaml`
- [ ] Logging/analytics su suggestion acceptance rate
- [ ] Integration con /remember per apprendimento pattern utente-specifici
