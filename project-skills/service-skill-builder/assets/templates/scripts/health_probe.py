import os
import requests
from typing import Dict, Any, List, Optional

class HealthProbe:
    """Project-agnostic health checker for microservices."""

    def __init__(self, service_name: str, config: Dict[str, Any]):
        self.service_name = service_name
        self.config = config
        self.ports = self._extract_ports()

    def _extract_ports(self) -> List[int]:
        """Extract exposed/published ports from config."""
        ports = []
        raw_ports = self.config.get("ports", [])
        for p in raw_ports:
            if isinstance(p, str):
                if ":" in p:
                    ports.append(int(p.split(":")[1]))
                else:
                    ports.append(int(p))
            elif isinstance(p, dict):
                ports.append(p.get("target", 80))
        return ports

    def check_health(self) -> Dict[str, Any]:
        """Run health checks on all detected ports."""
        results = {
            "status": "HEALTHY",
            "ports": {}
        }

        # Check common health endpoints
        for port in self.ports:
            port_res = {"endpoint": f"http://localhost:{port}/health", "status": "PENDING"}
            try:
                response = requests.get(port_res["endpoint"], timeout=2)
                if response.status_code == 200:
                    port_res["status"] = "UP"
                else:
                    port_res["status"] = f"DOWN ({response.status_code})"
                    results["status"] = "UNHEALTHY"
            except Exception as e:
                port_res["status"] = f"ERROR ({str(e)})"
                results["status"] = "UNHEALTHY"
            
            results["ports"][port] = port_res

        return results

if __name__ == "__main__":
    # Test script will be populated during generation
    import json
    # Mock config
    config = {"ports": ["8080:80"]}
    probe = HealthProbe("test-service", config)
    print(json.dumps(probe.check_health(), indent=2))
