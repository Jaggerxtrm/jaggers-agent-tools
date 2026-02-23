import os
import re
from pathlib import Path
from typing import Dict, List, Any, Optional

class DevOpsAuditor:
    """Audit CI/CD, Observability, and Security baseline for microservices."""

    def __init__(self, project_root: str = "."):
        self.project_root = Path(project_root).resolve()

    def audit_service(self, service_name: str, service_config: Dict[str, Any]) -> Dict[str, Any]:
        """Audit a service for DevOps readiness."""
        results = {
            "ci_cd": self._audit_ci_cd(service_name),
            "observability": self._audit_observability(service_name, service_config),
            "security": self._audit_security(service_name, service_config)
        }
        return results

    def _audit_ci_cd(self, service_name: str) -> Dict[str, Any]:
        """Identify relevant CI/CD workflows."""
        workflows = {
            "github_actions": [],
            "gitlab_ci": None,
            "jenkins": []
        }

        # GitHub Actions
        gha_dir = self.project_root / ".github" / "workflows"
        if gha_dir.exists():
            for workflow in gha_dir.glob("*.yml"):
                content = workflow.read_text().lower()
                if service_name.lower() in content:
                    workflows["github_actions"].append(str(workflow.relative_to(self.project_root)))

        # GitLab CI
        gitlab_ci = self.project_root / ".gitlab-ci.yml"
        if gitlab_ci.exists():
            content = gitlab_ci.read_text().lower()
            if service_name.lower() in content:
                workflows["gitlab_ci"] = str(gitlab_ci.relative_to(self.project_root))

        return workflows

    def _audit_observability(self, service_name: str, config: Dict[str, Any]) -> Dict[str, Any]:
        """Detect metrics, logs, and tracing."""
        obs = {
            "metrics": [],
            "structured_logging": False,
            "tracing": False
        }

        # Metrics (Prometheus endpoints)
        ports = config.get("ports", [])
        for port in ports:
            if isinstance(port, str):
                if "9090" in port or "9100" in port or "9464" in port:
                    obs["metrics"].append(port)
            elif isinstance(port, dict):
                target = port.get("target")
                if target in [9090, 9100, 9464]:
                    obs["metrics"].append(str(target))

        # Check for OTel environment variables
        env = config.get("environment", {})
        if isinstance(env, dict):
            if any(k.startswith("OTEL_") for k in env):
                obs["tracing"] = True
        elif isinstance(env, list):
            if any(str(v).startswith("OTEL_") for v in env):
                obs["tracing"] = True

        return obs

    def _audit_security(self, service_name: str, config: Dict[str, Any]) -> Dict[str, Any]:
        """Baseline security audit."""
        sec = {
            "base_image": None,
            "insecure_base": False,
            "privileged": config.get("privileged", False),
            "root_user": True  # Default to True unless 'user' is specified
        }

        # User check
        if "user" in config:
            sec["root_user"] = False

        # Dockerfile analysis
        build = config.get("build")
        dockerfile_path = None
        if isinstance(build, str):
            dockerfile_path = self.project_root / build / "Dockerfile"
        elif isinstance(build, dict):
            context = build.get("context", ".")
            dockerfile = build.get("dockerfile", "Dockerfile")
            dockerfile_path = self.project_root / context / dockerfile

        if dockerfile_path and dockerfile_path.exists():
            content = dockerfile_path.read_text()
            from_match = re.search(r"FROM\s+(\S+)", content, re.IGNORECASE)
            if from_match:
                sec["base_image"] = from_match.group(1)
                # Simple check for 'latest' tag
                if ":latest" in sec["base_image"] or ":" not in sec["base_image"]:
                    sec["insecure_base"] = True

        return sec

if __name__ == "__main__":
    auditor = DevOpsAuditor()
    # print(auditor.audit_service("ext-summarizer", {"build": "external-ingestion-pipeline"}))
