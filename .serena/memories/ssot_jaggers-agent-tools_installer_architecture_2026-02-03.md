---
title: "Installer and Sync Architecture"
version: 1.1.1
created: 2026-02-03
updated: 2026-02-03T16:30:00+00:00
scope: jaggers-config-manager
category: ssot
subcategory: installer
domain: [infrastructure, cli, sync, gemini, claude, npx]
status: active
changelog:
  - version: 1.0.0
    date: 2026-01-31
    changes: Initial implementation of the Config Manager CLI.
  - version: 1.1.0
    date: 2026-02-03
    changes: Added zero-cloning support, Gemini command sync, and auto-generation.
  - version: 1.1.1
    date: 2026-02-03
    changes: Implemented dynamic path resolution in sync logic to fix hardcoded paths in settings.json.
---

# Installer and Sync Architecture - SSOT

## Overview

The Jaggers Agent Tools installer (`jaggers-config-manager`) is a Node.js-based CLI designed to synchronize skills, hooks, and configuration across multiple agent environments (Claude Code and Gemini CLI).

## Distribution Models

### 1. Zero-Cloning (Primary Method)
The suite is distributed as a self-installing package via `npx`. This ensures that all users receive the latest skills, hooks, and commands without manual repository management.
- **Command**: `npx -y github:Jaggerxtrm/jaggers-agent-tools`
- **Mechanism**: `npm` fetches the repository, installs dependencies in a temporary cache, and executes the `bin` entry point defined in the root `package.json`.

### 2. Local Development Sync
Used for developing new tools or manual synchronization of a cloned repository.
- **Command**: `npx ./cli`

## Core Logic (`cli/lib/`)

### 1. Context Detection (`context.js`)
Identifies agent installation paths (`~/.claude`, `~/.gemini`, `~/.qwen`) and manages persistence of user preferences (e.g., `copy` vs `symlink` mode).

### 2. Difference Engine (`diff.js`)
Performs an MD5-based comparison between the repository source and the system-level installation.
- **Categories**: `skills`, `hooks`, `config`, and `commands` (Gemini-only).
- **Drift Detection**: Identifies local modifications in the system environment.

### 3. Sync & Transformation (`sync.js`, `transform-gemini.js`)
Handles the actual file movement and cross-agent format conversion.
- **Hook Transformation**: Maps Claude lifecycle events to Gemini equivalents (e.g., `UserPromptSubmit` → `BeforeAgent`).
- **Command Auto-Generation**: Automatically transforms `SKILL.md` frontmatter into Gemini `.toml` command files.
- **Claude Native Support**: Recognizes that Claude Code generates commands directly from skill metadata, avoiding redundant file creation.
- **Dynamic Path Resolution**: Fixes hardcoded paths in `settings.json` (e.g., repository paths containing `/hooks/`) by resolving them to the actual user target directory during sync.

## Standards & Best Practices

1. **Safety First**: Always creates backups (`.bak`) of configuration files before overwriting.
2. **Platform Neutrality**: Uses forward slashes and cross-platform path resolution for Windows/Linux/macOS compatibility.
3. **Transparency**: Explicitly displays a breakdown of `[+] Missing`, `[^] Outdated`, and `[<] Drifted` items before execution.

## Related Documentation

- `ssot_jaggers-agent-tools_documenting_workflow_2026-02-03.md` - Documentation standards.
- `ssot_jaggers-agent-tools_orchestrating_agents_2026-02-03.md` - Orchestration skill architecture.
