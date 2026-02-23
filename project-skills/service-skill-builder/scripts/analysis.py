import ast
import re
from pathlib import Path
from typing import Dict, Any, List, Optional

class AnalysisEngine:
    """Language-agnostic code analyzer for microservices."""

    def __init__(self, project_root: str = "."):
        self.project_root = Path(project_root).resolve()

    def analyze_file(self, file_path: Path) -> Dict[str, Any]:
        """Entrypoint for file analysis."""
        if not file_path or not file_path.exists():
            return {}

        suffix = file_path.suffix
        if suffix == ".py":
            return self._analyze_python(file_path)
        elif suffix in [".js", ".ts"]:
            return self._analyze_javascript(file_path)
        else:
            return self._analyze_generic(file_path)

    def _analyze_python(self, file_path: Path) -> Dict[str, Any]:
        """AST-based Python analysis."""
        try:
            content = file_path.read_text()
            tree = ast.parse(content)
        except Exception:
            return self._analyze_generic(file_path)

        analysis = {
            "sql_queries": [],
            "redis_ops": [],
            "env_vars": [],
            "http_calls": [],
            "dependencies": [],
            "classes": [],
            "functions": []
        }

        # Top-level Analysis
        for node in tree.body:
            if isinstance(node, ast.ClassDef):
                methods = [n.name for n in node.body if isinstance(n, ast.FunctionDef)]
                analysis["classes"].append({"name": node.name, "methods": methods})
            if isinstance(node, ast.FunctionDef) or isinstance(node, ast.AsyncFunctionDef):
                analysis["functions"].append(node.name)

        # Deep Search for Other Details
        for node in ast.walk(tree):
            # Detect Env Vars: os.getenv('VAR') or os.environ['VAR']
            if isinstance(node, ast.Call):
                func_name = ""
                if isinstance(node.func, ast.Attribute) and isinstance(node.func.value, ast.Name):
                    if node.func.value.id == "os" and node.func.attr in ["getenv", "environ"]:
                         if node.args and isinstance(node.args[0], ast.Constant):
                            analysis["env_vars"].append(str(node.args[0].value))
                    
                    # Redis detect
                    if "redis" in node.func.value.id.lower():
                        analysis["redis_ops"].append(f"{node.func.attr}")

                    # HTTP detect (Requests, Httpx, or common REST patterns)
                    if node.func.value.id in ["requests", "httpx"] or node.func.attr in ["get", "post", "put", "delete"]:
                        if node.args and isinstance(node.args[0], ast.Constant):
                            analysis["http_calls"].append(f"{node.func.attr.upper()} {node.args[0].value}")

                elif isinstance(node.func, ast.Name) and node.func.id == "getenv":
                    if node.args and isinstance(node.args[0], ast.Constant):
                        analysis["env_vars"].append(str(node.args[0].value))

            # Detect Dependencies
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                for name in node.names:
                    analysis["dependencies"].append(name.name)

        # Merge with generic regex analysis
        generic = self._analyze_generic(file_path)
        for key in generic:
            if key in analysis:
                if isinstance(analysis[key], list):
                    analysis[key].extend(generic[key])
            else:
                analysis[key] = generic[key]
        
        # Deduplicate strings
        for key in analysis:
            if isinstance(analysis[key], list) and all(isinstance(i, str) for i in analysis[key]):
                analysis[key] = sorted(list(set(analysis[key])))

        return analysis

    def _analyze_javascript(self, file_path: Path) -> Dict[str, Any]:
        """Basic JS/TS analysis (regex-heavy)."""
        return self._analyze_generic(file_path)

    def _analyze_generic(self, file_path: Path) -> Dict[str, Any]:
        """Generic regex-based analysis for all languages."""
        try:
            content = file_path.read_text()
        except Exception:
            return {}
        
        patterns = {
            "sql_queries": r"(SELECT|INSERT|UPDATE|DELETE|CREATE|DROP)\s+.*?\s+(FROM|INTO|SET|TABLE)\s+([\w\._-]+)",
            "redis_ops": r"\.(get|set|publish|subscribe|hget|hset|lpush|rpop)\s*\(",
            "http_calls": r"(https?://\S+)",
            "env_vars": r"process\.env\.(\w+)|os\.getenv\([\"'](\w+)[\"']\)|[\"'](\w+[\-_\w]*)[\"']\s*[:=]",
            "log_patterns": r"log\.(info|error|warn|debug|critical)\("
        }

        results = {"tables": []}
        for key, pattern in patterns.items():
            try:
                matches = re.findall(pattern, content, re.IGNORECASE)
                flattened = []
                for m in matches:
                    if isinstance(m, tuple):
                        # For sql_queries, the 3rd group is the table name
                        if key == "sql_queries" and len(m) >= 3:
                            table_name = m[2].lower()
                            if table_name not in {"select", "where", "order", "group", "by", "limit", "set", "values"}:
                                results["tables"].append(table_name)
                        flattened.extend([str(x) for x in m if x])
                    else:
                        flattened.append(str(m))
                results[key] = sorted(list(set(flattened)))
            except Exception:
                results[key] = []

        # Deduplicate tables
        results["tables"] = sorted(list(set(results["tables"])))
        return results

if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        analyzer = AnalysisEngine()
        print(analyzer.analyze_file(Path(sys.argv[1])))
