#!/usr/bin/env python3
import sys
import os
import subprocess

# Add script directory to path to allow importing shared modules
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from agent_context import AgentContext

# Configuration
STRICT_DIRS = ["mcp_server"]
WARN_DIRS = ["scripts"]
PROJECT_ROOT = os.environ.get('GEMINI_PROJECT_DIR', os.environ.get('CLAUDE_PROJECT_DIR', os.getcwd()))
VENV_PATH = os.path.join(PROJECT_ROOT, ".venv")

# Colors
RED = '\033[0;31m'
YELLOW = '\033[1;33m'
GREEN = '\033[0;32m'
CYAN = '\033[0;36m'
NC = '\033[0m'

def is_strict_path(file_path):
    rel_path = os.path.relpath(file_path, PROJECT_ROOT)
    for d in STRICT_DIRS:
        if rel_path.startswith(d):
            return True
    return False

def run_mypy(target, is_strict):
    if not os.path.exists(os.path.join(VENV_PATH, "bin", "activate")):
        print(f"{YELLOW}⚠️  Venv not found at {VENV_PATH}, skipping check{NC}")
        return True

    cmd = f"source {VENV_PATH}/bin/activate && python -m mypy {target} --explicit-package-bases"
    
    try:
        result = subprocess.run(cmd, shell=True, executable="/bin/bash", capture_output=True, text=True)
        
        if result.returncode != 0:
            if is_strict:
                print(f"{RED}❌ MYPY FAILED (STRICT MODE){NC}", file=sys.stderr)
                print(result.stdout, file=sys.stderr)
                print(f"\n{RED}🚫 COMMIT BLOCKED: Fix type errors in {target}{NC}", file=sys.stderr)
                print(f"{CYAN}💡 Run: source .venv/bin/activate && python -m mypy {target}{NC}", file=sys.stderr)
                return False
            else:
                print(f"{YELLOW}⚠️  MYPY WARNING (LENIENT MODE){NC}", file=sys.stderr)
                print("\n".join(result.stdout.splitlines()[:20]), file=sys.stderr)
                print(f"\n{YELLOW}⚡ Type errors exist in {target} (commit allowed){NC}", file=sys.stderr)
                return True
        else:
            print(f"{GREEN}✅ MYPY PASSED: {target}{NC}", file=sys.stderr)
            return True

    except Exception as e:
        print(f"Error running mypy: {e}", file=sys.stderr)
        return True # Fail open

try:
    ctx = AgentContext()

    # 1. Check Git Commits (Shell tools)
    if ctx.is_shell_tool():
        command = ctx.get_command()
        if 'git commit' in command:
            print(f"{CYAN}🔍 TYPE SAFETY CHECK: Validating staged Python files...{NC}", file=sys.stderr)
            
            # Get staged files
            try:
                staged = subprocess.check_output(
                    "git diff --cached --name-only --diff-filter=ACM | grep '\.py$'", 
                    shell=True, cwd=PROJECT_ROOT
                ).decode().strip().splitlines()
            except subprocess.CalledProcessError:
                staged = []

            if not staged:
                print(f"{GREEN}✅ No Python files staged{NC}", file=sys.stderr)
                ctx.allow()

            failed = False
            
            # Check individual files
            for f in staged:
                full_path = os.path.join(PROJECT_ROOT, f)
                if is_strict_path(full_path):
                    if not run_mypy(full_path, True):
                        failed = True

            # If failed, block the tool
            if failed:
                ctx.block(reason="Type safety violations in strict directory.")
            
            ctx.allow()

    # 2. Check Edits (Write/Edit tools)
    elif ctx.is_write_tool() or ctx.is_edit_tool():
        file_path = ctx.get_file_path()
        if file_path.endswith('.py') and is_strict_path(file_path):
            ctx.allow(system_message=f"""{YELLOW}⚠️  EDITING STRICT TYPE-SAFE FILE{NC}
This file is in a STRICT zone ({', '.join(STRICT_DIRS)}).
Any type errors will BLOCK commits.
""")

except Exception:
    sys.exit(0)
