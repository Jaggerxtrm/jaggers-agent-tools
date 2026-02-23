#!/usr/bin/env python3
"""Health check system for service skills with drift detection and schema awareness"""
import os
import yaml
import sys
import shutil
import subprocess
from datetime import datetime
from pathlib import Path
from dataclasses import dataclass, asdict

@dataclass
class SkillStatus:
    service_name: str
    status: str  # healthy, stale, missing, error
    last_updated: str
    issues: list[str]
    recommendations: list[str]
    ssot_version: str = ""

class SkillHealthChecker:
    """Health check system for service skills"""

    def __init__(self, project_root: Path):
        self.project_root = project_root
        self.skills_dir = project_root / ".claude" / "skills"
        self.memories_dir = project_root / ".serena" / "memories"

        # Compose files to scan
        self.compose_files = [
            project_root / "docker-compose.yml",
            project_root / "psql-db" / "docker-compose.yml",
            project_root / "mercury-api" / "infra" / "docker-compose.production.yml",
            project_root / "external-ingestion-pipeline" / "infra" / "docker-compose.yml",
            project_root / "external-qwen-service" / "infra" / "docker-compose.yml",
            project_root / "research-papers-pipeline" / "infra" / "docker-compose.yml",
        ]

    def discover_services(self) -> set[str]:
        """Discover all services from compose files"""
        services = set()
        for compose_file in self.compose_files:
            if not compose_file.exists(): continue
            with open(compose_file) as f:
                try:
                    compose_data = yaml.safe_load(f) or {}
                    if "services" in compose_data:
                        for s in compose_data["services"].keys():
                            if s != "mercury-base": services.add(s)
                except: continue
        return services

    def _get_service_modification_time(self, service_name: str) -> datetime | None:
        """Find most recent modification in service source code"""
        # Logic to map service to directory
        mapping = {
            "postgres-dev": "psql-db",
            "pgbouncer": "psql-db/pgbouncer-config",
            "mercury-api": "mercury-api/src",
            "qwen-service": "external-qwen-service/src",
            "ext-summarizer": "external-ingestion-pipeline/summarizer.py",
            "ext-multi-source": "external-ingestion-pipeline/multi_source_collector.py"
        }
        
        path_str = mapping.get(service_name)
        if not path_str: return None
        
        path = self.project_root / path_str
        if not path.exists(): return None
        
        if path.is_file():
            return datetime.fromtimestamp(path.stat().st_mtime)
        
        # For directories, find newest file
        newest = 0.0
        for root, _, files in os.walk(path):
            for f in files:
                f_path = Path(root) / f
                newest = max(newest, f_path.stat().st_mtime)
        return datetime.fromtimestamp(newest)

    def check_service_skill(self, service_name: str) -> SkillStatus:
        skill_dir = self.skills_dir / service_name
        if service_name == "postgres-stack": # Alias check
             skill_dir = self.skills_dir / "postgres-stack"
             
        skill_md = skill_dir / "SKILL.md"
        skill_exists = skill_md.exists()
        
        issues = []
        recommendations = []
        status = "healthy"
        
        if not skill_exists:
            return SkillStatus(service_name, "missing", "", [], ["Create skill"])

        skill_mtime = datetime.fromtimestamp(skill_md.stat().st_mtime)
        
        # Special check for postgres-stack schema freshness
        if service_name in ["postgres-dev", "postgres-stack"]:
            schema_script = skill_dir / "scripts" / "map_schema.py"
            schema_summary = skill_dir / "references" / "database_schema_summary.md"
            if schema_script.exists() and schema_summary.exists():
                summary_mtime = datetime.fromtimestamp(schema_summary.stat().st_mtime)
                # If summary is older than 1 hour, it might be stale relative to DB state
                # In a real check we'd compare with DB migration history
                if (datetime.now() - summary_mtime).seconds > 3600:
                    status = "stale"
                    issues.append("Database schema documentation potentially stale")
                    recommendations.append("Run python3 scripts/map_schema.py to refresh")

        return SkillStatus(service_name, status, skill_mtime.isoformat(), issues, recommendations)

    def run_all_checks(self):
        services = self.discover_services()
        # Add logical stacks
        services.add("postgres-stack")
        
        results = []
        for s in sorted(services):
            results.append(self.check_service_skill(s))
        return results

def main():
    checker = SkillHealthChecker(Path.cwd())
    results = checker.run_all_checks()
    
    print(f"Skill Health Report - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("="*70)
    
    for r in results:
        if r.status != "missing":
            icon = "✓" if r.status == "healthy" else "⚠"
            print(f"{icon} {r.service_name:<25} | {r.status.upper()}")
            for issue in r.issues:
                print(f"  - ISSUE: {issue}")
            for rec in r.recommendations:
                print(f"  - REC: {rec}")

if __name__ == "__main__":
    main()
