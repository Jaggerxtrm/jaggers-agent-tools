#!/usr/bin/env python3
import sys
import os

# Add script directory to path to allow importing shared modules
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from agent_context import AgentContext

def check_venv():
    # Check VIRTUAL_ENV env var
    if os.environ.get('VIRTUAL_ENV'):
        return True
    
    # Check for common directories
    common_names = ['.venv', 'venv', 'env', 'virtualenv', '.env']
    for name in common_names:
        if os.path.isdir(name) and os.path.exists(os.path.join(name, 'bin', 'activate')):
            return name # Found inactive venv
    return False

try:
    ctx = AgentContext()
    
    # Only run for shell tools
    if not ctx.is_shell_tool():
        ctx.fail_open()
        
    command = ctx.get_command()
    
    # Check for pip install commands
    if 'pip install' in command or 'pip3 install' in command:
        venv_status = check_venv()
        
        if venv_status is True:
            # Case 1: Active venv -> Allow
            ctx.allow()
            
        elif venv_status:
            # Case 2: Inactive venv found -> Block and warn
            ctx.block(
                reason=f"Safety Guard: Attempting pip install without activating virtual environment (found at ./{venv_status}).",
                system_message=f"⚠️  Please activate your virtual environment first:\n\nsource {venv_status}/bin/activate"
            )
            
        else:
            # Case 3: No venv found -> Warn but allow (legacy behavior)
            ctx.allow(
                system_message="⚠️  WARNING: Running pip install without a detected virtual environment. Consider creating one: 'python -m venv .venv'"
            )

except Exception:
    # Fail open
    sys.exit(0)
