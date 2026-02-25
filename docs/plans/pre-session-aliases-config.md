# IDEA
A custom CLI that runs system-prompts injection based on a predefined templates set, as system prompt has higher authority.
Can also customize an enforced set of skills, agents, general requirements as needed.


System prompt content has higher authority than user messages, which have higher authority than tool results. For most day-to-day work this is marginal. But for things like strict behavioral rules, project-specific constraints, or context you absolutely need Claude to prioritize - system prompt injection ensures it's weighted appropriately.
Practical setup:
A valid way to do this is to utilize `.claude/rules/` for your baseline project rules, then have CLI aliases for scenario-specific context you can switch between:


```bash
# Daily development
alias claude-dev='claude --system-prompt "$(cat ~/.claude/contexts/dev.md)"'

# PR review mode
alias claude-review='claude --system-prompt "$(cat ~/.claude/contexts/review.md)"'

# Research/exploration mode
alias claude-research='claude --system-prompt "$(cat ~/.claude/contexts/research.md)"'

System Prompt Context Example Files
 (Direct Link):

    dev.md
     focuses on implementation
    review.md
     on code quality/security
    research.md
     on exploration before acting
```

Again, for most things the difference between using `.claude/rules/context1.md` and directly appending `context1.md
` to your system prompt is marginal. The CLI approach is faster (no tool call), more reliable (system-level authority), and slightly more token efficient. But it's a minor optimization and for many its more overhead than its worth.