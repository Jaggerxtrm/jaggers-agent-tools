import os
import re
import yaml
from pathlib import Path
from typing import Dict, List, Any, Optional

class DiscoveryEngine:
    """Project-agnostic discovery for Docker-based microservices."""

    def __init__(self, project_root: str = "."):
        self.project_root = Path(project_root).resolve()
        self.ignore_dirs = {".git", ".venv", "node_modules", "__pycache__", ".pytest_cache", ".mypy_cache"}

    def find_docker_anchors(self) -> Dict[str, List[Path]]:
        """Recursively find docker-compose and Dockerfiles."""
        anchors = {
            "compose": [],
            "dockerfiles": [],
            "iac": []  # Terraform, Helm, etc.
        }

        for root, dirs, files in os.walk(self.project_root):
            # Prune ignored directories
            dirs[:] = [d for d in dirs if d not in self.ignore_dirs]
            
            rel_root = Path(root)
            for file in files:
                if file.startswith("docker-compose") and (file.endswith(".yml") or file.endswith(".yaml")):
                    anchors["compose"].append(rel_root / file)
                elif file == "Dockerfile" or file.endswith(".Dockerfile"):
                    anchors["dockerfiles"].append(rel_root / file)
                elif file == "Chart.yaml" or file.endswith(".tf"):
                    anchors["iac"].append(rel_root / file)

        return anchors

    def map_services(self) -> Dict[str, Any]:
        """Map all services across found compose files."""
        anchors = self.find_docker_anchors()
        services = {}

        for compose_file in anchors["compose"]:
            try:
                with open(compose_file, "r") as f:
                    data = yaml.safe_load(f)
                
                if not data or "services" not in data:
                    continue

                for name, config in data["services"].items():
                    # Preserve context: where was this service defined?
                    config["_source_file"] = str(compose_file)
                    config["_abs_source_path"] = str(compose_file.resolve())
                    
                    # If service already exists, merge or handle conflict
                    # For now, we'll prefix with compose file name if conflict occurs
                    if name in services:
                        unique_name = f"{compose_file.stem}_{name}"
                        services[unique_name] = config
                    else:
                        services[name] = config
            except Exception as e:
                print(f"Error parsing {compose_file}: {e}")

        return services

    def resolve_service_paths(self, service_config: Dict[str, Any]) -> Dict[str, Optional[Path]]:
        """Resolve physical paths for a service (build context, volumes)."""
        source_file = Path(service_config.get("_source_file", "."))
        compose_dir = source_file.parent
        
        paths = {
            "build_context": None,
            "dockerfile": None,
            "entrypoint_script": None
        }

        # Build Context
        build = service_config.get("build")
        if isinstance(build, str):
            paths["build_context"] = (compose_dir / build).resolve()
        elif isinstance(build, dict):
            context = build.get("context", ".")
            paths["build_context"] = (compose_dir / context).resolve()
            dockerfile = build.get("dockerfile", "Dockerfile")
            if paths["build_context"]:
                paths["dockerfile"] = (paths["build_context"] / dockerfile).resolve()

        # Entrypoint/Command Resolution
        command = service_config.get("command")
        if command:
            if isinstance(command, list):
                cmd_arg = command[0]
            else:
                cmd_arg = str(command).split()[0]
            
            # 1. Direct Python script in command
            if cmd_arg.endswith(".py"):
                if paths["build_context"]:
                    paths["entrypoint_script"] = (paths["build_context"] / cmd_arg).resolve()
                else:
                    paths["entrypoint_script"] = (compose_dir / cmd_arg).resolve()
            
            # 2. Map via docker-entrypoint.sh if available
            elif paths["build_context"]:
                entrypoint_sh = paths["build_context"] / "scripts" / "docker-entrypoint.sh"
                if not entrypoint_sh.exists():
                     entrypoint_sh = paths["build_context"] / "docker-entrypoint.sh"
                
                if entrypoint_sh.exists():
                    mapped_file = self._parse_entrypoint_script(entrypoint_sh, cmd_arg)
                    if mapped_file:
                        paths["entrypoint_script"] = (paths["build_context"] / mapped_file).resolve()

        return paths

    def _parse_entrypoint_script(self, entrypoint_path: Path, cmd_arg: str) -> Optional[str]:
        """Simple regex parser to find python script mapped to a command arg in sh."""
        try:
            content = entrypoint_path.read_text()
            # Look for case) ... python path/to/script.py
            pattern = rf"{cmd_arg}\).*?python[3]?\s+([/\w\._-]+\.py)"
            match = re.search(pattern, content, re.DOTALL)
            if match:
                return match.group(1).lstrip("/")
            
            # Look for module calls: python -m module.name
            pattern_m = rf"{cmd_arg}\).*?python[3]?\s+-m\s+([\w\._-]+)"
            match_m = re.search(pattern_m, content, re.DOTALL)
            if match_m:
                # Convert module to path (heuristic: mcp_server.mcp_server -> mcp_server/mcp_server.py)
                return match_m.group(1).replace(".", "/") + ".py"

            # Look for uvicorn calls: uvicorn module:app
            pattern_u = rf"{cmd_arg}\).*?uvicorn\s+([\w\._-]+):"
            match_u = re.search(pattern_u, content, re.DOTALL)
            if match_u:
                return match_u.group(1).replace(".", "/") + ".py"

        except Exception:
            pass
        return None

if __name__ == "__main__":
    engine = DiscoveryEngine()
    services = engine.map_services()
    print(f"Found {len(services)} services.")
    for name in services:
        print(f" - {name}")
