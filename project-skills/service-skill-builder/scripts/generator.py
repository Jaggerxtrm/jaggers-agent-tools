import os
import shutil
from pathlib import Path
from typing import Dict, Any, List, Optional
from jinja2 import Environment, FileSystemLoader

class SkillGenerator:
    """Standardized generator for microservice operational skills."""

    def __init__(self, project_root: str = "."):
        self.project_root = Path(project_root).resolve()
        self.template_dir = self.project_root / ".agent" / "skills" / "service-skill-builder" / "assets" / "templates"
        self.output_dir = self.project_root / ".agent" / "skills"
        self.env = Environment(loader=FileSystemLoader(str(self.template_dir)))

    def generate_skill(self, service_name: str, config: Dict[str, Any], analysis: Dict[str, Any], audit: Dict[str, Any]) -> str:
        """Generate a complete skill package for a service."""
        skill_path = self.output_dir / service_name
        skill_path.mkdir(parents=True, exist_ok=True)
        (skill_path / "scripts").mkdir(exist_ok=True)
        (skill_path / "references").mkdir(exist_ok=True)

        # Build template data
        data = self._prepare_data(service_name, config, analysis, audit)

        # Generate SKILL.md
        template = self.env.get_template("SKILL.md.j2")
        skill_md = template.render(**data)
        (skill_path / "SKILL.md").write_text(skill_md)

        # Copy/Generate Script Archetypes
        self._generate_scripts(skill_path, service_name, config, analysis, audit)

        # Copy SSOT if found
        self._copy_ssot(skill_path, service_name)

        return str(skill_path)

    def _generate_scripts(self, skill_path: Path, service_name: str, config: Dict[str, Any], analysis: Dict[str, Any], audit: Dict[str, Any]):
        """Generate scripts based on archetypes."""
        scripts_template_dir = self.template_dir / "scripts"
        target_scripts_dir = skill_path / "scripts"

        # 1. Health Probe (Always)
        shutil.copy(scripts_template_dir / "health_probe.py", target_scripts_dir / "health_probe.py") if (scripts_template_dir / "health_probe.py").exists() else None

        # 2. Data Explorer (If DB/Redis patterns detected)
        if analysis.get("sql_queries") or analysis.get("redis_ops"):
            shutil.copy(scripts_template_dir / "data_explorer.py", target_scripts_dir / "data_explorer.py") if (scripts_template_dir / "data_explorer.py").exists() else None

        # 3. Log Hunter (Always)
        shutil.copy(scripts_template_dir / "log_hunter.py", target_scripts_dir / "log_hunter.py") if (scripts_template_dir / "log_hunter.py").exists() else None

    def _prepare_data(self, service_name: str, config: Dict[str, Any], analysis: Dict[str, Any], audit: Dict[str, Any]) -> Dict[str, Any]:
        """Flatten analysis and audit data for templating."""
        
        # Try to find a better description from SSOT if available
        ssot_info = self._get_ssot_info(service_name)
        description = config.get("description", f"Operational skill derived from {service_name} configuration.")
        if ssot_info and "description" in ssot_info:
            description = ssot_info["description"]

        # Extract Ports and Volumes
        ports = config.get("ports", [])
        volumes = config.get("volumes", [])
        
        # Resolved entrypoint from discovery
        from discovery import DiscoveryEngine
        discovery = DiscoveryEngine(self.project_root)
        resolved_paths = discovery.resolve_service_paths(config)
        entrypoint_script = resolved_paths.get("entrypoint_script")
        if entrypoint_script:
            entrypoint_script = str(Path(entrypoint_script).relative_to(self.project_root))

        data = {
            "service_name": service_name,
            "service_description": description,
            "source_file": str(Path(config.get("_source_file", "unknown")).relative_to(self.project_root)) if config.get("_source_file") != "unknown" else "unknown",
            "container_name": config.get("container_name", service_name),
            "image": config.get("image", "unknown"),
            "entry_point": " ".join(config.get("command")) if isinstance(config.get("command"), list) else config.get("command"),
            "entrypoint_script": entrypoint_script,
            "ports": ports,
            "volumes": volumes,
            "external_deps": analysis.get("dependencies", []),
            "env_vars": analysis.get("env_vars", []),
            "sql_queries": analysis.get("sql_queries", []),
            "redis_ops": analysis.get("redis_ops", []),
            "http_calls": analysis.get("http_calls", []),
            "tables": analysis.get("tables", []),
            "classes": analysis.get("classes", []),
            "functions": analysis.get("functions", []),
            "ci_cd_summary": f"Detected in {len(audit['ci_cd']['github_actions'])} GHA workflows" if audit["ci_cd"]["github_actions"] else "No CI/CD detected",
            "observability_summary": f"Metrics: {audit['observability']['metrics'] or 'None'}, Tracing: {audit['observability']['tracing']}",
            "security_summary": f"Base: {audit['security']['base_image'] or 'unknown'}, Insecure: {audit['security']['insecure_base']}, Privileged: {audit['security']['privileged']}"
        }
        return data

    def _get_ssot_info(self, service_name: str) -> Optional[Dict[str, str]]:
        """Locate SSOT and extract metadata/description."""
        ssot_dirs = [self.project_root / ".serena" / "memories", self.project_root / "docs"]
        prefixes = ["data-", "infra-", "logic-", "project-", "ext-"]
        
        for d in ssot_dirs:
            if not d.exists(): continue
            
            # 1. Direct match or variations
            potential_names = [f"{service_name}_ssot.md"]
            for p in prefixes:
                if service_name.startswith(p):
                    potential_names.append(f"{service_name[len(p):]}_ssot.md")
                potential_names.append(f"{p}{service_name}_ssot.md")
                if service_name.startswith("mmd-"):
                    potential_names.append(f"{p}{service_name[4:]}_ssot.md")

            for name in potential_names:
                ssot_file = d / name
                if ssot_file.exists():
                    content = ssot_file.read_text()
                    # Simple heuristic for description
                    desc = f"Operational skill derived from {name}"
                    lines = content.splitlines()
                    for i, line in enumerate(lines):
                        if line.startswith("# ") or "Executive Summary" in line:
                            summary_lines = []
                            for next_line in lines[i+1:i+6]:
                                if next_line.strip() and not next_line.startswith("#"):
                                    summary_lines.append(next_line.strip())
                            if summary_lines:
                                desc = " ".join(summary_lines)
                            break
                    return {"path": str(ssot_file), "description": desc}
        return None

    def _copy_ssot(self, skill_path: Path, service_name: str):
        """Locate and copy relevant SSOT to references/."""
        ssot_info = self._get_ssot_info(service_name)
        if ssot_info:
            shutil.copy(ssot_info["path"], skill_path / "references" / "architecture_ssot.md")

if __name__ == "__main__":
    # Test stub
    pass
