#!/usr/bin/env python3
"""
Service Skill Generator for darth_feedor.

Scans Docker Compose files, analyzes SSOT documentation, and explores code
to generate comprehensive service-specific skills.

Usage:
    # Scan for available services
    python3 generate_service_skill.py --scan

    # Generate skill for specific service
    python3 generate_service_skill.py ext-newsletters

    # Update existing skill
    python3 generate_service_skill.py ext-newsletters --update
"""

import argparse
import ast
import re
from pathlib import Path
from typing import Any

import yaml

# Template for SKILL.md
SKILL_TEMPLATE = """---
name: {service_name}
description: Specialized knowledge for {service_name} service in darth_feedor. Covers architecture, operational patterns, troubleshooting, data flows, and integration with dependencies. Use when debugging {service_name} issues, analyzing performance, checking data freshness, or understanding functionality.
---

# {service_title} Skill

## Service Overview
{description}

## Architecture
**Container:** `{container_name}`
**Entry Point:** `{command}`
**Dependencies:** {dependencies}
**Ports:** {ports}
**Volumes:**
{volumes}

**Source Files:**
{source_files}

## Data Flows
{data_flows}

## Integration Points
- **Database:** Postgres (Host: {db_host})
- **Redis:** Redis (Host: {redis_host})
- **External Services:** {external_services}
- **Specialist:** {specialist_path}

## Database Interactions
{db_interactions}

## Redis Usage
{redis_usage}

## Environment Variables
{env_vars}

## Common Operations
[TODO: Add common operational tasks]

## Troubleshooting Guide
[TODO: Add common issues and resolutions]

<!-- SEMANTIC_START -->
## Semantic Deep Dive (Human/Agent Refined)
[This section is protected from automatic overwrites. Add your expert findings here.]
<!-- SEMANTIC_END -->

## Scripts
- `health_check.py` - Service health validation
- `code_quality.py` - Code integrity checks
- `log_analyzer.py` - Log pattern analysis
- `db_query.py` - Safe database inspection
- `db_helper.py` - Database connection pooling
- `validate_config.py` - Configuration validation

## References
- `architecture_ssot.md` - Complete SSOT documentation (auto-copied from .serena/memories)
"""

# Template for REFINEMENT_BRIEF.md
REFINEMENT_BRIEF_TEMPLATE = """# Refinement Brief: {service_name}

**Status:** AUTO-GENERATED (Skeleton)
**Date:** {date}

## 1. Mission
This skill was generated using static AST analysis. Your job is to perform a **Semantic Deep Dive** to upgrade it to "Human-Expert" level.

## 2. Target Areas
The static analysis identified the following areas that require semantic understanding:

### A. Entry Point Logic
- **File:** `{entry_point}`
- **Task:** Trace the execution flow from `if __name__ == "__main__":` (or equivalent). Identify the main event loop or request handler.

### B. Data Persistence (Critical)
- **Detected SQL:**
{sql_queries}
- **Task:** Find *where* and *how* these queries are executed. Look for:
  - Batching logic
  - Transaction management
  - Error handling / retries

### C. State Management
- **Detected Redis:**
{redis_keys}
- **Task:** Determine the read/write patterns for these keys. Is it Pub/Sub? Caching? Locking?

### D. External Interactions
- **Detected Calls:**
{external_calls}
- **Task:** Identify the retry logic and timeout policies for these calls.

## 3. Deliverables
1.  **Update `SKILL.md`**: Replace generic lists with detailed logical explanations.
2.  **Create `references/deep_dive.md`**: (Optional) If the logic is complex, document the full data flow here.
3.  **Verify Scripts**: Check if `health_check.py` needs custom logic (e.g., checking a specific Redis key).\n4.  **Define Standard Queries**: Populate `scripts/db_query.py` with 4-5 essential SELECT queries for inspecting service state (e.g. recent items, error counts, status summaries).

## 4. Tools to Use
- `mcp__mercury__serena` (Symbolic analysis)
- `find_symbol`
- `find_referencing_symbols`
- `get_symbols_overview`
"""

# Template for health_check.py
HEALTH_CHECK_TEMPLATE = """#!/usr/bin/env python3
\"\"\"Health check for {service_name} service cluster\"\"\"
import os
import sys
import subprocess
from datetime import datetime

def check_container_status(container_name):
    \"\"\"Verify container is running\"\"\"
    try:
        result = subprocess.run(
            ["docker", "inspect", "-f", "{{{{.State.Running}}}}", container_name],
            capture_output=True,
            text=True
        )
        is_running = result.stdout.strip() == "true"
        print(f"Container {{container_name:<25}}: {{'RUNNING' if is_running else 'STOPPED'}}")
        return is_running
    except Exception as e:
        print(f"Error checking container {{container_name}}: {{e}}")
        return False

def main():
    print(f"Health Check: {service_name} Cluster")
    print("-" * 50)

    containers = {container_list}

    overall_status = True
    for container in containers:
        overall_status &= check_container_status(container)

    print("-" * 50)
    if overall_status:
        print("Overall Cluster Status: HEALTHY")
        sys.exit(0)
    else:
        print("Overall Cluster Status: UNHEALTHY")
        sys.exit(1)

if __name__ == '__main__':
    main()
"""

# Template for db_helper.py
DB_HELPER_TEMPLATE = '''#!/usr/bin/env python3
"""Database helper for {service_name} service

Provides connection pooling and query execution utilities.
Automatically loads credentials from .env file.
"""
import os
import sys
from pathlib import Path
from dotenv import load_dotenv

# Load environment from project root
# From .claude/skills/{service_name}/scripts/db_helper.py go up 5 levels
project_root = Path(__file__).resolve().parent.parent.parent.parent.parent
env_file = project_root / ".env"
if env_file.exists():
    load_dotenv(env_file)
    print(f"Loaded environment from {{{{env_file}}}}")
else:
    print(f"Warning: {{{{env_file}}}} not found", file=sys.stderr)

# Import shared database utilities
sys.path.insert(0, str(project_root / "shared"))
from db_pool import get_pool

def execute_query(query, params=None, fetch=True):
    """Execute SQL query using project connection pool

    Args:
        query: SQL query string
        params: Query parameters (tuple or dict)
        fetch: If True, return results; if False, commit transaction

    Returns:
        List of rows (if fetch=True) or None
    """
    pool = get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute(query, params)
            if fetch:
                return cur.fetchall()
            else:
                conn.commit()
    finally:
        pool.putconn(conn)

def main():
    """Example usage"""
    print("Database Helper for {service_name}")
    print("-" * 50)

    # Example: Count rows in a table
    # result = execute_query("SELECT COUNT(*) FROM your_table")
    # print(f"Row count: {{{{result[0][0]}}}}")

    print("No example queries defined. Edit this script to add custom queries.")

if __name__ == "__main__":
    main()
'''


# Template for db_query.py
DB_QUERY_TEMPLATE = '''#!/usr/bin/env python3
"""Database Query Tool for {service_name}

Executes read-only queries against the database to inspect state.
SAFE: Only allows SELECT queries.
"""
import sys
import argparse
from pathlib import Path

# Import db_helper from same directory
sys.path.insert(0, str(Path(__file__).parent))
try:
    from db_helper import execute_query
except ImportError:
    print("Error: db_helper.py not found. Please ensure it exists in the scripts directory.", file=sys.stderr)
    sys.exit(1)

def run_custom_query(query):
    """Run a custom SQL query safely"""
    query = query.strip()
    if not query.upper().startswith("SELECT"):
        print("Error: Only SELECT queries are allowed for safety.", file=sys.stderr)
        sys.exit(1)

    print(f"Executing: {{query}}")
    print("-" * 50)

    try:
        results = execute_query(query, fetch=True)
        if not results:
            print("No results found.")
            return

        # Basic printing
        for row in results:
            print(row)

        print("-" * 50)
        print(f"Total rows: {{len(results)}}")

    except Exception as e:
        print(f"Query execution failed: {{e}}", file=sys.stderr)

def main():
    parser = argparse.ArgumentParser(description="Execute safe DB queries for {service_name}")
    parser.add_argument("query", nargs="?", help="SQL query to execute (must be SELECT)")
    parser.add_argument("--list", action="store_true", help="List common queries")
    args = parser.parse_args()

    if args.list:
        print("Common Queries (TODO: Add specific queries for this service):")
        print("  1. SELECT count(*) FROM table_name")
        return

    if not args.query:
        print("Please provide a query or use --list")
        parser.print_help()
        return

    run_custom_query(args.query)

if __name__ == "__main__":
    main()
'''


class CodeAnalyzer:
    """Analyzes source code for patterns using AST"""

    def __init__(self, project_root: Path):
        self.project_root = project_root

    def analyze_file(self, file_path: Path) -> dict[str, Any]:
        """Deep analysis of a single file"""
        if not file_path.exists():
            return {}

        try:
            content = file_path.read_text(encoding="utf-8", errors="ignore")
            tree = ast.parse(content)
        except Exception as e:
            print(f"Error reading/parsing {file_path}: {e}")
            return {}

        results: dict[str, Any] = {
            "sql_queries": [],
            "redis_keys": [],
            "env_vars": set(),
            "external_calls": [],
            "log_patterns": [],
            "classes": [],
            "imports": [],
        }

        class Visitor(ast.NodeVisitor):
            def visit_Call(self, node):
                # Check for calls like object.method()
                if isinstance(node.func, ast.Attribute) and isinstance(node.func.value, ast.Name):
                    # Check for redis calls: redis_client.method("key")
                    if "redis" in node.func.value.id:
                        if node.args and isinstance(node.args[0], ast.Constant):
                            results["redis_keys"].append(f"{node.func.attr}: {node.args[0].value}")

                    # Check for external calls: requests.get("url")
                    if node.func.value.id in ["requests", "httpx"]:
                        if node.args and isinstance(node.args[0], ast.Constant):
                            results["external_calls"].append(
                                f"{node.func.attr.upper()} {node.args[0].value}"
                            )

                    # Check for env vars: os.getenv("KEY")
                    if node.func.value.id == "os":
                        if node.func.attr in ["getenv", "environ"]:
                            if node.args and isinstance(node.args[0], ast.Constant):
                                results["env_vars"].add(node.args[0].value)

                self.generic_visit(node)

            def visit_ClassDef(self, node):
                results["classes"].append(node.name)
                self.generic_visit(node)

            def visit_ImportFrom(self, node):
                if node.module:
                    results["imports"].append(node.module)
                self.generic_visit(node)

        Visitor().visit(tree)

        # Regex fallback for SQL (since they are often strings)
        sql_patterns = [
            r"SELECT\s+.*?\s+FROM",
            r"INSERT\s+INTO",
            r"UPDATE\s+\w+\s+SET",
            r"DELETE\s+FROM",
            r"CREATE\s+TABLE",
        ]
        for line in content.splitlines():
            for pattern in sql_patterns:
                if re.search(pattern, line, re.IGNORECASE):
                    results["sql_queries"].append(line.strip())
                    break

        return results


class ServiceSkillGenerator:
    # Mappatura dei servizi in gruppi logici per evitare frammentazione
    SKILL_GROUPS = {
        "redis-stack": [
            "redis-master",
            "redis-replica",
            "redis-dev",
            "sentinel1",
            "sentinel2",
            "sentinel3",
        ],
        "postgres-stack": ["postgres-dev", "pgbouncer"],
        "monitoring-stack": ["prometheus", "grafana"],
    }

    def __init__(self, project_root: Path):
        self.project_root = project_root
        self.skills_dir = project_root / ".claude" / "skills"
        self.analyzer = CodeAnalyzer(project_root)

        # Compose files to scan
        self.compose_files = [
            project_root / "docker-compose.yml",
            project_root / "psql-db" / "docker-compose.yml",
            project_root / "mercury-api" / "infra" / "docker-compose.production.yml",
            project_root / "external-ingestion-pipeline" / "infra" / "docker-compose.yml",
            project_root / "external-qwen-service" / "infra" / "docker-compose.yml",
            project_root / "research-papers-pipeline" / "infra" / "docker-compose.yml",
        ]

    def scan_services(self) -> dict[str, dict[str, Any]]:
        """Scan all compose files for services"""
        services = {}

        for compose_file in self.compose_files:
            if not compose_file.exists():
                continue

            try:
                with open(compose_file) as f:
                    data = yaml.safe_load(f)

                if "services" in data:
                    for name, config in data["services"].items():
                        # Add source file metadata
                        config["_source_file"] = str(compose_file)
                        services[name] = config
            except Exception as e:
                print(f"Error reading {compose_file}: {e}")

        return services

    def _find_ssot(self, service_name: str) -> Path | None:
        """Find SSOT file"""
        memories_dir = self.project_root / ".serena" / "memories"
        # Exact match
        ssot = memories_dir / f"{service_name}_ssot.md"
        if ssot.exists():
            return ssot
        # Without prefix
        if service_name.startswith("ext-"):
            ssot = memories_dir / f"{service_name[4:]}_ssot.md"
            if ssot.exists():
                return ssot
        return None

    def _extract_ssot_content(self, ssot_path: Path | None) -> str:
        """Read SSOT content"""
        if not ssot_path or not ssot_path.exists():
            return "No SSOT documentation found."
        try:
            return ssot_path.read_text()
        except:
            return "Error reading SSOT."

    def generate_skill(self, service_name: str, update: bool = False, brief_only: bool = False):
        """Generate skill for a specific service"""
        services = self.scan_services()

        if service_name not in services:
            print(f"Error: Service '{service_name}' not found in any Docker Compose file.")
            return

        # Risoluzione del nome della skill (Grouped or Single)
        actual_skill_name = service_name
        related_services = [service_name]

        for group_name, members in self.SKILL_GROUPS.items():
            if service_name in members:
                actual_skill_name = group_name
                related_services = members
                break

        config = services[service_name]
        skill_dir = self.skills_dir / actual_skill_name

        if brief_only:
            print(f"  - Running in BRIEF-ONLY mode for {service_name}")
        elif skill_dir.exists() and not update:
            print(f"Skill '{service_name}' already exists. Use --update to overwrite.")
            return

        # Create directory structure
        skill_dir.mkdir(parents=True, exist_ok=True)
        (skill_dir / "scripts").mkdir(exist_ok=True)
        (skill_dir / "references").mkdir(exist_ok=True)

        # Extract metadata
        container_name = config.get("container_name", service_name)
        command_list = config.get("command", [])
        command_str = str(command_list)

        # Analyze entry point
        entry_point_file = None
        if isinstance(command_list, list):
            for part in [str(c) for c in command_list]:
                if part.endswith(".py"):
                    # Try to resolve file
                    potential_path: Path = self.project_root / part
                    if potential_path.exists():
                        entry_point_file: Path | None = potential_path
                    else:
                        # Try finding it relative to build context
                        pass  # TODO: handle relative paths better

        # Code Analysis
        analysis = {}
        if entry_point_file:
            analysis = self.analyzer.analyze_file(entry_point_file)

        # SSOT Content
        ssot_path = self._find_ssot(service_name)
        ssot_content = self._extract_ssot_content(ssot_path)

        # Parse SSOT description (simple extraction)
        description = "Service documentation not available."
        if ssot_path:
            lines = ssot_content.splitlines()
            for i, line in enumerate(lines):
                if line.startswith("# ") or line.startswith("## Executive Summary"):
                    # Grab next few paragraphs
                    description = "\\n".join(lines[i + 1 : i + 10])
                    break

        # Format DB Interactions
        db_interactions = "None detected"
        if analysis.get("sql_queries"):
            db_interactions = "Detected SQL Queries:\\n" + "\\n".join(
                [f"- `{q}`" for q in analysis["sql_queries"]]
            )

        # Format Redis Usage
        redis_usage = "None detected"
        if analysis.get("redis_keys"):
            redis_usage = "Detected Redis Patterns:\\n" + "\\n".join(
                [f"- `{k}`" for k in analysis["redis_keys"]]
            )

        # Format Env Vars
        env_vars = "Detected Environment Variables:\\n" + "\\n".join(
            [f"- `{e}`" for e in analysis.get("env_vars", [])]
        )

        # Environment - standardized extraction
        env = config.get("environment", [])
        env_dict = {}
        if isinstance(env, dict):
            env_dict = env
        elif isinstance(env, list):
            for item in env:
                if "=" in str(item):
                    k, v = str(item).split("=", 1)
                    env_dict[k] = v

        db_host = str(env_dict.get("DB_HOST", "Unknown"))
        redis_host = str(env_dict.get("REDIS_HOST", "Unknown"))

        # Generate SKILL.md
        skill_path = skill_dir / "SKILL.md"
        if (not skill_path.exists() or update) and not brief_only:
            try:
                skill_content = SKILL_TEMPLATE.format(
                    service_name=actual_skill_name,
                    service_title=actual_skill_name.replace("-", " ").title(),
                    description=description,
                    container_name=container_name,
                    command=command_str,
                    dependencies="None detected",
                    ports="None detected",
                    volumes="None detected",
                    source_files=entry_point_file.name if entry_point_file else "None detected",
                    data_flows="None detected",
                    db_host=db_host,
                    redis_host=redis_host,
                    external_services="None detected",
                    specialist_path="None detected",
                    db_interactions=db_interactions,
                    redis_usage=redis_usage,
                    env_vars=env_vars,
                )
                skill_path.write_text(skill_content)
                print("  - Generated SKILL.md")
            except Exception as e:
                print(f"Error generating SKILL.md: {e}")
        elif skill_path.exists():
            print("  - Skipping SKILL.md (exists)")

        if brief_only:
            # Generate REFINEMENT_BRIEF.md
            from datetime import datetime

            brief_content = REFINEMENT_BRIEF_TEMPLATE.format(
                service_name=service_name,
                date=datetime.now().strftime("%Y-%m-%d"),
                entry_point=(
                    f"{entry_point_file.relative_to(self.project_root)}"
                    if entry_point_file
                    else "Not detected"
                ),
                sql_queries="\n".join([f"  - `{q}`" for q in analysis.get("sql_queries", [])])
                or "  - None detected",
                redis_keys="\n".join([f"  - `{k}`" for k in analysis.get("redis_keys", [])])
                or "  - None detected",
                external_calls="\n".join([f"  - `{c}`" for c in analysis.get("external_calls", [])])
                or "  - None detected",
            )
            with open(skill_dir / "REFINEMENT_BRIEF.md", "w") as f:
                f.write(brief_content)

        # Generate DB Helper
        db_helper_path = skill_dir / "scripts" / "db_helper.py"
        if not db_helper_path.exists():
            db_helper_content = DB_HELPER_TEMPLATE.format(service_name=service_name)
            db_helper_path.write_text(db_helper_content)
            print(f"  - Generated {db_helper_path.name}")

        # Generate DB Query Tool
        db_query_path = skill_dir / "scripts" / "db_query.py"
        if not db_query_path.exists() or update:
            db_query_content = DB_QUERY_TEMPLATE.format(service_name=service_name)
            db_query_path.write_text(db_query_content)
            print(f"  - Generated {db_query_path.name}")
        else:
            print(f"  - Skipping {db_query_path.name} (exists)")

        # Generate Health Check
        health_check_path = skill_dir / "scripts" / "health_check.py"
        if not health_check_path.exists():
            health_check = HEALTH_CHECK_TEMPLATE.format(
                service_name=actual_skill_name, container_list=str(related_services)
            )
            health_check_path.write_text(health_check)
        else:
            print(f"  - Skipping {health_check_path.name} (exists)")

        # Generate Quality/Log Stubs
        for stub_name, stub_title in [
            ("code_quality.py", "Code Quality"),
            ("log_analyzer.py", "Log Analysis"),
        ]:
            stub_path = skill_dir / "scripts" / stub_name
            if not stub_path.exists():
                stub_content = f'''#!/usr/bin/env python3
"""{stub_title} for {service_name}"""
import sys

def main():
    print(f"{stub_title}: {service_name}")
    print("This script is a placeholder. Add your implementation here.")

if __name__ == '__main__':
    main()
'''
                stub_path.write_text(stub_content)
                print(f"  - Generated {stub_name}")
            else:
                print(f"  - Skipping {stub_name} (exists)")

        print(f"Successfully generated EXPERT skill for {service_name} at {skill_dir}")


def main():
    parser = argparse.ArgumentParser(description="Service Skill Generator")
    parser.add_argument("service_name", nargs="?", help="Service to generate skill for")
    parser.add_argument("--scan", action="store_true", help="Scan for available services")
    parser.add_argument("--update", action="store_true", help="Update existing skill")
    parser.add_argument("--brief-only", action="store_true", help="Only update REFINEMENT_BRIEF.md")

    args = parser.parse_args()

    project_root = Path("/home/jagger/projects/darth_feedor")
    generator = ServiceSkillGenerator(project_root)

    if args.scan:
        services = generator.scan_services()
        print("Available Services:")
        for name, config in sorted(services.items()):
            container = config.get("container_name", "N/A")
            print(f"  - {name:<25} (Container: {container})")

    elif args.service_name:
        generator.generate_skill(args.service_name, args.update, args.brief_only)

    else:
        parser.print_help()


if __name__ == "__main__":
    main()
