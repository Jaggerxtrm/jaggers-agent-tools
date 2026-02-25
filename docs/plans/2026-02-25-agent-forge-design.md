# Agent Forge — Product Requirements Document

**Date**: 2026-02-25
**Status**: Approved
**Version**: 1.1.0

## 1. Identity & Core Concept

**Name**: Agent Forge
**One-liner**: A CLI/TUI orchestrator for AI agents using tmux as execution layer, declarative protocols for communication, and a boss/worker model for coordination.

**Product type**: Standalone CLI/TUI tool, distributed via npm, built with TypeScript/Bun.

**Replaces**: Agent Deck (session management), evolves delegating + orchestrating-agents skills into protocol definitions.

### Mental Model

```
+---------------------------------------------------+
|                  AGENT FORGE                        |
|                                                     |
|  LAYER 4: UI (optional)                             |
|  +- TUI Dashboard  (Ink)                            |
|  +- CLI commands   (headless)                       |
|  +- Registry Browser (specialists/protocols/etc.)   |
|  +- tmux status-bar (always-on indicator)           |
|                                                     |
|  LAYER 3: Orchestration                             |
|  +- Protocol Engine  (workflow turn definitions)    |
|  +- Routing Engine   (pattern -> agent/protocol)    |
|  +- Message Bus      (tmux pipe + file log)         |
|                                                     |
|  LAYER 2: Execution                                 |
|  +- Session Store    (who is running, state)        |
|  +- tmux Manager     (session CRUD, capture, send)  |
|  +- af_claude, af_gemini, af_qwen, af_glm          |
|                                                     |
|  LAYER 1: Identity & Knowledge                      |
|  +- Agent Profiles   (Body: how to start/resume)    |
|  +- Specialist Defs  (Brain: .specialist.yaml)      |
|  +- Agent Registry   (profile + specialist loader)  |
+---------------------------------------------------+
```

### Design Principles

1. **Headless-first**: Every operation works via CLI. The TUI is a bonus.
2. **tmux as infrastructure**: Don't reinvent the terminal — orchestrate it.
3. **Declarative protocols**: Workflows (collaborative, adversarial, etc.) are defined in YAML, not hardcoded.
4. **Agent-agnostic**: A profile YAML defines how to start/resume/kill any agent.
5. **Resilience**: If the forge process dies, agents continue in tmux. `forge attach` reconnects.
6. **Brain + Body**: Profiles define the Body (how to run an agent), Specialists define the Brain (what an agent knows). Both are YAML, both are composable.

---

## 2. Agent Registry & Profiles

Every agent is defined by a profile. Built-in profiles for Claude, Gemini, Qwen, CCS-GLM. Users can add custom profiles.

### Profile Schema

```yaml
# profiles/claude.yaml
id: claude
name: "Claude Code"
role: boss                  # boss | worker | hybrid
commands:
  start: "claude --session-id ${SESSION_ID}"
  start_with_prompt: "claude --session-id ${SESSION_ID} -p '${PROMPT}'"
  resume: "claude --session-id ${SESSION_ID} --resume"
  print_mode: "claude -p '${PROMPT}'"
env:
  CLAUDECODE: ""            # unset to avoid nested session guard
detection:
  ready_patterns:
    - "^>"
    - "\\$"
  busy_patterns:
    - "\\u280B|\\u2819|\\u2839|\\u2838"
    - "Thinking"
    - "Running"
  error_patterns:
    - "Error:"
    - "FATAL"
  poll_interval_ms: 2000
tmux:
  prefix: "af_"
  pane_options:
    scrollback: 10000
```

```yaml
# profiles/gemini.yaml
id: gemini
name: "Gemini CLI"
role: worker
commands:
  start: "gemini"
  start_with_prompt: "gemini -p '${PROMPT}'"
  resume: "gemini -r ${SESSION_REF} -p '${PROMPT}'"
  print_mode: "gemini -p '${PROMPT}'"
env: {}
detection:
  ready_patterns:
    - "^>"
  busy_patterns:
    - "Generating"
  poll_interval_ms: 3000
```

```yaml
# profiles/qwen.yaml
id: qwen
name: "Qwen CLI"
role: worker
commands:
  start: "qwen"
  start_with_prompt: "qwen '${PROMPT}'"
  resume: "qwen -c '${PROMPT}'"
  print_mode: "qwen '${PROMPT}'"
env: {}
detection:
  ready_patterns:
    - "^>"
  busy_patterns:
    - "Thinking"
  poll_interval_ms: 3000
```

```yaml
# profiles/ccs-glm.yaml
id: ccs-glm
name: "CCS GLM-4"
role: worker
commands:
  start: "env -u CLAUDECODE ccs glm"
  start_with_prompt: "env -u CLAUDECODE ccs glm -p '${PROMPT}'"
  resume: null              # GLM does not support resume
  print_mode: "env -u CLAUDECODE ccs glm -p '${PROMPT}'"
env:
  CLAUDECODE: ""
detection:
  ready_patterns:
    - "^>"
  busy_patterns:
    - "\\u280B|\\u2819|\\u2839|\\u2838"
  poll_interval_ms: 2000
```

### Profile Fields

| Field | Description |
|-------|-------------|
| `id` | Unique identifier used in CLI commands |
| `name` | Human-readable display name |
| `role` | `boss` (one, orchestrator), `worker` (executes tasks), `hybrid` (both) |
| `commands.start` | Launch agent without initial prompt |
| `commands.start_with_prompt` | Launch agent with a task |
| `commands.resume` | Resume a previous session (null if unsupported) |
| `commands.print_mode` | Fire-and-forget execution (no persistent session) |
| `env` | Environment variables to set/unset |
| `detection.ready_patterns` | Regex patterns indicating agent is idle/ready |
| `detection.busy_patterns` | Regex patterns indicating agent is processing |
| `detection.error_patterns` | Regex patterns indicating an error state |
| `detection.poll_interval_ms` | Status polling frequency |
| `tmux.prefix` | tmux session name prefix (default: `af_`) |
| `tmux.pane_options.scrollback` | Scrollback buffer size |

### Custom Profiles

```bash
agent-forge profile add --name "codex" --start "codex" --prompt-flag "-p"
# Generates profiles/codex.yaml with template and detection defaults

agent-forge profile test gemini  # Verify agent works
agent-forge profile list         # List all profiles
agent-forge profile show gemini  # Show profile details
```

---

## 3. Session Management & State

### Session Lifecycle

```
created -> booting -> ready -> working -> idle -> (working -> idle)* -> completed
                                                                     -> error
                                                                     -> killed
                                   zombie <- (tmux session died unexpectedly)
```

### Session Store (SQLite)

```sql
CREATE TABLE sessions (
  id            TEXT PRIMARY KEY,      -- uuid
  agent_id      TEXT NOT NULL,         -- "claude", "gemini", etc.
  specialist_id TEXT,                  -- "mercury-db-health" (null if no specialist)
  role          TEXT NOT NULL,         -- "boss", "worker"
  tmux_session  TEXT NOT NULL,         -- "af_claude_abc123"
  status        TEXT NOT NULL,         -- lifecycle state
  task          TEXT,                  -- what was this agent asked to do
  parent_id     TEXT,                  -- who spawned this agent (null for boss)
  started_at    DATETIME,
  updated_at    DATETIME,
  ended_at      DATETIME,
  exit_reason   TEXT,                  -- "completed", "killed", "error", "zombie"
  log_file      TEXT                   -- path to output log
);

CREATE TABLE messages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  from_session  TEXT NOT NULL,
  to_session    TEXT NOT NULL,
  type          TEXT NOT NULL,         -- "task", "result", "status", "follow_up"
  content       TEXT NOT NULL,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  read          BOOLEAN DEFAULT FALSE
);
```

### State Reconciliation

1. **tmux is truth for liveness** — if the tmux session doesn't exist, the agent is dead.
2. **SQLite is truth for semantics** — assigned task, messages, parent/child relationships.
3. **Reconciliation loop** (every 5s):
   ```
   for each session in SQLite with status != completed/killed/error:
     if tmux session does not exist:
       mark as "zombie"
       notify user
   ```

### Persistence & Resume

```bash
# Detach TUI, agents continue in tmux
agent-forge detach

# Reconnect — reads state from SQLite, verifies tmux sessions
agent-forge attach

# List sessions (even from another terminal)
agent-forge sessions
# ID         AGENT    STATUS    TASK                        AGE
# abc123     claude   working   "review auth module"        12m
# def456     gemini   idle      "design database schema"    8m
# ghi789     qwen     completed "validate commit security"  3m
```

### Log Files

Every session writes output to a log file:
```
~/.agent-forge/logs/
+-- abc123-claude.log      # full terminal capture
+-- def456-gemini.log
+-- ghi789-qwen.log
```

Captured via `tmux pipe-pane` — continuous log of pane content, independent of the TS process.

---

## 4. Communication Protocol

Three communication channels form the core of inter-agent communication.

### Channel Architecture

| Channel | Mechanism | Purpose | Persistence |
|---------|-----------|---------|-------------|
| **Send** | `tmux send-keys` | Inject text into agent stdin | No (real-time) |
| **Read** | `tmux capture-pane` | Read agent screen content | No (snapshot) |
| **Log** | SQLite + file logs | Record all exchanges | Yes (persistent) |

### Send Protocol

```typescript
async function sendToAgent(sessionId: string, message: string): Promise<void> {
  const session = await store.getSession(sessionId);

  // 1. Wait until agent is ready (not busy)
  await waitForReady(session, { timeout: 30_000 });

  // 2. Send via tmux
  tmux.sendKeys(session.tmux_session, message);

  // 3. Log the message
  await store.addMessage({
    from: currentSession.id,
    to: sessionId,
    type: "task",
    content: message,
  });

  // 4. Update session status
  await store.updateSession(sessionId, { status: "working" });
}
```

### Wait-for-Ready

Inspired by Agent Deck's 3-tier status detection:

```typescript
async function waitForReady(
  session: Session,
  opts: { timeout: number }
): Promise<void> {
  const profile = registry.getProfile(session.agent_id);
  const deadline = Date.now() + opts.timeout;

  while (Date.now() < deadline) {
    const paneContent = tmux.capturePane(session.tmux_session);
    const lastLines = paneContent.split("\n").slice(-5).join("\n");

    if (
      profile.detection.ready_patterns.some((p) =>
        new RegExp(p).test(lastLines)
      )
    ) {
      return; // Agent is ready
    }

    if (
      profile.detection.error_patterns?.some((p) =>
        new RegExp(p).test(lastLines)
      )
    ) {
      throw new AgentError(session, "Agent in error state");
    }

    await sleep(profile.detection.poll_interval_ms);
  }

  throw new TimeoutError(session, opts.timeout);
}
```

### Read Protocol

```typescript
async function readFromAgent(
  sessionId: string,
  opts?: { tail?: number }
): Promise<string> {
  const session = await store.getSession(sessionId);

  // Option A: Real-time (last N lines from pane)
  if (opts?.tail) {
    return tmux.capturePane(session.tmux_session, {
      lastLines: opts.tail,
    });
  }

  // Option B: Full log (from file)
  return fs.readFile(session.log_file, "utf-8");
}
```

---

## 5. Protocol Engine

Declarative YAML protocols define multi-turn orchestration workflows. This is where the existing `delegating/config.yaml` and `orchestrating-agents/references/workflows.md` migrate to.

### Protocol YAML Format

```yaml
# protocols/collaborative.yaml
name: collaborative
description: "Multi-turn design session"
version: 1
default_agents:
  a: gemini
  b: qwen

parameters:
  - name: task
    type: string
    required: true
  - name: context
    type: string
    required: false

turns:
  - id: design
    agent: ${a}
    action: start_with_prompt
    prompt_template: |
      Design a solution for: ${task}
      Requirements: ${context}
    wait_for: ready
    capture_output: true
    output_var: design

  - id: critique
    agent: ${b}
    action: start_with_prompt
    prompt_template: |
      Review this design critically. Find edge cases and issues:
      ${design}
    wait_for: ready
    capture_output: true
    output_var: critique

  - id: refine
    agent: ${a}
    action: resume
    prompt_template: |
      Address these critiques and provide the refined design:
      ${critique}
    wait_for: ready
    capture_output: true
    output_var: final_design

result:
  template: |
    ## Collaborative Design Results

    ### Initial Design
    ${design}

    ### Critique
    ${critique}

    ### Refined Design
    ${final_design}
```

```yaml
# protocols/adversarial.yaml
name: adversarial
description: "Red-team security audit with attack/defense rounds"
version: 1
default_agents:
  attacker: gemini
  defender: qwen

parameters:
  - name: target
    type: string
    required: true
  - name: focus
    type: choice
    choices: [security, performance, correctness]
    default: security

turns:
  - id: initial_review
    agent: ${defender}
    action: start_with_prompt
    prompt_template: |
      Perform a ${focus} review of this code. Identify strengths and potential issues:
      ${target}
    capture_output: true
    output_var: initial_review

  - id: red_team
    agent: ${attacker}
    action: start_with_prompt
    prompt_template: |
      Act as a red team reviewer. Find 3 ways to break or exploit this:
      ${target}

      The initial review found:
      ${initial_review}
    capture_output: true
    output_var: attacks

  - id: defense
    agent: ${defender}
    action: resume
    prompt_template: |
      Defend against these attacks or provide patches:
      ${attacks}
    capture_output: true
    output_var: defense

result:
  template: |
    ## Adversarial Review Results

    ### Initial Review
    ${initial_review}

    ### Attack Vectors
    ${attacks}

    ### Defense & Patches
    ${defense}
```

```yaml
# protocols/troubleshoot.yaml
name: troubleshoot
description: "Root cause analysis with hypothesis testing"
version: 1
default_agents:
  a: gemini
  b: qwen

parameters:
  - name: symptoms
    type: string
    required: true
  - name: code
    type: string
    required: false

turns:
  - id: hypothesize
    agent: ${a}
    action: start_with_prompt
    prompt_template: |
      Analyze these symptoms and provide 3 hypotheses with verification steps:
      ${symptoms}
    capture_output: true
    output_var: hypotheses

  - id: verify
    agent: ${b}
    action: start_with_prompt
    prompt_template: |
      Verify Hypothesis #1 using the provided code:
      ${hypotheses}
      Code: ${code}
    capture_output: true
    output_var: verification

  - id: root_cause
    agent: ${a}
    action: resume
    prompt_template: |
      Based on verification results, provide final root cause and remediation:
      ${verification}
    capture_output: true
    output_var: root_cause

  - id: validate_fix
    agent: ${b}
    action: resume
    prompt_template: |
      Validate the proposed fix is correct and complete:
      ${root_cause}
    capture_output: true
    output_var: validation

result:
  template: |
    ## Troubleshoot Results

    ### Hypotheses
    ${hypotheses}

    ### Verification
    ${verification}

    ### Root Cause & Remediation
    ${root_cause}

    ### Fix Validation
    ${validation}
```

```yaml
# protocols/handshake.yaml
name: handshake
description: "Quick one-turn second opinion"
version: 1
default_agents:
  a: gemini
  b: qwen

parameters:
  - name: task
    type: string
    required: true

turns:
  - id: propose
    agent: ${a}
    action: start_with_prompt
    prompt_template: |
      ${task}
    capture_output: true
    output_var: proposal

  - id: validate
    agent: ${b}
    action: start_with_prompt
    prompt_template: |
      Review and validate this. Provide a concise verdict (APPROVED / NEEDS CHANGES):
      ${proposal}
    capture_output: true
    output_var: verdict

result:
  template: |
    ## Handshake Results

    ### Proposal
    ${proposal}

    ### Verdict
    ${verdict}
```

### Routing Engine

Migrated from `delegating/config.yaml`:

```yaml
# config/routing.yaml
rules:
  - patterns: ["typo|spelling", "test|unit.*test", "format|lint"]
    action: spawn
    agent: ccs-glm
    cost: low

  - patterns: ["think|analyze|reason", "explain|describe"]
    action: spawn
    agent: gemini
    cost: medium

  - patterns: ["review.*(code|security)", "security.*(audit|review)"]
    action: protocol
    protocol: adversarial
    agents: { attacker: gemini, defender: qwen }
    cost: high

  - patterns: ["implement.*feature", "build.*feature"]
    action: protocol
    protocol: collaborative
    agents: { a: gemini, b: qwen }
    cost: high

  - patterns: ["debug|crash|error", "root.*cause"]
    action: protocol
    protocol: troubleshoot
    agents: { a: gemini, b: qwen }
    cost: high

default:
  action: spawn
  agent: ccs-glm

exclusions:
  - "architecture.*decision"
  - "security.*critical"
```

---

## 6. CLI Interface

### Command Structure

```
agent-forge
+-- init                    # Initialize project (.agent-forge/, profiles/)
+-- start [--boss <agent>]  # Start boss session (default: claude)
+-- spawn <agent> [prompt]  # Start worker agent with optional task
|   +-- --specialist <name> # Load specialist brain (system prompt, config)
+-- send <agent> <message>  # Send message to agent (wait-for-ready)
+-- read <agent> [--tail N] # Read agent output (pane or log)
+-- status [agent]          # Status of all/one
+-- sessions                # List sessions with details
+-- kill <agent|session-id> # Kill agent
+-- kill-all                # Kill all agents
+-- attach                  # Reconnect to existing sessions
+-- detach                  # Disconnect TUI, agents continue
+-- logs <agent> [--follow] # Stream log file
|
+-- run <protocol> [opts]   # Execute orchestration protocol
|   +-- --agents a=gemini,b=qwen
|   +-- --task "description"
|   +-- --context "file or text"
|
+-- profile                 # Profile management
|   +-- list
|   +-- add
|   +-- test <agent>
|   +-- show <agent>
|
+-- protocol                # Protocol management
|   +-- list
|   +-- show <name>
|   +-- validate <file>
|
+-- specialist              # Specialist management
|   +-- list [--scope sys|user|project]  # List available specialists
|   +-- show <name>         # Show specialist details (frontmatter + prompt preview)
|   +-- create [--from-skill <name>]     # Create new specialist (interactive or from skill)
|   +-- validate <file>     # Validate .specialist.yaml schema
|   +-- check-health        # Run staleness detection on all specialists
|
+-- registry                # Unified view of all resources
|   +-- list                # List all profiles, protocols, specialists, skills
|   +-- search <query>      # Search across all resources by name/description
|
+-- tui                     # Launch TUI dashboard
|
+-- config                  # Global configuration
    +-- show
    +-- set <key> <value>
```

### Usage Examples

```bash
# Basic: start boss, delegate tasks
agent-forge start                              # start Claude as boss
agent-forge spawn gemini "review auth module"  # spawn Gemini worker
agent-forge status                             # check state
agent-forge read gemini --tail 20              # read last 20 lines output
agent-forge send gemini "also check for XSS"  # follow-up

# Orchestrated: execute declarative protocol
agent-forge run collaborative \
  --agents a=gemini,b=qwen \
  --task "Design rate limiting for API" \
  --context "$(cat src/api/routes.ts)"

# Resume
agent-forge sessions                           # see active sessions
agent-forge attach                             # open TUI with existing sessions

# Profile management
agent-forge profile test gemini                # verify gemini works
agent-forge profile add --name cursor \
  --start "cursor-agent" \
  --prompt-flag "--ask"
```

### Specialist-Driven Examples

```bash
# Spawn with specialist brain — agent gets domain-specific system prompt
agent-forge spawn gemini --specialist mercury-db-health "Check connection pools"

# List available specialists grouped by scope
agent-forge specialist list
# SYSTEM (built-in)
#   code-reviewer       "General-purpose code review specialist"
# USER (~/.agent-forge/specialists/)
#   doc-writer          "Technical documentation specialist"
# PROJECT (.agent-forge/specialists/)
#   mercury-db-health   "Monitors Mercury PostgreSQL health"
#   mercury-ingestion   "Monitors ingestion pipeline health"

# Run protocol with specialist-equipped agents
agent-forge run adversarial \
  --agents attacker=gemini,defender=qwen \
  --specialist:attacker=security-auditor \
  --specialist:defender=mercury-api-guard \
  --task "Review payment endpoint" \
  --context "$(cat src/api/payment.ts)"

# Check specialist staleness (files_to_watch changed since last update)
agent-forge specialist check-health
# mercury-db-health: OK (updated 3d ago)
# mercury-ingestion: STALE (database/models.py changed 2d after specialist update)
```

### Integration with Claude (the boss)

Claude can use agent-forge via Bash tool from within its session:

```bash
# Claude executes via Bash:
agent-forge spawn gemini "Review this code for security: $(cat src/auth.ts)"
# Wait...
agent-forge read gemini
# Reads the result and integrates it into its reasoning
```

This directly replaces the `gemini -p "..."` pattern from current skills, adding persistence, status tracking, and logging.

---

## 7. TUI Dashboard

The TUI is a "view" on the state — not the main process. Launched with `agent-forge tui`.

### Layout

```
+- agent-forge -------------------------------------------------+
| +- Fleet ----------------+ +- Active Agent ----------------+ |
| |                        | |                                | |
| |  * claude   working 4m | |  [claude] session: af_claude_x | |
| |  o gemini   idle    2m | |                                | |
| |  . qwen     ready   0m | |  > I'll delegate the security | |
| |    glm      --      -- | |    review to gemini and the   | |
| |                        | |    quality check to qwen...   | |
| |  [up/down] navigate    | |                                | |
| |  [enter] focus         | |  Last output (tail):          | |
| |  [s] spawn             | |  Created review protocol...   | |
| |  [k] kill              | |  Spawning gemini worker...    | |
| |  [m] send message      | |                                | |
| +------------------------+ +--------------------------------+ |
| +- Messages --------------+ +- Protocol ------------------+ |
| | 14:23 claude->gemini    | | collaborative (running)      | |
| |   "Review auth module"  | | +- Turn 1 OK  gemini design  | |
| | 14:25 gemini->claude    | | +- Turn 2 ... qwen critique  | |
| |   "Found 3 issues..."   | | +- Turn 3 ___ gemini refine  | |
| | 14:26 claude->qwen      | |                               | |
| |   "Validate fixes..."   | | Elapsed: 4m 23s               | |
| +-------------------------+ +-------------------------------+ |
| [F1]Help [F2]Fleet [F3]Send [F4]Protocol [F5]Logs [F6]Registry [q]Quit |
+------------------------------------------------------------------------+
```

### Registry Panel (F6)

```
+- Registry [F6] ─────────────────────────────────────────+
| SPECIALISTS                    | DETAILS                 |
|   system (2)                   | mercury-db-health v1.2  |
|     code-reviewer              | "Monitors Mercury       |
|     security-auditor           |  PostgreSQL health..."  |
|   user (1)                     |                         |
|     doc-writer                 | Profile: gemini         |
|   project (3)                  | Model: gemini-2.0-flash |
|   > mercury-db-health          | Stale: NO (3d ago)      |
|     mercury-ingestion          | Watches: models.py      |
|     mercury-api-guard          |                         |
| PROTOCOLS (4)                  | [s] spawn with this     |
|   collaborative                | [e] edit yaml           |
|   adversarial                  | [v] view full yaml      |
|   troubleshoot                 | [c] check health        |
|   handshake                    |                         |
| PROFILES (4)                   |                         |
|   claude, gemini, qwen, glm   |                         |
| SKILLS (read-only, detected)   |                         |
|   delegating, orchestrating... |                         |
+-────────────────────────────────────────────────────────+
```

The Registry panel discovers and displays all resources from three scopes:
- **System**: Built-in, shipped with agent-forge
- **User**: `~/.agent-forge/{specialists,protocols,profiles}/`
- **Project**: `.agent-forge/{specialists,protocols,profiles}/`
- **Skills** (read-only): Detected from `~/.claude/skills/` and `.claude/skills/`

Each resource shows its frontmatter metadata (name, version, description, category).

### Panels

| Panel | Content | Update mechanism |
|-------|---------|------------------|
| **Fleet** | Agent list with status, duration, role, specialist | Poll every 2-5s (detection patterns) |
| **Active Agent** | Output tail of selected agent | tmux capture-pane streaming |
| **Messages** | Inter-agent message log | SQLite messages table |
| **Protocol** | Running protocol state (completed/in-progress turns) | Orchestrator state |
| **Registry** | All specialists, protocols, profiles, skills with details | File scan on open + manual refresh |

### Keybindings

| Key | Action |
|-----|--------|
| `Up/Down` | Navigate fleet |
| `Enter` | Focus agent (full-screen output) |
| `s` | Spawn new worker (interactive prompt) |
| `k` | Kill selected agent (with confirmation) |
| `m` | Send message to selected agent |
| `r` | Run protocol (workflow + agent selection) |
| `l` | Open log file in `$PAGER` |
| `t` | Toggle: switch to direct tmux pane (Ctrl+B to return) |
| `F5` | Full-screen log view |
| `F6` | Toggle Registry panel (browse specialists/protocols/profiles/skills) |
| `q` | Quit TUI (agents continue in background) |

### tmux Pass-Through

Pressing `t` on a selected agent hides the TUI and drops you into the agent's tmux pane for direct interaction. A predefined key combination returns to the TUI. This bridges monitoring and direct interaction.

### Technology

Ink (React for terminals) for the TUI framework. Components built with `ink-box`, `ink-table`, and custom hooks for session state and agent output streaming.

---

## 8. Project Structure

```
agent-forge/
+-- package.json
+-- bunfig.toml
+-- tsconfig.json
+-- README.md
+-- LICENSE
|
+-- src/
|   +-- index.ts                    # CLI entry point
|   +-- cli/
|   |   +-- commands/               # Commander.js command definitions
|   |   |   +-- start.ts
|   |   |   +-- spawn.ts
|   |   |   +-- send.ts
|   |   |   +-- read.ts
|   |   |   +-- status.ts
|   |   |   +-- run.ts              # Protocol execution
|   |   |   +-- profile.ts
|   |   |   +-- protocol.ts
|   |   |   +-- tui.ts
|   |   |   +-- sessions.ts
|   |   +-- parser.ts
|   |
|   +-- core/
|   |   +-- orchestrator.ts         # Main orchestration logic
|   |   +-- session-store.ts        # SQLite session management
|   |   +-- message-bus.ts          # Inter-agent messaging
|   |   +-- registry.ts             # Agent profile registry
|   |   +-- protocol-engine.ts      # YAML protocol executor
|   |   +-- specialist-loader.ts    # .specialist.yaml discovery, validation, rendering
|   |
|   +-- tmux/
|   |   +-- manager.ts              # tmux session CRUD
|   |   +-- detector.ts             # Status detection (pane content)
|   |   +-- capture.ts              # capture-pane + pipe-pane
|   |   +-- layout.ts               # Layout presets
|   |
|   +-- tui/
|   |   +-- app.tsx                 # Ink root component
|   |   +-- components/
|   |   |   +-- fleet-panel.tsx
|   |   |   +-- agent-view.tsx
|   |   |   +-- messages-panel.tsx
|   |   |   +-- protocol-panel.tsx
|   |   |   +-- registry-panel.tsx  # Browse specialists/protocols/profiles/skills
|   |   |   +-- status-bar.tsx
|   |   +-- hooks/
|   |       +-- use-sessions.ts
|   |       +-- use-agent-output.ts
|   |       +-- use-protocol-state.ts
|   |
|   +-- types/
|       +-- profile.ts
|       +-- session.ts
|       +-- protocol.ts
|       +-- message.ts
|       +-- specialist.ts
|
+-- profiles/                       # Built-in agent profiles
|   +-- claude.yaml
|   +-- gemini.yaml
|   +-- qwen.yaml
|   +-- ccs-glm.yaml
|
+-- protocols/                      # Built-in orchestration protocols
|   +-- collaborative.yaml
|   +-- adversarial.yaml
|   +-- troubleshoot.yaml
|   +-- handshake.yaml
|
+-- specialists/                    # Built-in specialist definitions
|   +-- code-reviewer.specialist.yaml
|   +-- security-auditor.specialist.yaml
|
+-- tests/
|   +-- core/
|   +-- tmux/
|   +-- cli/
|   +-- fixtures/
|
+-- docs/
    +-- getting-started.md
    +-- profiles.md
    +-- protocols.md
    +-- architecture.md
```

### Distribution

```bash
# Install via npm/bun
npm install -g agent-forge
bun install -g agent-forge

# Prerequisite
# Linux: apt install tmux / dnf install tmux
# macOS: brew install tmux
```

### Configuration Files

```
~/.agent-forge/                 # Global (user scope)
+-- config.yaml                 # Global config
+-- profiles/                   # User custom profiles
+-- protocols/                  # User custom protocols
+-- specialists/                # User custom specialists (*.specialist.yaml)
+-- state.db                    # SQLite
+-- logs/
    +-- <session-id>-<agent>.log

.agent-forge/                   # Per-project overrides (project scope)
+-- config.yaml
+-- profiles/
+-- protocols/
+-- specialists/                # Project-specific specialists (*.specialist.yaml)
```

### Key Dependencies

| Package | Purpose |
|---------|---------|
| `commander` | CLI framework |
| `ink` + `ink-*` | TUI components |
| `better-sqlite3` | SQLite (sync, fast) |
| `yaml` | Profile/protocol parsing |
| `zod` | Schema validation |
| `chalk` | Terminal colors (CLI output) |
| `chokidar` | File watching (log tailing) |

---

## 9. Versioning & Roadmap

### Release Plan

```
v0.1.0 -- Foundation (MVP)
  Core: orchestrator, session store, tmux manager
  CLI:  start, spawn, send, read, status, kill, sessions
  Profiles: claude, gemini built-in
  Protocols: none (direct spawn only)
  TUI: none

v0.2.0 -- Protocols
  Protocol engine: YAML parser + executor
  Built-in: handshake, collaborative
  CLI: run, protocol list/show/validate
  Profiles: +qwen, +ccs-glm

v0.3.0 -- TUI
  Dashboard: fleet panel, agent view, messages, keybindings
  tmux pass-through (t key)
  Status bar tmux integration

v0.4.0 -- Specialist System
  Specialist loader: .specialist.yaml discovery, Zod validation, template rendering
  CLI: specialist list/show/create/validate/check-health
  spawn --specialist flag
  3-scope discovery: system, user (~/.agent-forge/), project (.agent-forge/)
  Built-in specialists: code-reviewer, security-auditor

v0.5.0 -- Advanced Protocols + Registry
  Built-in protocols: +adversarial, +troubleshoot
  Protocol variables, conditional turns
  Routing engine (pattern -> agent/protocol auto-selection)
  Registry CLI: unified view of all resources

v0.6.0 -- Resilience & Polish
  Reconciliation loop (zombie detection)
  attach/detach lifecycle
  Log management (rotation, cleanup)
  Profile test command

v1.0.0 -- Production Release
  Full documentation
  CI/CD pipeline
  npm publish
  Stability, edge case handling
  Migration guide from delegating/orchestrating-agents skills
```

### Future Versions

```
v1.1.0 -- Custom Profiles
  profile add CLI
  Community profile sharing

v1.2.0 -- Advanced TUI
  Mouse support
  Split-pane layouts (presets)
  Protocol visualization (flow diagram)

v1.3.0 -- Hooks & Events
  Plugin system for lifecycle hooks
  Pre/post-spawn hooks
  Protocol completion hooks
  Integration with Claude Code hooks

v1.4.0 -- Proactive Specialists
  Heartbeat system (scheduled specialist execution)
  Staleness auto-detection + updater agent
  Specialist-to-specialist communication (Inbox pattern)
  Continuous monitoring mode

v2.0.0 -- Agent Marketplace & Ecosystem
  Browse/install community protocols and specialists
  Protocol composition (chain protocols)
  Specialist marketplace (share domain-specific configs)
  Multi-project support
  Skill-to-specialist migration CLI
```

### Competitive Differentiation

| Feature | Agent Deck | Overstory | Agent Forge |
|---------|------------|-----------|-------------|
| **Runtime** | Go | Bun/TS | Bun/TS |
| **Focus** | Session management | Swarm orchestration | Protocol-driven orchestration |
| **Agent model** | Flat (all equal) | Hierarchical (capabilities) | Boss/worker (simple hierarchy) |
| **Communication** | tmux send-keys | SQLite mail | tmux pipe + file log |
| **Protocols** | None | None (ad-hoc) | Declarative YAML |
| **TUI** | Bubble Tea (rich) | ANSI dashboard | Ink (React-based) |
| **Headless** | Yes (CLI) | Yes (CLI) | Yes (CLI-first) |
| **Skill integration** | None | CLAUDE.md overlay | Protocol definitions from skills |
| **Domain knowledge** | None | CLAUDE.md overlay | .specialist.yaml (Brain layer) |
| **USP** | MCP management, forking | Hierarchy, worktrees | Declarative protocols + specialists |

**Unique selling points**:
1. Agent Forge is the only tool that makes orchestration workflows **declarative and reusable** — you write YAML, not code.
2. The **Specialist System** (Brain + Body) separates domain knowledge from execution infrastructure, making agents truly domain-expert and their knowledge portable across runtimes (TS, Python, Docker).

---

## 10. Specialist System Integration

The Specialist System provides the "Brain" layer — domain-specific knowledge, prompts, execution config, and validation rules — while Agent Forge provides the "Body" — tmux sessions, communication, orchestration.

### Relationship: Brain + Body

```
Profile (Body)                    Specialist (Brain)
profiles/gemini.yaml              specialists/mercury-db-health.specialist.yaml
+-- how to start                  +-- what it knows (system prompt)
+-- how to resume                 +-- how to reason (task template)
+-- how to detect status          +-- what model to use (execution)
+-- env vars                      +-- what to validate (output schema)
                                  +-- when it's stale (files_to_watch)
```

An agent session can have:
- **Profile only**: Generic agent, no domain specialization (current behavior)
- **Profile + Specialist**: Domain-expert agent with pre-loaded knowledge
- **Specialist only**: Inferred profile from `specialist.execution.preferred_profile`

### Specialist YAML Schema (.specialist.yaml)

Compatible with the existing Python Pydantic implementation (darth_feedor). Agent Forge implements a TypeScript loader (Zod) that reads the same format.

```yaml
# .agent-forge/specialists/mercury-db-health.specialist.yaml
specialist:
  metadata:
    name: mercury-db-health
    version: 1.2.0
    description: "Monitors Mercury PostgreSQL health, query performance, connection pools"
    category: monitoring/database
    created: 2026-02-08T00:00:00Z
    updated: 2026-02-24T00:00:00Z
    author: jagger

  execution:
    preferred_profile: gemini       # Which Agent Forge profile to use
    model: gemini-2.0-flash         # Model override (informational for non-API agents)
    temperature: 0.2
    response_format: json
    fallback_model: qwen-plus

  prompt:
    system: |
      You are the Mercury Database Health Specialist. You monitor PostgreSQL
      health for the Mercury trading platform. You know the schema intimately
      and can diagnose connection pool issues, slow queries, and replication lag.
    task_template: |
      **TASK:** $query
      **CONTEXT:** Check the following systems:
      - Connection pools (pgbouncer)
      - Slow query log (>500ms)
      - Replication lag
      - Disk usage on data tablespace
      **OUTPUT:** JSON with health_status, issues[], recommendations[]
    normalize_template: |
      Fix word count violations in this output:
      $violations
      $generated_output
    output_schema:
      type: object
      required: [health_status, issues, recommendations]

  validation:
    files_to_watch:
      - mercury/database/models.py
      - mercury/database/migrations/
    references:
      - type: ssot_memory
        path: .serena/memories/ssot_mercury_database_2026-02-05.md
    stale_threshold_days: 14

  capabilities:                     # Optional: advanced features (future)
    can_chat: true
    tools:
      - name: docker_inspect
        purpose: "Check container runtime status"
      - name: context7
        purpose: "Look up PostgreSQL documentation"
```

### Spawn Flow with Specialist

```
agent-forge spawn gemini --specialist mercury-db-health "Check connection pools"
                |                        |                        |
                v                        v                        v
        Load profile             Load specialist           User's task
        gemini.yaml         mercury-db-health.yaml
                |                        |                        |
                v                        v                        v
        commands.start_with_prompt    prompt.system          prompt.task_template
        "gemini -p '${PROMPT}'"       + rendered with        $query = user task
                                      task_template
                |                        |
                +--------+---------------+
                         |
                         v
              Final command:
              gemini -p "[system prompt]\n\n[rendered task_template]"
              in tmux session af_gemini_<uuid>
```

### Specialist Discovery (3-scope)

```
Priority (highest first):
1. Project:  .agent-forge/specialists/*.specialist.yaml
2. User:     ~/.agent-forge/specialists/*.specialist.yaml
3. System:   <agent-forge-install>/specialists/*.specialist.yaml

Merge rule: Project overrides User overrides System (by metadata.name)
```

### Staleness Detection

```typescript
async function checkHealth(): Promise<HealthReport[]> {
  const specialists = await loader.loadAll();
  const reports: HealthReport[] = [];

  for (const spec of specialists) {
    const stale = spec.validation.files_to_watch.some(file => {
      const fileModified = fs.statSync(file).mtime;
      const specUpdated = new Date(spec.metadata.updated);
      return fileModified > specUpdated;
    });

    const aged = daysSince(spec.metadata.updated) > spec.validation.stale_threshold_days;

    reports.push({
      name: spec.metadata.name,
      status: stale ? "STALE" : aged ? "AGED" : "OK",
      reason: stale ? "Watched files changed" : aged ? "Threshold exceeded" : null,
    });
  }
  return reports;
}
```

### Skill-to-Specialist Promotion

Skills are procedural (how to do something). Specialists are domain-specific (what to know about something). A skill can be promoted to a specialist when it has domain-specific knowledge worth persisting.

```bash
agent-forge specialist create --from-skill delegating
# Reads skills/delegating/SKILL.md frontmatter
# Extracts: name, description
# Generates: .agent-forge/specialists/delegating.specialist.yaml
# User fills in: execution config, prompt templates, validation rules
```

### Compatibility with Python Implementation

The existing Python `SpecialistLoader` (Pydantic) and the new TypeScript loader (Zod) read the same `.specialist.yaml` format. This means:

- Specialists created for Mercury Docker services (Python) work in Agent Forge (TS)
- Specialists created via Agent Forge CLI work in Docker containers (Python)
- The `.specialist.yaml` format is the shared contract — language-agnostic

### Future: Continuous Specialist (Heartbeat)

In future versions, specialists can be "persistent" — running on a schedule (like CAO Flows):

```yaml
specialist:
  # ... metadata, prompt, etc.
  heartbeat:
    enabled: true
    interval: 15m
    on_wake:
      - check_inbox          # Read messages from other agents
      - check_watched_files  # Detect code changes
      - run_health_check     # Execute task_template with default query
    on_issue:
      - notify_manager       # Send message to boss agent
      - create_proposal      # Draft a fix proposal
```

This transforms specialists from passive (invoked on demand) to proactive (self-monitoring), aligning with the "office of agents" vision.

---

## 11. Research & Inspiration

### Agent Deck (asheshgoplani/agent-deck)
- Go + Bubble Tea TUI
- 3-tier status detection: hooks -> control pipe -> content analysis
- tmux session isolation with `agentdeck_*` prefix
- SQLite persistence (WAL mode)
- Session forking for Claude (inherit conversation history)
- `session send` with `waitForAgentReady`
- tmux status-left notification bar

**Adopted**: tmux execution model, status detection via pane content, wait-for-ready pattern, session persistence.
**Not adopted**: MCP management, Go/Bubble Tea, flat agent model.

### Overstory (jayminwest/overstory)
- TypeScript/Bun, hierarchical agent orchestration
- Git worktrees for agent isolation
- SQLite mail system with typed messages (semantic + protocol)
- Watchdog daemon for health monitoring
- Capabilities-based agent hierarchy (coordinator -> supervisor -> lead -> worker)
- `sling` command for agent spawning with CLAUDE.md overlay

**Adopted**: SQLite for state, reconciliation concept, TypeScript/Bun runtime.
**Not adopted**: Git worktrees per agent, full hierarchy, mail system (tmux pipe instead), watchdog daemon (reconciliation loop instead).

### Existing Skills (delegating + orchestrating-agents)
- Pattern-based task routing (delegating/config.yaml)
- Multi-turn protocols: collaborative (3t), adversarial (3t), troubleshoot (4t), handshake (1t)
- CLI command templates: gemini -p, qwen, ccs glm -p
- tmux+PTY workaround for CCS execution

**Migrated**: All routing patterns, protocol turn definitions, CLI command templates become agent-forge profiles and protocols.

### Specialist System (darth_feedor POC + vision docs)
- YAML-based configuration-as-code for AI task prompts
- Pydantic validation, auto-discovery (`*.specialist.yaml`), template rendering
- Production-tested in `ext-summarizer` container (24-36x iteration improvement)
- Volume-mounted hot-reload without Docker rebuilds
- Vision: "Office of Agents" with Brain (specialist YAML) + Body (CAO/tmux infrastructure)
- CAO integration: Handoff (sync), Assign (async), Inbox system, Watchdog, Flows
- Proactive heartbeat agents, inter-agent social protocol, staleness detection

**Adopted**: .specialist.yaml format, Zod re-implementation of Pydantic schema, 3-scope discovery, staleness detection, Brain+Body architecture, skill-to-specialist promotion.
**Deferred**: Heartbeat/Flow system (future version), vector memory, full CAO integration.
**Not adopted**: Python as primary runtime (TS instead), CAO REST API (direct tmux instead).

### CLI Agent Orchestrator / CAO (awslabs)
- Python + FastAPI REST orchestrator for tmux-isolated agents
- Handoff (sync) and Assign (async) patterns
- Inbox system with Watchdog-based IDLE detection
- Flow system with cron scheduling + conditional scripts
- MCP integration via FastMCP

**Adopted**: Handoff/Assign concepts (as spawn + protocol patterns), Inbox concept (as message bus), IDLE detection via pane content.
**Not adopted**: REST API layer (overkill for local tool), FastMCP integration (Agent Forge is CLI-first).
