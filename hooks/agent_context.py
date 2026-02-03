#!/usr/bin/env python3
import json
import sys
import os

class AgentContext:
    def __init__(self):
        try:
            # Read JSON from stdin once
            self.data = json.load(sys.stdin)
        except Exception:
            self.data = {}
            
        self.tool_name = self.data.get('tool_name')
        self.tool_input = self.data.get('tool_input', {})
        self.event = self.data.get('hook_event_name')
        self.prompt = self.data.get('prompt', '')
        
        # Determine Agent Type
        if self.tool_name in ['run_shell_command', 'read_file', 'write_file', 'replace']:
            self.agent_type = 'gemini'
        elif self.tool_name in ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep']:
            self.agent_type = 'claude'
        else:
            # Fallback based on env vars
            if os.environ.get('GEMINI_PROJECT_DIR'):
                self.agent_type = 'gemini'
            else:
                self.agent_type = 'claude'

    def is_shell_tool(self):
        return self.tool_name in ['Bash', 'run_shell_command']

    def is_write_tool(self):
        return self.tool_name in ['Write', 'write_file']

    def is_edit_tool(self):
        return self.tool_name in ['Edit', 'replace']

    def get_command(self):
        return self.tool_input.get('command', '')

    def get_file_path(self):
        return self.tool_input.get('file_path', '')

    def block(self, reason, system_message=None):
        """Unified block response for both agents"""
        output = {
            "decision": "deny",
            "reason": reason,
            "hookSpecificOutput": {
                "hookEventName": self.event,
                "permissionDecision": "deny",
                "permissionDecisionReason": reason
            }
        }
        if system_message:
            output["systemMessage"] = system_message
        
        # Claude uses permissionDecisionReason for display
        # Gemini uses reason for tool error feedback
        
        print(json.dumps(output))
        sys.exit(0)

    def allow(self, system_message=None, additional_context=None):
        """Unified allow response"""
        output = {"decision": "allow"}
        if system_message:
            output["systemMessage"] = system_message
        
        if additional_context:
            output["hookSpecificOutput"] = {
                "hookEventName": self.event,
                "additionalContext": additional_context
            }
            
        print(json.dumps(output))
        sys.exit(0)

    def fail_open(self):
        """Standard fail-open behavior"""
        sys.exit(0)
