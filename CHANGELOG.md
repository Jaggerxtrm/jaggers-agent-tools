# Changelog

All notable changes to Claude Code skills and configuration will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.6.0] - 2026-02-24

### Added

#### Documenting Skill Hardening
- **`drift_detector.py`**: New script with `scan`, `check`, and `hook` subcommands — detects stale memories by cross-referencing `tracks:` globs against git-modified files
- **`tracks:` frontmatter field**: Each memory now declares which file globs it documents; added to schema, all templates, and all 11 existing memories
- **Intra-memory INDEX blocks**: `validate_metadata.py` now auto-generates a `<!-- INDEX -->` TOC table inside each memory from `##` headings + first-sentence summaries — allows agents to navigate without reading full documents
- **Stop hook**: `config/settings.json` wired with Stop hook → `drift_detector.py hook`; fires at session end, injects a one-line reminder only when stale memories detected (zero token cost when clean)
- **23 tests**: `test_validate_metadata.py` (4) and `test_drift_detector.py` (8, including `**` glob regression tests) added to existing suite

### Changed
- **`validate_metadata.py`**: INDEX generation now unconditional (no longer blocked by schema validation errors)
- **`SKILL.md` workflow**: Rewritten with drift-first 5-step protocol and decision table (new feature → SSOT, bug fix → changelog only, etc.)
- **All 11 existing memories**: `tracks:` globs added; INDEX blocks regenerated

### Fixed
- `extract_headings`: closing ` ``` ` was captured as section summary due to `in_code` toggle firing before capture check — fixed with `continue`
- `match_files_to_tracks`: `**/` expansion was producing `*.py` (too broad); replaced with recursive segment-by-segment `_match_glob` helper
- `inject_index`: frontmatter split hardened with anchored regex to prevent corruption on non-standard file openings
- `generate_index_table`: anchor generation collapsed consecutive hyphens from stripped `()/` chars

### Documentation
- Updated SSOT: `ssot_jaggers-agent-tools_documenting_workflow_2026-02-03` → v2.0.0

---

## [1.4.0] - 2026-02-23

### Changed

#### Delegating Skill Hardening
- **Description rewrite**: Proactive language with trigger keywords (`tests`, `typos`, `refactors`, `code reviews`, `debugging`) — auto-discovery now fires without explicit "delegate" keyword
- **Frontmatter cleanup**: Removed unsupported fields (`version`, `gemini-command`, `gemini-prompt`); added `allowed-tools: Bash`
- **CCS nested session fix**: All CCS execution commands now use `env -u CLAUDECODE ccs {profile} -p "{task}"` — confirmed working inside Claude Code sessions
- **Interactive menu**: Replaced TypeScript `ask_user()` pseudocode with prose `AskUserQuestion` instructions

#### skill-suggestion.py Hook
- **Orchestration patterns**: Added `ORCHESTRATION_PATTERNS` — hook now fires for code reviews, feature implementation, debugging, security audits, commit validation
- **CLAUDECODE detection**: Hints correctly say "Gemini or Qwen directly" when running inside Claude Code (CCS unavailable), "CCS backend" otherwise
- **Security exclusion fix**: Narrowed `security` exclude pattern to only block auth/vuln *implementation* — security *reviews* now correctly route to orchestration

### Files Modified
- `skills/delegating/SKILL.md` — Description, frontmatter, pseudocode, CCS command
- `hooks/skill-suggestion.py` — Orchestration patterns, CLAUDECODE detection, security exclusion

### Documentation
- Updated SSOT: `ssot_cli_hooks_2026-02-03` → v1.1.0
- New SSOT: `ssot_jaggers-agent-tools_delegating_skill_2026-02-23` v1.0.0

---

## [1.5.0] - 2026-02-23

### Added

#### Service Skills Set (`project-skills/service-skills-set/`)
- **Complete rewrite** of project-specific service skill infrastructure — replaces deprecated `service-skill-builder`
- **Trinity skills** installed into `.claude/skills/` of any target project:
  - `creating-service-skills` — 3-phase workflow: scaffold → Serena LSP deep dive → hook registration
  - `using-service-skills` — SessionStart catalog injection + PreToolUse skill enforcement
  - `updating-service-skills` — PostToolUse drift detection
- **Scripts**:
  - `scaffolder.py` — generates SKILL.md skeleton, script stubs, and auto-detects official docs from 30+ technology mappings (Docker images, requirements.txt, Cargo.toml, package.json)
  - `deep_dive.py` — prints Serena LSP-driven research protocol with tool table for Phase 2
  - `cataloger.py` — SessionStart hook; outputs ~150-token XML service catalog
  - `skill_activator.py` — PreToolUse hook; territory glob + Bash command matching; injects skill load enforcement
  - `drift_detector.py` — PostToolUse hook (`check-hook` stdin mode) + manual `check`, `sync`, `scan` subcommands
  - `bootstrap.py` — shared registry CRUD and project root resolution via git
- **Service registry**: `.claude/skills/service-registry.json` with territory globs, skill path, last sync
- **Git hooks** (`pre-commit`, `pre-push`): idempotent marker-based installation for SSOT reminder and skill staleness warning
- **Installer** (`install-service-skills.py`): single-purpose ~90-line script; copies trinity, merges settings.json hooks, activates git hooks; idempotent
- **Phase 3 — Hook Registration**: new phase in `creating-service-skills` workflow verifies PreToolUse wiring, confirms territory globs in registry, communicates auto-activation to user

### Changed

- Project structure: moved into `project-skills/service-skills-set/` with `.claude/` subdirectory
- `settings.json` PostToolUse hook moved to project-level (was only in skill frontmatter — now always-on)
- PreToolUse added to `settings.json` for territory-based skill auto-enforcement

### Fixed

- `allowed-tools` in skill frontmatter: corrected to Claude Code native tool names — removed invalid MCP/Serena names
- `SessionStart` removed from skill frontmatter (unsupported); moved to `settings.json`
- Removed `disable-model-invocation: true` from workflow skill and scaffolder template
- `project_root.glob()` type error in `bootstrap.py` fixed by wrapping with `Path()`

### Documentation

- Added `project-skills/service-skills-set/service-skills-readme.md`
- New SSOT memory: `ssot_jaggers-agent-tools_service_skills_set_2026-02-23`

---

## [1.3.0] - 2026-02-22

### Added

#### CLI UX Improvements (vsync-inspired)
- **Ora Spinners**: Visual feedback for all async operations (detect, diff, sync)
- **Enhanced Status**: Last sync time, item counts, health indicators, actionable hints
- **Single Confirmation**: Collect all changesets, display full plan, ask once
- **Drifted Items Feedback**: Report skipped drifted items post-sync with backport hint

### Changed

#### Safety Improvements
- **Prune Mode Guard**: Added `PruneModeReadError` — aborts if system read fails in prune mode
- **Repo Root Detection**: Dynamic detection via `findRepoRoot()` utility (walks up looking for `skills/` + `hooks/`)
- **Dry-Run Banner**: Moved from before target selection to after plan display
- **Error Handling**: Global handlers for clean error messages (no stack traces)
- **Ignored Items**: Filter `__pycache__`, `.DS_Store`, `node_modules` from diff scanning

### Dependencies
- Added `ora` for spinner UI

### Files Modified
- `cli/src/core/diff.ts` — Prune guard, ignored items filtering
- `cli/src/utils/repo-root.ts` — New utility
- `cli/src/commands/sync.ts` — Spinners, single confirm, feedback improvements
- `cli/src/commands/status.ts` — Enhanced output with timestamps
- `cli/src/core/manifest.ts` — Added `getManifestPath()`
- `cli/src/index.ts` — Global error handlers

### Documentation
- New SSOT: `ssot_cli_ux_improvements_2026-02-22.md`

---

## [1.2.0] - 2026-02-21

### Added

#### CLI: TypeScript Migration
- **Full TypeScript rewrite** of `cli/` — all modules ported from plain JavaScript ESM to strict TypeScript
- **Commander.js** replaces `minimist` for structured sub-command routing
- **Zod schemas** for runtime validation of `ChangeSet`, `SyncMode`, `Manifest`, `MCPServer`
- **Adapter Pattern** — `ToolAdapter` base class with `ClaudeAdapter`, `GeminiAdapter`, `QwenAdapter` implementations
  - `detectAdapter(systemRoot)` factory replaces scattered `includes('.claude')` checks codebase-wide
- **Rollback protection** — `core/rollback.ts` backs up every file before write; restores all on any failure
- **Hash-only diffing** — Pure MD5 comparison via `utils/hash.ts`; mtime used only as drift tie-breaker
- **`prepare` npm script** — auto-builds on `npm install`, restoring `npx github:Jaggerxtrm/jaggers-agent-tools` support
- **`vitest` test infrastructure** added to devDependencies (tests deferred, see `docs/plans/cli-testing.md`)

#### New sub-commands
- `jaggers-config sync [--dry-run] [-y] [--prune] [--backport]` — main sync
- `jaggers-config status` — read-only diff view (no file writes)
- `jaggers-config reset` — replaces `--reset` flag from old CLI

#### Windows Compatibility (baked in)
- `registry.ts` normalises backslashes before path matching
- `config-adapter.ts` uses `python` (not `python3`) on Windows for hook scripts
- `sync-executor.ts` falls back from symlinks to copy on Windows with a user warning

### Changed
- `cli/package.json` `bin` and root `package.json` `bin` now point to `cli/dist/index.js` (compiled output)
- `cli/package.json` `scripts` updated: `build` (tsup), `dev` (tsx), `typecheck` (tsc), `test` (vitest), `start` (node dist)
- Old `cli/index.js` and `cli/lib/*.js` preserved on disk but no longer referenced

### Fixed
- **Double-shebang bug** in tsup output — removed `banner` config, relying on tsup's auto-detection from `src/index.ts`

---

## [Unreleased]


### Added
- **MCP Servers Configuration v3.1.0**: Centralized environment file management
  - New module: `cli/lib/env-manager.js` - manages `~/.config/jaggers-agent-tools/.env`
  - CLI auto-creates `.env` file on first sync
  - Validates required environment variables before sync
  - Shows helpful warnings with links to get API keys
  - Re-sync safe: existing values preserved, file not overwritten
  - Example file at `~/.config/jaggers-agent-tools/.env.example`
- **MCP Servers Configuration v3.0.0**: Unified MCP CLI sync for all agents
  - New module: `cli/lib/sync-mcp-cli.js` - handles Claude, Gemini, and Qwen
  - All three agents now use official `mcp add/remove/list` commands
  - Idempotent sync (re-running doesn't cause errors)
  - Agent-specific command builders for each CLI
  - User-level installation for Claude (`-s user` scope)
- **MCP Servers Configuration v2.0.0**: Complete overhaul of MCP servers sync system
  - Split into `config/mcp_servers.json` (core) and `config/mcp_servers_optional.json` (optional)
  - Core servers: serena, context7, github-grep, deepwiki
  - Optional servers: unitAI, omni-search-engine (user prompted during sync)
  - Added `config/.env.example` for API key documentation
  - New SSOT memory: `ssot_cli_mcp_servers_2026-02-21.md`
- **ConfigAdapter Enhancements**: Format adaptation for all 4 agents
  - Added Qwen support (same format as Gemini)
  - Added Antigravity support (`url` → `serverUrl` transformation)
  - Automatic `type` field handling (required for Claude/Antigravity, removed for Gemini/Qwen)
  - Enhanced `EnvVarTransformer` for cross-agent compatibility
- **Documentation**: New comprehensive guide `docs/mcp-servers-config.md`
- **README Update**: Added MCP Servers configuration section with links to documentation
- GitNexus system integration into CLI installer: optional MCP server (gitnexus) with auto npm install, PreToolUse hook (hooks/gitnexus/gitnexus-hook.cjs), and 4 knowledge-graph skills synced via standard pipeline

### Changed
- **MCP Configuration Cleanup**: Removed unused servers from canonical source
  - Removed: `filesystem`, `git`, `memory` (not in actual user config)
  - Removed: `gmail`, `yfinance-market-intelligence` (project-specific/personal)
  - Updated: `serena` command (uvx from git, auto-detects project at runtime)
- **Universal Hub SSOT**: Updated to v2.0.0, references new MCP Servers SSOT
- **Metadata**: Added `_notes` fields to MCP configs for documentation and prerequisites
- **Env File Location**: Moved from repo to `~/.config/jaggers-agent-tools/.env` (centralized)

### Deprecated
- **Single MCP Config File**: `config/mcp_servers.json` now core-only, optional servers separated
- **JSON File Sync for Claude/Gemini/Qwen**: Prefer official `mcp` CLI method
- **Repo .env files**: Use centralized `~/.config/jaggers-agent-tools/.env` instead

### Removed
- **Unused MCP Servers**: filesystem, git, memory (never in actual production use)
- **Personal MCP Servers**: gmail, yfinance-market-intelligence (user-specific, not canonical)
- **Old Claude-specific sync**: `cli/lib/sync-claude-mcp.js` (replaced by unified `sync-mcp-cli.js`)

### Fixed
- **Format Compatibility**: All 4 agents (Claude, Gemini, Qwen, Antigravity) now properly supported
- **URL Field Names**: Antigravity `serverUrl` transformation implemented
- **Type Field Handling**: Automatic addition/removal per agent requirements
- **Claude Code MCP Sync**: Now uses official CLI instead of JSON file manipulation
- **Claude Scope**: Uses `-s user` for user-level installation (not project-level)
- **Gemini/Qwen MCP Sync**: Now use official CLI commands instead of JSON manipulation
- **Idempotent Sync**: Re-running sync doesn't cause "already exists" errors
- **Env Var Management**: Centralized at `~/.config/jaggers-agent-tools/.env`, auto-created

## [1.1.1] - 2026-02-03

### Added
- **Orchestrating Agents Skill**: Multi-model collaboration skill for Gemini and Qwen.
- **Handshaking Workflows**: Deep multi-turn loops (Collaborative Design, Adversarial Review, Troubleshoot Session).
- **Gemini Command Sync**: CLI support for synchronizing `.toml` commands and auto-generating them from skills.
- **Cross-Agent Interactivity**: Support for both Gemini (`ask_user`) and Claude (`AskUserQuestion`) interactive menus.
- Implement specialized Gemini slash commands (/delegate, /document, /prompt)
- Enable zero-cloning installation via npx github:Jaggerxtrm/jaggers-agent-tools
- Implement Vault Sync Architecture for non-destructive settings management. Protects local secrets, MCP servers, and auth data during sync. Includes atomic writes and dry-run mode.
- **Architecture Roadmap**: Document CLI architectural improvements in ROADMAP.md based on multi-agent orchestration findings (Transactional Sync, Manifest Versioning, Namespace Prefixes, Observability).

### Changed
- **CLI Enhancement**: Automatically transforms `SKILL.md` into Gemini `.toml` command files during sync.
- **Hook Migration**: Refined hook transformation logic for cross-agent compatibility.
- Update SSOT and CHANGELOG for cross-agent compatibility and CLI improvements
- Consolidate all v1.1.0 improvements: Zero-Cloning, Metadata-driven commands, and multi-turn orchestration
- **ROADMAP.md**: Added "CLI Architecture Improvements" section with 5 phases addressing transactional sync, versioning, collision detection, observability, and transformation refactoring.

### Fixed
- Fix hook execution timeouts by updating settings.json to use milliseconds and enhancing transform-gemini.js to handle unit mismatches and improve hook naming.
- Prevent redundant auto-generation of commands for core skills in CLI
- Fix hardcoded paths in settings.json during sync
- Fix ReferenceError in sync.js by adding missing import and verify via Qwen handshake
## [6.0.0] - 2026-02-01

### Added

#### `delegating` Skill (Unified)
- **New `delegating` skill** replaces `ccs-delegation`
- **Unified Backends**: Supports both CCS (cost-optimized) and unitAI (multi-agent workflows)
- **Configuration-Driven**: All logic defined in `config.yaml`
- **Auto-Focus**: Detects security/performance/quality focus from keywords
- **Autonomous Workflow Selection**: Claude picks optimal unitAI workflow based on patterns

### Removed

#### `ccs-delegation` Skill
- **Deprecated**: Fully replaced by `delegating` skill
- **Removed**: `skills/ccs-delegation` directory deleted

### Changed

#### Skill Suggestions Hook
- **Updated**: Suggests `/delegation` instead of `/ccs-delegation`
- **Renamed**: `skill-suggestion.sh` → `skill-suggestion.py` for Python implementation

---

## [5.1.0] - 2026-01-30

### Changed

#### Naming Convention Alignment
- **Skill `p` renamed to `prompt-improving`**
  - Updated skill directory: `~/.claude/skills/p` → `~/.claude/skills/prompt-improving`
  - Updated YAML frontmatter: `name: p` → `name: prompt-improving`
  - Updated trigger syntax: `/p` → `/prompt-improving`
  - Updated hook suggestions to reference `/prompt-improving`
  - Follows Claude's naming convention with `-ing` suffix for improved clarity

#### Breaking Changes
- **`/p` command no longer works** - Use `/prompt-improving` instead
- Users with muscle memory for `/p` will need to adapt to `/prompt-improving`
- Hook suggestions now display `/prompt-improving` in systemMessage

#### Migration Guide (5.0.0 → 5.1.0)
**For Users:**
- Replace all `/p "prompt"` invocations with `/prompt-improving "prompt"`
- Update any documentation or workflows referencing the `/p` skill

**For Backward Compatibility (Optional):**
If you prefer to keep `/p` working via symlink:
```bash
ln -s ~/.claude/skills/prompt-improving ~/.claude/skills/p
```

---

## [5.0.0] - 2026-01-30

### Added

#### Skills Enhancement
- **UserPromptSubmit Hook** (`~/.claude/hooks/skill-suggestion.sh`)
  - Proactive skill suggestions for `/p` and `/ccs` based on prompt analysis
  - Bilingual pattern matching (Italian + English)
  - Flexible synonym detection (e.g., "correggi|fix|sistema|repair")
  - Sub-100ms execution time, no LLM calls
  - Opt-in configuration via `settings.json`
  - Detects simple tasks (typo, test, refactor, docs) → suggests `/ccs`
  - Detects short/generic prompts → suggests `/p` for structure

#### Configuration
- **skillSuggestions config** in `settings.json`
  - `enabled: true` - Hook active by default
  - Can be disabled without restart
- **UserPromptSubmit hook registration** in `settings.json`
  - Timeout: 1s
  - Command: `/home/dawid/.claude/hooks/skill-suggestion.sh`

#### Skill Features
- **AskUserQuestion dialogs** in `ccs-delegation` skill for interactive delegation choice
- **AskUserQuestion clarification** in `p` skill for ambiguous prompts (<8 words)

### Changed

#### Skill `p` (Prompt Improver)
- **SKILL.md**: Reduced from 118 to 64 lines (-46% size)
- **Simplified context detection**: From 10 categories to 3 (ANALYSIS, DEV, REFACTOR)
- **Removed multi-iteration improvement loop**: Single-pass processing only
- **Inline scoring heuristics**: Replaced complex quality metrics with simple keyword checks
- **Reference structure**: Merged prefill patterns into `xml_core.md` (+20 lines)

#### Skill `ccs-delegation`
- **SKILL.md**: Reduced from 486 to 151 lines (-69% size)
- **Keyword-based profile selection**: Replaced quantitative complexity scoring (0-10 scale)
  - Simple patterns: `typo|test|doc` → glm
  - Reasoning patterns: `analiz|think|reason` → gemini  
  - Architecture patterns: `architecture|entire|codebase` → gemini
- **Bilingual support**: IT+EN keywords throughout (e.g., "correggi|fix", "aggiungi.*test|add.*test")
- **Simplified execution flow**: Detect → Ask → Select Profile → Execute (removed fallback chains)

#### Performance Improvements
- **Skill load time**: 5-8s → <1s (-80-85% reduction)
- **Total token overhead**: 155KB → 16KB (-90% reduction)
- **Pattern matching**: Extended from basic English to IT+EN with wildcards

### Removed

#### Skill `p` References (46KB total)
- `quality_metrics.md` (12.7KB, 511 lines) - Complex 0-100 scoring system
- `context_detection_rules.md` (10.4KB) - 10-category detection rules
- `prefill_patterns.md` (10KB) - Standalone prefill examples (merged into xml_core.md)
- `before_after_examples.md` (12.9KB) - Redundant examples

#### Skill `ccs-delegation` References (95KB total)
- `task_complexity_scoring.md` (14.4KB, 478 lines) - Quantitative complexity algorithm
- `smart_context_gathering.md` (16.6KB, 643 lines) - Multi-level context system
- `fallback_chain.md` (15.5KB) - Edge-case fallback handling
- `parallel_delegation.md` (17.1KB) - Multi-agent parallel execution
- `delegation_history_analysis.md` (15.7KB) - Learning/persistence system

#### Features Removed
- **Quality metrics validation** from `p` skill (over-engineered for use case)
- **Smart context gathering** from `ccs-delegation` (Claude handles naturally)
- **Fallback chain** from `ccs-delegation` (<1% usage, 15KB overhead)
- **Parallel delegation** from `ccs-delegation` (power-user feature, 17KB overhead)
- **Delegation history tracking** from `ccs-delegation` (requires state management)

### Fixed

#### Pattern Matching
- **Too rigid English-only patterns** → Extended to bilingual IT+EN with synonyms
- **Missing common terms** → Added: "rimuovi|remove", "modifica|modify", "sistema|repair"
- **Case sensitivity issues** → All patterns use case-insensitive matching (`grep -i`)

#### Hook Configuration
- **Hook script not executable** → Added `chmod +x` to deployment checklist
- **Missing skillSuggestions config** → Added to `settings.json` with `enabled: true`

### Deprecated

Nothing deprecated in this release.

### Security

No security-related changes in this release.

---

## [4.2.0] - Pre-refactoring baseline

### Changed
#### Skills State Before Refactoring
- **Skill `p`**: 118 lines, 52KB references (9 files)
- **Skill `ccs-delegation`**: 486 lines, 103KB references (6 files)
- **Total overhead**: 155KB token cost per skill activation
- **Load time**: 5-8 seconds per skill invocation