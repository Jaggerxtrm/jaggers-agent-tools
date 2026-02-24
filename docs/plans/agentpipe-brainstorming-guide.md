# AgentPipe Brainstorming Session: Service Skills Implementation

## Quick Start

```bash
# Run the 3-agent brainstorming session
agentpipe run -c docs/plans/agentpipe-brainstorming-session.yaml --tui --metrics
```

## Configuration Overview

This AgentPipe configuration orchestrates a **multi-agent design discussion** between:

| Agent | Type | Role | Focus |
|-------|------|------|-------|
| **Gemini Architect** | Gemini | Architecture & Patterns | High-level design, separation of concerns, hook strategy |
| **Gemini Implementation** | Gemini | Implementation & Best Practices | File structures, SKILL.md authoring, hook configs |
| **Qwen Integrator** | Qwen | Integration & Standards | Cross-agent compatibility, standards validation |

## Session Parameters

### Orchestrator Settings
```yaml
mode: round-robin        # Agents take turns in fixed order
max_turns: 12            # 4 turns per agent = ~30-45 min discussion
turn_timeout: 120s       # 2 minutes per agent response
response_delay: 1s       # Minimal delay between responses
```

### Why These Parameters?

- **round-robin**: Ensures each expert contributes equally to each topic
- **12 turns**: Enough depth without excessive token consumption
- **120s timeout**: Complex architectural decisions need thinking time
- **JSON logging**: Enables post-session analysis and extraction

## Discussion Topics

The session will cover these 6 critical design areas:

### 1. Architecture (Gemini Architect leads)
- High-level design for creating-service-skills, updating-service-skills, using-service-skills
- Separation of concerns between skills
- Token efficiency targets (<500 lines per SKILL.md)
- Progressive disclosure strategy

### 2. File Structure (Gemini Implementation leads)
- Directory layout for each skill
- SKILL.md frontmatter (name, description, allowed-tools, hooks)
- Supporting files (reference.md, examples.md, scripts/)
- Naming conventions (gerund form)

### 3. Hook Strategy (Gemini Architect + Qwen Integrator)
- Which hooks for which skill
- Event triggers (session-start, PreToolUse, PostToolUse, Stop)
- Matcher patterns for performance
- Injection mechanism for using-service-skills

### 4. Agent-Agnostic Pattern (All agents)
- **Problem**: Current sync skill hardcodes `.claude` paths
- **Solution**: Generic directory structure from project root
- Utility scripts accessible by claude/gemini/qwen
- Avoids 4x script duplication

### 5. Injection Mechanism (Qwen Integrator leads)
- How using-service-skills mirrors using-superpowers
- Session-start hook for forced injection
- Service skill registry/discovery
- List of available skills per agent

### 6. Standards Compliance (Qwen Integrator validates)
All proposals MUST align with:
- `claude-skills.md` - Skill structure, frontmatter, allowed-tools
- `extend-claude-with-skills.md` - Invocation control, context fork
- `skills-authoring-guide-anthropics.md` - Best practices, progressive disclosure
- `Creating Agent Skills.md` - Gemini-specific requirements
- `Hooks Best Practices.md` - Performance, security, matchers

## Expected Deliverables

By session end, you should have consensus on:

### ✅ Architecture Decision Record
```markdown
## creating-service-skills
- Purpose: Generate skill skeletons, aggregate by logical ownership
- Triggers: Manual invocation via /creating-service-skills
- Context: fork (isolated subagent)
- allowed-tools: Write, Bash(python *), Glob

## updating-service-skills
- Purpose: Update existing service skills
- Triggers: Manual invocation via /updating-service-skills
- Similar to: /documenting skill pattern
- allowed-tools: Read, Write, Grep

## using-service-skills
- Purpose: Explain usage, list available service skills
- Triggers: Auto-injected at session-start (like using-superpowers)
- Context: inline (knowledge only)
- Injection: session-start hook with forced discovery
```

### ✅ File Structure
```
.service-skills/                    # Agent-agnostic root (NOT .claude/)
├── creating-service-skills/
│   ├── SKILL.md
│   ├── templates/
│   │   ├── claude-skill-template.md
│   │   └── gemini-skill-template.md
│   └── scripts/
│       └── generate-skeleton.py
│
├── updating-service-skills/
│   ├── SKILL.md
│   └── scripts/
│       └── update-skill.py
│
└── using-service-skills/
    ├── SKILL.md
    └── reference/
        └── available-skills.md     # Dynamically generated
```

### ✅ Hook Configuration
```json
{
  "hooks": {
    "SessionStart": [
      {
        "name": "inject-using-service-skills",
        "type": "command",
        "command": "$PROJECT_ROOT/.service-skills/using-service-skills/scripts/inject-skills.sh",
        "description": "Inject available service skills at session start"
      }
    ]
  }
}
```

### ✅ Agent-Agnostic Script Pattern
```python
# db_query.py - Agent-agnostic utility
#!/usr/bin/env python3
"""
Utility script accessible by any agent (claude/gemini/qwen).
Located in project root, NOT in .claude/ or .gemini/
"""

import os
from pathlib import Path

# Agent-agnostic path resolution
PROJECT_ROOT = Path(__file__).parent.parent
DATA_DIR = PROJECT_ROOT / "data"  # Generic, not .claude/data

def query_database(sql: str) -> list:
    """Execute SQL query and return results."""
    # Implementation here
```

## Pre-Session Preparation

### 1. Review Reference Documents
Before running the session, ensure you've read:
- [x] `docs/reference/claude-documentation/claude-skills.md`
- [x] `docs/reference/claude-documentation/extend-claude-with-skills.md`
- [x] `docs/reference/claude-documentation/skills-authoring-guide-anthropics.md`
- [x] `docs/reference/gemini-documentation/Creating Agent Skills.md`
- [x] `docs/reference/gemini-documentation/Hooks Best Practices.md`
- [x] `docs/plans/service-skill-improvement.md` (problem statement)

### 2. Install AgentPipe
```bash
# macOS/Linux
brew install agentpipe

# Or from source
git clone https://github.com/kevinelliott/agentpipe.git
cd agentpipe
go build -o agentpipe .
```

### 3. Verify Agents Available
```bash
agentpipe doctor
```

Ensure both `gemini` and `qwen` agents are configured.

## Running the Session

### Basic Execution
```bash
# Run with TUI (recommended for real-time viewing)
agentpipe run -c docs/plans/agentpipe-brainstorming-session.yaml --tui

# Run with metrics (for token/cost tracking)
agentpipe run -c docs/plans/agentpipe-brainstorming-session.yaml --metrics

# Run with both
agentpipe run -c docs/plans/agentpipe-brainstorming-session.yaml --tui --metrics
```

### Save Session State
```bash
# Save conversation state for later resumption
agentpipe run -c docs/plans/agentpipe-brainstorming-session.yaml \
  --save-state \
  --state-file docs/plans/brainstorming-state.json
```

### Resume Interrupted Session
```bash
agentpipe resume --state-file docs/plans/brainstorming-state.json
```

### Export Results
```bash
# Export to Markdown
agentpipe export --state-file docs/plans/brainstorming-state.json \
  --format markdown \
  --output docs/plans/brainstorming-results.md

# Export to JSON
agentpipe export --state-file docs/plans/brainstorming-state.json \
  --format json \
  --output docs/plans/brainstorming-results.json
```

## Post-Session Workflow

### 1. Extract Consensus Decisions
```bash
# Search for consensus markers in results
grep -A 5 "CONSENSUS\|AGREED\|DECISION" docs/plans/brainstorming-results.md
```

### 2. Create Implementation Plan
Based on session output, create:
- `docs/plans/service-skills-implementation.md` - Detailed implementation plan
- `.service-skills/creating-service-skills/SKILL.md` - First skill
- `.service-skills/updating-service-skills/SKILL.md` - Second skill
- `.service-skills/using-service-skills/SKILL.md` - Third skill

### 3. Validate Against Standards
Use Qwen Integrator's validation checklist:
- [ ] SKILL.md under 500 lines
- [ ] Description includes what + when (1024 char max)
- [ ] allowed-tools specified appropriately
- [ ] Hooks follow best practices (matchers, caching, timeouts)
- [ ] Progressive disclosure used for complex content
- [ ] Agent-agnostic paths (no .claude/ or .gemini/ hardcoded)

## Advanced Configuration Options

### Customize Agent Models
```yaml
agents:
  - id: gemini-architect
    type: gemini
    model: gemini-2.5-pro
    name: "Gemini Architect"
    # ... rest of config
```

### Adjust Conversation Mode
```yaml
orchestrator:
  mode: reactive    # More dynamic turn-taking based on content
  # mode: round-robin  # Fixed order (recommended for structured discussion)
  # mode: free-form  # Least structured, agents respond as they see fit
```

### Enable Real-Time Streaming
```yaml
bridge:
  enabled: true
  url: https://agentpipe.ai
  api_key: your-api-key
```

## Troubleshooting

### Agent Not Responding
```bash
# Check agent health
agentpipe doctor

# Verify API keys
echo $GEMINI_API_KEY
echo $QWEN_API_KEY
```

### Session Timing Out
```yaml
# Increase timeout in config
orchestrator:
  turn_timeout: 180s  # 3 minutes instead of 2
```

### Config Not Loading
```bash
# Validate YAML syntax
python -c "import yaml; yaml.safe_load(open('docs/plans/agentpipe-brainstorming-session.yaml'))"
```

## Cost Estimation

Based on AgentPipe metrics:
- **Gemini**: ~500-800 tokens/turn × 4 turns = 2,000-3,200 tokens
- **Qwen**: ~500-800 tokens/turn × 4 turns = 2,000-3,200 tokens
- **Total**: ~4,000-6,400 tokens per session

With 12 turns max, expect **~5,000-8,000 tokens** total (including orchestrator overhead).

## Alternative: Manual Prompt Format

If you prefer to run the discussion manually without AgentPipe:

```markdown
# Multi-Agent Brainstorming Prompt

You are participating in a 3-agent design discussion. Respond as your assigned role:

## AGENT ROLES

**Gemini Architect**: Senior software architect specializing in AI agent systems
**Gemini Implementation**: Implementation specialist focused on skill development
**Qwen Integrator**: Integration specialist ensuring cross-agent compatibility

## DISCUSSION TOPIC

[Copy initial_prompt from YAML config]

## STANDARDS REFERENCES

[Link to docs/reference/ documents]

## DISCUSSION FORMAT

Each agent should:
1. Analyze from your expertise area
2. Propose specific solutions with standard references
3. Build on previous ideas
4. Challenge assumptions violating standards
5. Work toward implementable consensus

Begin with Gemini Architect proposing high-level architecture.
```

## Next Steps After Session

1. **Review Results**: Export and read brainstorming-results.md
2. **Extract Decisions**: Create architecture decision record
3. **Implement Skills**: Follow the agreed file structure and hook configs
4. **Test**: Verify each skill works in claude, gemini, and qwen
5. **Document**: Update docs/reference/ with new patterns discovered

---

## References

- [AgentPipe Documentation](https://github.com/kevinelliott/agentpipe)
- [Service Skills Problem Statement](./service-skill-improvement.md)
- [Claude Skills Authoring Guide](../reference/claude-documentation/skills-authoring-guide-anthropics.md)
- [Gemini Hooks Best Practices](../reference/gemini-documentation/Hooks%20Best%20Practices.md)
- [Skill Roadmap](../reference/plans/skill-roadmap.md)
