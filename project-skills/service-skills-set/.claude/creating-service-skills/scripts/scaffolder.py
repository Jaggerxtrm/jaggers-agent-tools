#!/usr/bin/env python3
"""
Scaffolder for creating-service-skills.

Phase 1 of the two-phase workflow: generates a structural skeleton for a new
service skill by parsing docker-compose.yml, Dockerfiles, and dependency files.
The skeleton contains [PENDING RESEARCH] markers for the agent to fill in Phase 2.

Output location: .claude/skills/<service-id>/
"""

import re
import sys
from pathlib import Path

# Resolve bootstrap from this script's directory
script_dir = Path(__file__).parent
sys.path.insert(0, str(script_dir))

from bootstrap import (
    get_project_root,
    register_service,
    list_services,
    RootResolutionError,
)

# ---------------------------------------------------------------------------
# Official documentation map — populated from detected technologies
# ---------------------------------------------------------------------------
OFFICIAL_DOCS: dict[str, tuple[str, str]] = {
    # Docker images / databases
    "postgres":        ("PostgreSQL",   "https://www.postgresql.org/docs/"),
    "timescale":       ("TimescaleDB",  "https://docs.timescale.com/"),
    "timescaledb":     ("TimescaleDB",  "https://docs.timescale.com/"),
    "redis":           ("Redis",        "https://redis.io/docs/"),
    "mysql":           ("MySQL",        "https://dev.mysql.com/doc/"),
    "mongodb":         ("MongoDB",      "https://www.mongodb.com/docs/"),
    "mongo":           ("MongoDB",      "https://www.mongodb.com/docs/"),
    "elasticsearch":   ("Elasticsearch","https://www.elastic.co/guide/"),
    "rabbitmq":        ("RabbitMQ",     "https://www.rabbitmq.com/documentation.html"),
    "kafka":           ("Apache Kafka", "https://kafka.apache.org/documentation/"),
    "clickhouse":      ("ClickHouse",   "https://clickhouse.com/docs/"),
    # Python packages
    "fastapi":         ("FastAPI",      "https://fastapi.tiangolo.com/"),
    "flask":           ("Flask",        "https://flask.palletsprojects.com/"),
    "django":          ("Django",       "https://docs.djangoproject.com/"),
    "sqlalchemy":      ("SQLAlchemy",   "https://docs.sqlalchemy.org/"),
    "alembic":         ("Alembic",      "https://alembic.sqlalchemy.org/en/latest/"),
    "prisma":          ("Prisma",       "https://www.prisma.io/docs/"),
    "celery":          ("Celery",       "https://docs.celeryq.dev/"),
    "pydantic":        ("Pydantic",     "https://docs.pydantic.dev/"),
    "asyncpg":         ("asyncpg",      "https://magicstack.github.io/asyncpg/"),
    "psycopg2":        ("psycopg2",     "https://www.psycopg.org/docs/"),
    "psycopg":         ("psycopg3",     "https://www.psycopg.org/psycopg3/docs/"),
    "aiohttp":         ("aiohttp",      "https://docs.aiohttp.org/"),
    "httpx":           ("HTTPX",        "https://www.python-httpx.org/"),
    "telethon":        ("Telethon",     "https://docs.telethon.dev/"),
    "discord":         ("discord.py",   "https://discordpy.readthedocs.io/"),
    "dramatiq":        ("Dramatiq",     "https://dramatiq.io/"),
    "apscheduler":     ("APScheduler",  "https://apscheduler.readthedocs.io/"),
    # Node / TypeScript
    "express":         ("Express.js",   "https://expressjs.com/"),
    "nestjs":          ("NestJS",       "https://docs.nestjs.com/"),
    "typeorm":         ("TypeORM",      "https://typeorm.io/"),
    "sequelize":       ("Sequelize",    "https://sequelize.org/docs/"),
    # Rust crates
    "tokio":           ("Tokio",        "https://tokio.rs/tokio/tutorial"),
    "sqlx":            ("SQLx",         "https://docs.rs/sqlx/"),
    "axum":            ("Axum",         "https://docs.rs/axum/"),
    "serde":           ("Serde",        "https://serde.rs/"),
    "reqwest":         ("reqwest",      "https://docs.rs/reqwest/"),
}


def detect_official_docs(project_root: Path, territory: Path) -> list[tuple[str, str]]:
    """
    Detect technologies used by this service and return relevant official docs.

    Scans:
    - docker-compose.yml (image names)
    - Dockerfile (FROM directives)
    - requirements.txt / pyproject.toml (Python deps)
    - Cargo.toml (Rust crates)
    - package.json (Node deps)

    Returns:
        List of (label, url) tuples for detected technologies
    """
    detected: set[str] = set()

    def scan_text(text: str) -> None:
        lowered = text.lower()
        for key in OFFICIAL_DOCS:
            if key in lowered:
                detected.add(key)

    # Scan docker-compose files at project root
    for dc_file in project_root.glob("docker-compose*.yml"):
        try:
            scan_text(dc_file.read_text(encoding="utf-8"))
        except (IOError, UnicodeDecodeError):
            pass

    # Scan Dockerfile in territory or its parent directories
    for search_dir in [territory, territory.parent, project_root]:
        df = search_dir / "Dockerfile"
        if df.exists():
            try:
                scan_text(df.read_text(encoding="utf-8"))
            except (IOError, UnicodeDecodeError):
                pass
            break

    # Python deps
    for dep_file in list(territory.rglob("requirements*.txt")) + list(territory.rglob("pyproject.toml")):
        try:
            scan_text(dep_file.read_text(encoding="utf-8"))
        except (IOError, UnicodeDecodeError):
            pass

    # Rust deps
    for cargo_file in territory.rglob("Cargo.toml"):
        try:
            scan_text(cargo_file.read_text(encoding="utf-8"))
        except (IOError, UnicodeDecodeError):
            pass

    # Node deps
    for pkg_file in territory.rglob("package.json"):
        try:
            scan_text(pkg_file.read_text(encoding="utf-8"))
        except (IOError, UnicodeDecodeError):
            pass

    # Return sorted, deduplicated results (avoid e.g. postgres + timescale doubling)
    result = []
    seen_urls: set[str] = set()
    for key in sorted(detected):
        label, url = OFFICIAL_DOCS[key]
        if url not in seen_urls:
            result.append((label, url))
            seen_urls.add(url)

    return result


def analyze_directory(dir_path: Path) -> dict:
    """Analyze a directory to understand its purpose and technology profile."""
    if not dir_path.exists():
        return {"error": f"Directory not found: {dir_path}"}

    files = list(dir_path.rglob("*"))
    code_files = [
        f for f in files
        if f.is_file() and f.suffix in {'.py', '.ts', '.js', '.go', '.rs', '.java'}
    ]

    extensions: dict[str, int] = {}
    for f in code_files:
        extensions[f.suffix] = extensions.get(f.suffix, 0) + 1

    patterns: list[str] = []
    dir_name = dir_path.name.lower()

    if any(kw in dir_name for kw in ['db', 'database', 'sql', 'prisma', 'model']):
        patterns.append("database")
    if any(kw in dir_name for kw in ['auth', 'security', 'jwt', 'token', 'login']):
        patterns.append("security")
    if any(kw in dir_name for kw in ['api', 'route', 'handler', 'controller']):
        patterns.append("api")
    if any(kw in dir_name for kw in ['test', 'spec', '__test__']):
        patterns.append("testing")
    if any(kw in dir_name for kw in ['util', 'helper', 'common']):
        patterns.append("utilities")

    persona_map = {
        "database": "Senior Database Engineer",
        "security": "Security Architect",
        "api": "API Design Specialist",
        "testing": "QA Automation Expert",
    }
    persona = next(
        (persona_map[p] for p in patterns if p in persona_map),
        "Senior Software Engineer"
    )

    return {
        "path": str(dir_path),
        "file_count": len(code_files),
        "extensions": extensions,
        "patterns": patterns,
        "suggested_persona": persona,
    }


def generate_skill_template(
    service_id: str,
    persona: str,
    territory: list[str],
    description: str = "",
    official_docs: list[tuple[str, str]] | None = None,
) -> str:
    """
    Generate a SKILL.md skeleton for a new service.

    Produces correct frontmatter (no version/persona/territory fields).
    All [PENDING RESEARCH] sections are filled in during Phase 2.
    """
    name = service_id.replace("-", " ").title()
    official_docs = official_docs or []

    docs_section = ""
    if official_docs:
        docs_lines = "\n".join(f"- [{label}]({url})" for label, url in official_docs)
        docs_section = f"\n### Official Documentation\n\n{docs_lines}\n"

    return f'''---
name: {service_id}
description: >-
  [PENDING RESEARCH] Specialized knowledge for the {name} service.
  Use when debugging, analyzing performance, or understanding this service.
allowed-tools: Bash(python3 *), Read, Grep, Glob
---

# {name}

## Service Overview

[PENDING RESEARCH] Describe what this service does, its role in the system,
and whether it runs continuously, as a one-shot job, or on a schedule.

**Persona**: {persona}

## Architecture

[PENDING RESEARCH]

**Entry Point**: [Verify in Dockerfile CMD and docker-compose `command:` field]
**Container Name**: {service_id}
**Restart Policy**: [PENDING RESEARCH]

**Primary Modules**:
- [PENDING RESEARCH] List key modules after reading the source tree

**Dependencies**: [PENDING RESEARCH] PostgreSQL? Redis? External APIs?

## ⚠️ CRITICAL REQUIREMENTS

[PENDING RESEARCH] Add any mandatory patterns, initialization calls, or
invariants that must not be violated when modifying this service.

## Data Flows

[PENDING RESEARCH] Trace the primary data paths through the service.

## Database Interactions

[PENDING RESEARCH]

| Table | Operation | Timestamp Column | Stale Threshold |
|-------|-----------|-----------------|-----------------|
| [table] | INSERT/SELECT | [col] | [N min] |

## Common Operations

### Service Management

```bash
# Start the service
docker compose up -d {service_id}

# Check logs
docker logs {service_id} --tail 50

# Restart
docker compose restart {service_id}
```

### Data Inspection

- **Health check**: `python3 .claude/skills/{service_id}/scripts/health_probe.py`
- **Log analysis**: `python3 .claude/skills/{service_id}/scripts/log_hunter.py`
- **Data explorer**: `python3 .claude/skills/{service_id}/scripts/data_explorer.py`

## Troubleshooting Guide

[PENDING RESEARCH] Fill from exception handlers and code comments.

| Symptom | Likely Cause | Resolution |
|---------|-------------|------------|
| [what you see] | [root cause] | [exact command to fix] |

Minimum 5 rows required.

<!-- SEMANTIC_START -->
## Semantic Deep Dive (Human/Agent Refined)

[PENDING RESEARCH] Add deep operational knowledge after Phase 2 deep dive.

<!-- SEMANTIC_END -->

## Scripts

- `scripts/health_probe.py` — Container status + table freshness check
- `scripts/log_hunter.py` — Service-specific log pattern analysis
- `scripts/data_explorer.py` — Safe database inspection (read-only)

## References
{docs_section}
- `references/deep_dive.md` — Detailed Phase 2 research notes
- `references/architecture_ssot.md` — Architecture SSOT (link from project SSOT if available)

---

*Generated by creating-service-skills Phase 1. Run Phase 2 to fill [PENDING RESEARCH] markers.*
'''


def write_script_stubs(service_id: str, skill_dir: Path) -> None:
    """
    Write Phase 1 script stubs into the skill's scripts/ directory.

    These stubs contain [PENDING RESEARCH] markers that are replaced
    during Phase 2 with service-specific implementations.
    """
    scripts_dir = skill_dir / "scripts"
    scripts_dir.mkdir(parents=True, exist_ok=True)

    # health_probe.py stub
    (scripts_dir / "health_probe.py").write_text(
        f'''#!/usr/bin/env python3
"""Health probe for {service_id}.

[PENDING RESEARCH] Replace all [FILL] markers during Phase 2 deep dive.
"""
import json
import subprocess
import sys

CONTAINER = "{service_id}"
# [PENDING RESEARCH] Set the actual external-mapped DB port (e.g. 5433 for host, 5432 for container)
DB_PORT = 5433
# [PENDING RESEARCH] Set the actual output table(s) and stale thresholds in minutes
STALE_CHECKS: list[dict] = [
    # {{"table": "table_name", "ts_col": "created_at", "stale_minutes": 10}},
]


def check_container() -> bool:
    result = subprocess.run(
        ["docker", "inspect", "-f", "{{{{.State.Running}}}}", CONTAINER],
        capture_output=True, text=True
    )
    running = result.stdout.strip() == "true"
    print(f"Container {CONTAINER}: {{'RUNNING' if running else 'STOPPED'}}")
    return running


def check_table_freshness() -> bool:
    """[PENDING RESEARCH] Query actual output tables with correct stale thresholds."""
    if not STALE_CHECKS:
        print("Table freshness: NOT CONFIGURED (Phase 2 required)")
        return True
    # [PENDING RESEARCH] Implement actual DB checks here
    return True


def main(as_json: bool = False) -> None:
    ok = check_container()
    ok &= check_table_freshness()
    if as_json:
        print(json.dumps({{"healthy": ok, "service": CONTAINER}}))
    else:
        print(f"\\nOverall: {{'HEALTHY' if ok else 'UNHEALTHY'}}")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--json", action="store_true")
    args = p.parse_args()
    main(as_json=args.json)
''',
        encoding="utf-8"
    )

    # log_hunter.py stub
    (scripts_dir / "log_hunter.py").write_text(
        f'''#!/usr/bin/env python3
"""Log hunter for {service_id}.

[PENDING RESEARCH] Replace generic patterns with actual error strings
found in the codebase exception handlers during Phase 2 deep dive.
"""
import json
import re
import subprocess
import sys
from collections import defaultdict

CONTAINER = "{service_id}"

# [PENDING RESEARCH] Replace with patterns sourced from the actual codebase.
# Find them with: search_for_pattern("logger.error|raise|panic!")
PATTERNS: list[tuple[str, str, str]] = [
    # ("label",            r"regex_from_codebase",    "critical|error|warning|info"),
    # Example: ("OAuth expired", r"invalid_grant|token.*expired", "critical"),
]


def hunt(tail: int = 200, since: str = "", errors_only: bool = False) -> list[dict]:
    cmd = ["docker", "logs", CONTAINER, "--tail", str(tail)]
    if since:
        cmd += ["--since", since]
    result = subprocess.run(cmd, capture_output=True, text=True)
    log_lines = (result.stdout + result.stderr).splitlines()

    hits = []
    for line in log_lines:
        for label, pattern, severity in PATTERNS:
            if re.search(pattern, line, re.IGNORECASE):
                if errors_only and severity not in ("critical", "error"):
                    continue
                hits.append({{"line": line, "label": label, "severity": severity}})
                break
    return hits


def main() -> None:
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--tail", type=int, default=200)
    p.add_argument("--since", default="")
    p.add_argument("--errors-only", action="store_true")
    p.add_argument("--json", action="store_true")
    args = p.parse_args()

    hits = hunt(args.tail, args.since, args.errors_only)

    if args.json:
        print(json.dumps(hits, indent=2))
        return

    if not PATTERNS:
        print("[PENDING RESEARCH] No patterns configured. Run Phase 2 to add service-specific patterns.")
        return

    by_sev: dict[str, list] = defaultdict(list)
    for h in hits:
        by_sev[h["severity"]].append(h)

    for sev in ("critical", "error", "warning", "info"):
        group = by_sev.get(sev, [])
        if group:
            print(f"\\n[{{sev.upper()}}] {{len(group)}} hit(s):")
            for h in group:
                print(f"  {{h['line']}}")

    if by_sev.get("critical"):
        print("\\n⚠  Critical issues detected.")
        print("   [PENDING RESEARCH] Add fix commands here during Phase 2.")


if __name__ == "__main__":
    main()
''',
        encoding="utf-8"
    )

    # data_explorer.py stub
    (scripts_dir / "data_explorer.py").write_text(
        f'''#!/usr/bin/env python3
"""Data explorer for {service_id} — read-only DB inspection.

[PENDING RESEARCH] Fill in actual table names, columns, and host port
during Phase 2 deep dive. All queries must use parameterized %s placeholders.
"""
import json
import sys

# [PENDING RESEARCH] Set the actual table and connection settings
TABLE = "[PENDING RESEARCH]"
DB_HOST = "localhost"
DB_PORT = 5433  # [PENDING RESEARCH] external mapped port, not container-internal
DB_NAME = "[PENDING RESEARCH]"
DB_USER = "postgres"


def recent_rows(limit: int = 20, as_json: bool = False) -> None:
    """[PENDING RESEARCH] Query most recent rows from the output table."""
    print(f"[PENDING RESEARCH] Implement: SELECT * FROM {{TABLE}} ORDER BY created_at DESC LIMIT %s")
    print("Use parameterized queries only — no f-strings in SQL.")


def main() -> None:
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--limit", type=int, default=20)
    p.add_argument("--json", action="store_true")
    args = p.parse_args()
    recent_rows(args.limit, args.json)


if __name__ == "__main__":
    main()
''',
        encoding="utf-8"
    )

    # references/ dir
    refs_dir = skill_dir / "references"
    refs_dir.mkdir(parents=True, exist_ok=True)
    (refs_dir / "deep_dive.md").write_text(
        f'''# Phase 2 Deep Dive Notes: {service_id}

Generated during Phase 2 agentic research. Fill every section.

## Container & Runtime

- **Entry point**: [PENDING RESEARCH]
- **Critical env vars**: [PENDING RESEARCH]
- **Volumes**: [PENDING RESEARCH]
- **Service type**: [continuous_db_writer | http_api_server | one_shot_migration | file_watcher | scheduled_poller]
- **Restart policy**: [PENDING RESEARCH]

## Data Layer

- **Output tables**: [PENDING RESEARCH]
- **Timestamp columns**: [PENDING RESEARCH]
- **Stale thresholds**: [PENDING RESEARCH]
- **External state (Redis/S3/files)**: [PENDING RESEARCH]
- **SQL parameterized**: [yes/no — check for f-string SQL anti-patterns]

## Log Patterns (from actual codebase)

```python
PATTERNS = [
    # Found via: search_for_pattern("logger.error|raise|panic!")
    ("label", r"actual_pattern_from_code", "critical"),
]
```

## Failure Modes

| Symptom | Likely Cause | Resolution |
|---------|-------------|------------|
| | | |

(Minimum 5 rows from exception handlers and README)

## Phase 2 Status

- [ ] All [PENDING RESEARCH] markers resolved in SKILL.md
- [ ] health_probe.py: container check + real table freshness
- [ ] log_hunter.py: patterns from actual codebase
- [ ] data_explorer.py: real table + parameterized queries
- [ ] Troubleshooting table has ≥5 rows
- [ ] Official docs links verified
''',
        encoding="utf-8"
    )


def create_service(
    service_id: str,
    territory_path: str,
    description: str = "",
    project_root: str | None = None,
) -> dict:
    """
    Phase 1: Create a new service skill skeleton.

    Writes to .claude/skills/<service_id>/ and registers in service-registry.json.
    """
    if project_root is None:
        try:
            project_root = get_project_root()
        except RootResolutionError as e:
            return {"error": str(e)}

    project_root_path = Path(project_root)
    territory = Path(territory_path)

    if not territory.is_absolute():
        territory = project_root_path / territory

    # Analyze territory
    analysis = analyze_directory(territory)
    if "error" in analysis:
        return analysis

    # Detect official docs
    official_docs = detect_official_docs(project_root_path, territory)

    # Build territory glob patterns
    extensions = list(analysis.get("extensions", {}).keys())
    try:
        rel_territory = territory.relative_to(project_root_path)
    except ValueError:
        rel_territory = Path(territory.name)

    territory_patterns = (
        [f"{rel_territory}/**/*{ext}" for ext in extensions]
        if extensions
        else [f"{rel_territory}/**/*"]
    )

    # Create skill directory under .claude/skills/
    skill_dir = project_root_path / ".claude" / "skills" / service_id
    skill_dir.mkdir(parents=True, exist_ok=True)

    # Generate and write SKILL.md
    skill_content = generate_skill_template(
        service_id=service_id,
        persona=analysis.get("suggested_persona", "Senior Software Engineer"),
        territory=territory_patterns,
        description=description,
        official_docs=official_docs,
    )

    skill_file = skill_dir / "SKILL.md"
    skill_file.write_text(skill_content, encoding="utf-8")

    # Write script stubs
    write_script_stubs(service_id, skill_dir)

    # Register in .claude/skills/service-registry.json
    skill_path = f".claude/skills/{service_id}/SKILL.md"
    register_service(
        service_id=service_id,
        name=service_id.replace("-", " ").title(),
        territory=territory_patterns,
        skill_path=skill_path,
        description=description,
        project_root=project_root,
    )

    return {
        "success": True,
        "service_id": service_id,
        "skill_path": str(skill_file),
        "territory": territory_patterns,
        "persona": analysis.get("suggested_persona"),
        "file_count": analysis.get("file_count", 0),
        "official_docs": official_docs,
    }


def main() -> None:
    """CLI interface for scaffolder."""
    if len(sys.argv) < 2:
        print("Usage: python scaffolder.py <command> [args...]")
        print("Commands:")
        print("  analyze <path>              - Analyze a directory")
        print("  create <id> <path> [desc]   - Create a new service skill")
        sys.exit(1)

    command = sys.argv[1]

    if command == "analyze" and len(sys.argv) > 2:
        result = analyze_directory(Path(sys.argv[2]))
        print(f"Analysis of {sys.argv[2]}:")
        for key, value in result.items():
            print(f"  {key}: {value}")

    elif command == "create" and len(sys.argv) > 3:
        service_id = sys.argv[2]
        territory_path = sys.argv[3]
        description = sys.argv[4] if len(sys.argv) > 4 else ""

        result = create_service(service_id, territory_path, description)
        if "error" in result:
            print(f"Error: {result['error']}")
            sys.exit(1)

        print(f"\n✅ Created service skill: {service_id}")
        print(f"   Persona:       {result.get('persona')}")
        print(f"   Territory:     {result.get('territory')}")
        print(f"   Files covered: {result.get('file_count')}")
        print(f"   Skill:         {result.get('skill_path')}")
        if result.get("official_docs"):
            print("   Official docs:")
            for label, url in result["official_docs"]:
                print(f"     • {label}: {url}")
        print(f"\n⚠️  Phase 2 deep dive required — SKILL.md contains [PENDING RESEARCH] markers.")

    else:
        print(f"Unknown command or missing arguments: {command}")
        sys.exit(1)


if __name__ == "__main__":
    main()
