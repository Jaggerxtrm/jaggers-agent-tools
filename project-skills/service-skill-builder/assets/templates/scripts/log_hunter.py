import os
import subprocess
import re
import argparse
import json
from typing import Dict, List, Any, Optional

class LogHunter:
    """Project-agnostic log analyzer and anomaly detector for microservices."""

    def __init__(self, service_name: str, config: Dict[str, Any]):
        self.service_name = service_name
        self.config = config
        self.container_name = self.config.get("container_name", service_name)
        self.error_patterns = [
            r"(ERROR|CRITICAL|FATAL|EXCEPTION)",
            r"ConnectionError",
            r"TimeoutError",
            r"SyntaxError",
            r"ImportError"
        ]

    def hunt_anomalies(self, tail: int = 100) -> List[str]:
        """Tails logs and identifies anomalies."""
        try:
            cmd = ["docker", "logs", "--tail", str(tail), self.container_name]
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            logs = result.stdout + result.stderr
            
            anomalies = []
            for line in logs.splitlines():
                if any(re.search(p, line, re.IGNORECASE) for p in self.error_patterns):
                    anomalies.append(line)
            
            return anomalies
        except Exception as e:
            return [f"Error fetching logs: {str(e)}"]

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Log Hunter CLI")
    parser.add_argument("--tail", type=int, default=100, help="Number of lines to tail")
    args = parser.parse_args()
    
    # Test script will be populated during generation
    hunter = LogHunter("test-service", {})
    anomalies = hunter.hunt_anomalies(tail=args.tail)
    print(json.dumps(anomalies, indent=2))
