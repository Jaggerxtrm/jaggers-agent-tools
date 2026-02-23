import argparse
import json
import os
import sys
from pathlib import Path
from discovery import DiscoveryEngine
from analysis import AnalysisEngine
from devops_audit import DevOpsAuditor
from generator import SkillGenerator

class UniversalServiceMapper:
    """Project-agnostic microservice operational skill generator."""

    def __init__(self, project_root: str = "."):
        self.project_root = Path(project_root).resolve()
        self.discovery = DiscoveryEngine(self.project_root)
        self.analysis = AnalysisEngine(self.project_root)
        self.audit = DevOpsAuditor(self.project_root)
        self.generator = SkillGenerator(self.project_root)

    def run(self, service_name: str = None, scan: bool = False, update: bool = False):
        """Execute the mapping process."""
        services = self.discovery.map_services()
        
        if scan:
            print(f"Discovered {len(services)} services across {len(self.discovery.find_docker_anchors()['compose'])} compose files.")
            for name in sorted(services.keys()):
                print(f" - {name}")
            return

        if not service_name:
            print("Error: Specify a service name or use --scan.")
            return

        if service_name not in services:
            print(f"Error: Service '{service_name}' not found.")
            return

        print(f"Mapping service: {service_name}...")
        config = services[service_name]
        
        # 1. Resolve Paths
        paths = self.discovery.resolve_service_paths(config)
        entrypoint = paths.get("entrypoint_script") or paths.get("dockerfile")
        
        # 2. Semantic Analysis
        analysis_results = {}
        if entrypoint and entrypoint.exists():
            analysis_results = self.analysis.analyze_file(entrypoint)
        
        # 3. DevOps Audit
        audit_results = self.audit.audit_service(service_name, config)
        
        # 4. Skill Generation
        skill_path = self.generator.generate_skill(service_name, config, analysis_results, audit_results)
        print(f"Skill generated successfully at: {skill_path}")

def main():
    parser = argparse.ArgumentParser(description="Universal Service Mapper (USM)")
    parser.add_argument("service", nargs="?", help="Service name to map")
    parser.add_argument("--scan", action="store_true", help="Scan for all available services")
    parser.add_argument("--update", action="store_true", help="Update existing skill")
    parser.add_argument("--root", default=".", help="Project root directory")
    
    args = parser.parse_args()
    
    mapper = UniversalServiceMapper(args.root)
    mapper.run(service_name=args.service, scan=args.scan, update=args.update)

if __name__ == "__main__":
    main()
