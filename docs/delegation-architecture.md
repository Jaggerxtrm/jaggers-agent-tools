# Unified Delegation Architecture

## Core Principle: Always Ask User

**CRITICAL**: The delegation system NEVER executes without explicit user confirmation via AskUserQuestion menu.

## Execution Flow

```mermaid
graph TD
    A[User: /delegate "task"] --> B[Load delegation-config.yaml]
    B --> C[Parse task keywords]
    C --> D[Match against patterns]
    D --> E{Matches found?}
    E -->|Yes| F[Rank by relevance]
    E -->|No| G[Fallback: show all profiles]
    F --> H[AskUserQuestion Menu]
    G --> H
    H --> I{User Selection}
    I -->|Profile selected| J[Execute via backend adapter]
    I -->|Cancel| K[Exit]
    J --> L[Return results]
```

## AskUserQuestion Menu Design

### Smart Selection (Pattern Match)

When task matches patterns, show top 3-4 suggestions:

```typescript
AskUserQuestion({
  questions: [{
    header: "Delegate",
    question: "Which profile should handle this task?",
    multiSelect: false,
    options: [
      {
        label: "deep-review (Recommended)",
        description: "Multi-agent code review - Gemini+Cursor+Droid [HIGH COST]"
      },
      {
        label: "quick-fix",
        description: "Fast typo/formatting fixes - GLM-4-Flash [LOW COST]"
      },
      {
        label: "security-audit",
        description: "Security-focused review - Gemini [MEDIUM COST]"
      },
      {
        label: "Other profiles...",
        description: "Show all available profiles"
      }
    ]
  }]
});
```

### Fallback (No Match / "Other")

When no patterns match or user selects "Other":

```typescript
AskUserQuestion({
  questions: [{
    header: "Delegate",
    question: "Select delegation profile:",
    multiSelect: false,
    options: [
      // All profiles from config, grouped by cost
      { label: "quick-fix", description: "GLM-4-Flash - Typos/formatting [LOW]" },
      { label: "test-gen", description: "Gemini-Flash - Unit tests [LOW]" },
      { label: "deep-review", description: "Multi-agent review [HIGH]" },
      { label: "feature-complete", description: "Design+implement+test [HIGH]" },
      // ... all profiles
    ]
  }]
});
```

## Skill Implementation (Pseudocode)

```bash
#!/bin/bash
# skills/delegation/skill.md execution

TASK="$1"
CONFIG=".claude/delegation-config.yaml"

# 1. Load config
PROFILES=$(yq '.profiles' "$CONFIG")
PATTERNS=$(yq '.patterns' "$CONFIG")

# 2. Match patterns
MATCHES=[]
for pattern in $PATTERNS; do
  if echo "$TASK" | grep -qiE "$(echo $pattern | yq '.keywords | join("|")')"; then
    SUGGESTED=$(echo $pattern | yq '.suggest[]')
    MATCHES+=($SUGGESTED)
  fi
done

# 3. Rank by frequency
RANKED=$(echo "${MATCHES[@]}" | sort | uniq -c | sort -rn | head -4)

# 4. Build AskUserQuestion options
OPTIONS=[]
for profile in $RANKED; do
  DESC=$(yq ".profiles.$profile.description" "$CONFIG")
  COST=$(yq ".profiles.$profile.cost" "$CONFIG")
  OPTIONS+=("{ label: \"$profile\", description: \"$DESC [$COST COST]\" }")
done

# Always add "Other" option
OPTIONS+=("{ label: \"Other profiles...\", description: \"Show all available profiles\" }")

# 5. Ask user (ALWAYS - no auto-execution)
SELECTION=$(AskUserQuestion "Which profile?" $OPTIONS)

# 6. If "Other", show full list
if [ "$SELECTION" = "Other profiles..." ]; then
  ALL_OPTIONS=[]
  for profile in $(yq '.profiles | keys' "$CONFIG"); do
    DESC=$(yq ".profiles.$profile.description" "$CONFIG")
    COST=$(yq ".profiles.$profile.cost" "$CONFIG")
    ALL_OPTIONS+=("{ label: \"$profile\", description: \"$DESC [$COST]\" }")
  done
  SELECTION=$(AskUserQuestion "Select profile:" $ALL_OPTIONS)
fi

# 7. Execute via backend adapter
BACKEND=$(yq ".profiles.$SELECTION.backend" "$CONFIG")
case $BACKEND in
  ccs)
    ./backends/ccs.sh "$SELECTION" "$TASK"
    ;;
  unitai)
    ./backends/unitai.sh "$SELECTION" "$TASK"
    ;;
esac
```

## User Confirmation Points

1. **Always before execution**: AskUserQuestion menu
2. **Cost warning**: High-cost profiles show [HIGH COST] badge
3. **Autonomy warning**: If profile has autonomy > read-only, show in description:
   ```
   "feature-complete"
   description: "Design+implement+test [HIGH COST, HIGH AUTONOMY]"
   ```

## Hook Integration

The skill-suggestion hook should:
- **Target**: Claude (system-reminder), NOT user (systemMessage)
- **Trigger**: Detect delegation-worthy tasks
- **Message**: Remind Claude to USE the skill, not tell user about it

### Hook Output Format

```json
{
  "systemReminder": "💡 Claude: This task matches delegation patterns ['review', 'analyze']. Consider using `/delegate` skill with smart profile selection (will show AskUserQuestion menu to user)."
}
```

**NOT** (current incorrect behavior):
```json
{
  "systemMessage": "💡 Skill Suggestion: This prompt could be improved..."
}
```

## No Auto-Execution

**NEVER**:
- Auto-select profile without asking
- Execute delegation silently
- Skip confirmation for "simple" tasks

**ALWAYS**:
- Show AskUserQuestion menu
- Let user choose profile (or cancel)
- Display cost/autonomy warnings in option descriptions
