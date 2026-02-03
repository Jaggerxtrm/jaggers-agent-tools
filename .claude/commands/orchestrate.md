# Orchestrate

Orchestrate a task handoff or a multi-turn deep collaboration session with Gemini/Qwen.

## Usage

Use the orchestrating-agents skill to handle this request: {{args}}

1. First, detect available neighbors (run `scripts/detect_neighbors.py`).
2. Select the appropriate workflow via `AskUserQuestion`:
   - Single Handshake (Quick review)
   - Collaborative Design (New features)
   - Adversarial Review (Security/Bugs)
   - Troubleshoot Session (Emergency)
3. Execute the turns defined in the skill protocol (see `references/workflows.md`).
4. Ingest the final results.
