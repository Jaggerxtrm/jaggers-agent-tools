---
name: service-skill-builder
description: Transforms Claude into a System Architect that maps any Docker-based microservices project into high-quality, operational service skills. Use when onboarding to a new project, adding a new service, or when existing skills need updating. Produces SKILL.md documentation and executable diagnostic scripts through a mandatory two-phase workflow — automated skeleton generation first, then a deep agentic code dive. The generated scripts must be service-specific and immediately runnable, not generic stubs.
---

# Service Skill Builder

## Purpose

Generate operational "skill packages" for every Docker service in a project. Each skill becomes a specialized knowledge base: what the service does, how it connects to infrastructure, what breaks under load, and — most critically — executable scripts that let an agent diagnose problems without guesswork.

---

## Mandatory Two-Phase Workflow

**Both phases are required. Never skip Phase 2.**

---

### Phase 1: Automated Skeleton (Always First)

Run the USM generator to build a structural skeleton from static analysis of `docker-compose*.yml`, `Dockerfile`, and entry-point scripts.

```bash
# Discover all services in the project
python3 .claude/skills/service-skill-builder/scripts/main.py --scan

# Generate skeleton for a specific service
python3 .claude/skills/service-skill-builder/scripts/main.py <service-name>

# Check health of all existing skills
python3 .claude/skills/service-skill-builder/scripts/skill_health_check.py --all
```

The skeleton produces:
- `SKILL.md` with `[PENDING RESEARCH]` markers where the agent has no static signal
- `REFINEMENT_BRIEF.md` with a deep-dive checklist
- Generic stub scripts in `scripts/` (these must be replaced in Phase 2)

**The skeleton is never sufficient on its own.** It contains structural facts (ports, env vars, image names) but no semantic knowledge of what the service actually does, what it writes to the database, or what failure looks like.

---

### Phase 2: Agentic Deep Dive (Non-Negotiable)

After the skeleton exists, answer every question below using `Read`, `Grep`, `Glob`, and Serena LSP tools against the actual source code and docker-compose files. Do not guess. Do not leave placeholders.

**Container & Runtime**
- What is the exact entry point script/command? (Verify in Dockerfile CMD + docker-compose command)
- Which environment variables are critical (service will crash without them) vs. optional?
- What volumes does it read from? Write to?
- Is this a long-running daemon, a one-shot job, or cron-scheduled? → Determines the health check strategy.
- What restart policy does it use, and why?
- Does it depend on another service being healthy before starting?

**Data Layer**
- Which database tables does it write? Which does it only read?
- What is the timestamp column for each table (`created_at`, `snapshot_ts`, `asof_ts`, etc.)?
- What is a realistic "stale" threshold in minutes for each output table?
- Does it use Redis, S3, local files, or other external state?
- Does it use parameterized queries? (Critical for SQL injection prevention)

**Failure Modes — fill this table:**

| Symptom | Likely Cause | Resolution |
|---------|-------------|------------|
| (what you see) | (root cause) | (exact command to fix) |

(Aim for 5 rows minimum. Pull from code comments, exception handlers, and README if present.)

**Log Patterns — identify real patterns from the code:**
- What strings appear in logs during normal healthy operation?
- What strings indicate a recoverable error?
- What strings indicate a critical failure requiring restart?
- What is the Rust panic format (if Rust)? What is the Python traceback trigger?

**Determine specialist scripts needed:**
See [references/script_quality_standards.md](references/script_quality_standards.md) for the service type classification and script design rules.

---

## Service Type Classification → Script Strategy

Classify each service before writing scripts. This determines which scripts to write beyond the baseline `health_probe.py` and `log_hunter.py`.

| Service Type | Health Probe Strategy | Log Patterns Focus | Specialist Script |
|---|---|---|---|
| **Continuous DB writer** | Table freshness + row count per symbol/key | Insert errors, DB connect, data validation | `data_explorer.py` |
| **HTTP API server** | HTTP endpoint probing (real routes) | 5xx errors, startup failure, ValidationError | `endpoint_tester.py` |
| **One-shot / migration** | Container exit code + expected table/schema presence | Config error, missing dep, constraint violation | `coverage_checker.py` |
| **File watcher (Rust/Python)** | Mount path accessible + state file present + DB recency | Panic, parse error, inotify limit, mount error | `state_inspector.py` |
| **Email / API poller** | Container running + auth token presence in volume | OAuth expiry, API quota, PDF parse error | (service-specific) |
| **Scheduled backup** | Recent backup files in staging dir + daemon running | Upload failure, disk full, credential error | (service-specific) |
| **MCP stdio server** | Data source freshness in DB (no HTTP) | Protocol error, tool failure, config error | (service-specific) |

---

## Script Quality Requirements

Every generated script must meet these standards. See [references/script_quality_standards.md](references/script_quality_standards.md) for the complete specification.

**Non-negotiable rules:**
1. **No generic patterns.** `SyntaxError`, `ImportError`, `ConnectionError` are useless in log hunters. Use actual error strings from the service's codebase (e.g., `YFPricesMissingError`, `thread '.*' panicked`, `invalid_grant`).
2. **Correct port defaults.** Scripts running on the host machine connect to the *external* mapped port (e.g., 5433 for TimescaleDB). Never use the container-internal port in host scripts.
3. **Read before write.** If overwriting an existing stub, always read the file first. Never write-blindly.
4. **Dual output mode.** Every script must support `--json` (machine-readable) and default human-readable output.
5. **Severity bucketing.** Log hunters must classify hits as `critical / error / warning / info` and print them grouped, not flat.
6. **Service-specific stale thresholds.** A data feed that updates every 5 minutes has a different staleness tolerance than a daily analytics job. Encode the correct threshold per table.
7. **Actionable remediation.** When a health probe or log hunter detects a critical issue, it must print the exact command to fix it.

---

## Skill Completion Checklist

A skill is **complete** (not draft) when all of these are true:

- [ ] No `[PENDING RESEARCH]` markers remain in SKILL.md
- [ ] All stub scripts have been replaced with service-specific implementations
- [ ] `health_probe.py` queries the actual output tables with correct stale thresholds
- [ ] `log_hunter.py` patterns are taken from the real codebase, not invented
- [ ] At least one specialist script exists if the service has unique inspectable state
- [ ] The Troubleshooting table has ≥5 rows based on real failure modes
- [ ] All CLI commands in SKILL.md have been verified against the actual docker-compose config
- [ ] Scripts have been synced to `.agent/skills/` and `.gemini/skills/` mirrors

---

## Mirror Sync

After generating or updating skills, always sync to agent mirrors:

```bash
# Sync a single service
cp -r .claude/skills/<service-name>/ .agent/skills/<service-name>/
cp -r .claude/skills/<service-name>/ .gemini/skills/<service-name>/

# Sync all service skills at once
for d in .claude/skills/mmd-*/; do
  svc=$(basename "$d")
  cp -r "$d" ".agent/skills/$svc/"
  cp -r "$d" ".gemini/skills/$svc/"
done
```

---

## Resources

- [references/service_skill_system_guide.md](references/service_skill_system_guide.md) — System architecture, engine design, directory structure
- [references/script_quality_standards.md](references/script_quality_standards.md) — Script design patterns, per-type templates, and anti-patterns
- `scripts/main.py` — USM entry point (skeleton generator)
- `scripts/skill_health_check.py` — Drift detection and staleness analysis
- `scripts/discovery.py` — Docker Compose parsing and service discovery
- `scripts/analysis.py` — AST/regex code analysis engine
- `scripts/devops_audit.py` — CI/CD, observability, and security audit
- `scripts/generator.py` — Skill file generation logic
