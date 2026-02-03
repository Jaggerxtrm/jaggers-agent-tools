---
name: orchestrating-agents
description: Orchestrates task handoff and "handshaking" between Gemini and Qwen CLI agents. Facilitates specialized reviews, second opinions, and cross-validation of complex logic. Use when a task requires multi-model collaboration, a second LLM perspective, or iterative feedback between terminal agents.
---

# Orchestrating Agents

This skill provides a structured workflow for multi-model collaboration between Gemini and Qwen, enabling deep "handshaking" sessions for complex tasks.

## Interactive Orchestration

When a task involves high complexity (new features, deep bugs, or "getting out of trouble"), suggest a multi-turn orchestration session using the appropriate tool for your environment:

### For Gemini CLI (`ask_user`)
```typescript
ask_user({
  questions: [{
    question: "This task requires deep collaboration. Which orchestration workflow should we use?",
    header: "Orchestrate",
    options: [
      { label: "Collaborative Design", description: "Agent A proposes -> Agent B critiques -> Agent A refines." },
      { label: "Adversarial Review", description: "Agent A proposes -> Agent B attacks (Red Team) -> Agent A defends." },
      { label: "Troubleshoot Session", description: "Multi-agent hypothesis testing for emergency bugs." },
      { label: "Single Handshake", description: "Standard one-turn second opinion." }
    ]
  }]
});
```

### For Claude Code (`AskUserQuestion`)
```typescript
AskUserQuestion({
  questions: [{
    question: "This task requires deep collaboration. Which orchestration workflow should we use?",
    header: "Orchestrate",
    options: [
      { label: "Collaborative Design", description: "Agent A proposes -> Agent B critiques -> Agent A refines." },
      { label: "Adversarial Review", description: "Agent A proposes -> Agent B attacks (Red Team) -> Agent A defends." },
      { label: "Troubleshoot Session", description: "Multi-agent hypothesis testing for emergency bugs." },
      { label: "Single Handshake", description: "Standard one-turn second opinion." }
    ]
  }]
});
```

## Workflows

### 1. Handshake Protocol (Standard)
| Agent | Initial Command | Follow-up (Handshake) |
| :--- | :--- | :--- |
| **Gemini** | `gemini -p "..."` | `gemini --resume latest -p "..."` |
| **Qwen** | `qwen "..."` | `qwen -c "..."` |

### 2. Multi-Turn Loops
For complex scenarios, follow the turns defined in [references/workflows.md](references/workflows.md).

```
Loop Progress:
- [ ] Turn 1: Proposal (Agent A)
- [ ] Turn 2: Cross-Examination (Agent B)
- [ ] Turn 3: Final Synthesis (Agent A)
```

## Resources

- **Workflows**: See [references/workflows.md](references/workflows.md) for turn-by-turn logic.
- **Config**: Patterns and priority are defined in [config.yaml](config.yaml).
- **Examples**: See [references/examples.md](references/examples.md) for concrete patterns.
- **Handover**: See [references/handover-protocol.md](references/handover-protocol.md) for command flags.

## Best Practices
- **Concise Context**: Send only relevant snippets, not entire files, to the neighboring agent.
- **Specific Tasks**: Ask for a "Security Audit" or "Refactoring Suggestions" rather than a general review.
- **Fail-Safe**: If a neighboring agent is not found, proceed with a self-review but notify the user.