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
        """Unified block response.

        Only PreToolUse hooks support permissionDecision: deny.
        For other hooks, use continue: false to block execution.
        """
        output = {}

        if system_message:
            output["systemMessage"] = system_message

        # Only PreToolUse hooks support permissionDecision
        if self.event == "PreToolUse":
            output["hookSpecificOutput"] = {
                "hookEventName": self.event,
                "permissionDecision": "deny",
                "permissionDecisionReason": reason
            }
        else:
            # For non-PreToolUse hooks, use continue: false to block
            output["continue"] = False
            output["stopReason"] = reason

        print(json.dumps(output))
        sys.exit(0)

    def allow(self, system_message=None, additional_context=None):
        """Unified allow response.

        For PreToolUse hooks: outputs permissionDecision in hookSpecificOutput
        For other hooks (UserPromptSubmit, SessionStart, PostToolUse):
          only systemMessage and/or additionalContext are valid
        """
        output = {}

        if system_message:
            output["systemMessage"] = system_message

        # Build hookSpecificOutput if we have PreToolUse or additionalContext
        if self.event == "PreToolUse" or additional_context:
            hook_output = {"hookEventName": self.event}

            # Only PreToolUse supports permissionDecision
            if self.event == "PreToolUse":
                hook_output["permissionDecision"] = "allow"

            if additional_context:
                hook_output["additionalContext"] = additional_context

            output["hookSpecificOutput"] = hook_output

        # Only print output if we have something to say
        if output:
            print(json.dumps(output))

        sys.exit(0)

    def fail_open(self):
        """Standard fail-open behavior"""
        sys.exit(0)
