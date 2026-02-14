#!/usr/bin/env python3
"""Test AgentContext hook output formatting"""
import json
import sys
from io import StringIO

# Mock sys.stdin and sys.exit for testing
class MockExit(Exception):
    pass

def test_hook_output(event_name, method_name, *args, **kwargs):
    """Test a specific hook method and return its JSON output"""
    import agent_context

    # Prepare mock input
    mock_input = {
        "hook_event_name": event_name,
        "tool_name": "Read",
        "tool_input": {"file_path": "/test/file.txt"}
    }

    # Mock stdin
    original_stdin = sys.stdin
    original_exit = sys.exit
    sys.stdin = StringIO(json.dumps(mock_input))

    # Capture stdout
    output_buffer = StringIO()
    original_stdout = sys.stdout
    sys.stdout = output_buffer

    try:
        ctx = agent_context.AgentContext()

        # Call the method
        method = getattr(ctx, method_name)
        try:
            method(*args, **kwargs)
        except SystemExit:
            pass  # Expected

        # Get output
        output = output_buffer.getvalue().strip()
        return json.loads(output) if output else {}

    finally:
        sys.stdin = original_stdin
        sys.stdout = original_stdout
        sys.exit = original_exit

def main():
    print("Testing AgentContext hook output formats...\n")

    # Test 1: PreToolUse allow() with systemMessage
    print("Test 1: PreToolUse allow() with systemMessage")
    output = test_hook_output("PreToolUse", "allow", system_message="Test message")
    print(f"Output: {json.dumps(output, indent=2)}")
    assert "systemMessage" in output, "Should have systemMessage"
    assert output["hookSpecificOutput"]["hookEventName"] == "PreToolUse"
    assert output["hookSpecificOutput"]["permissionDecision"] == "allow"
    assert "decision" not in output, "Should NOT have top-level 'decision'"
    print("✓ PASS\n")

    # Test 2: PreToolUse allow() with additionalContext
    print("Test 2: PreToolUse allow() with additionalContext")
    output = test_hook_output("PreToolUse", "allow", additional_context="Extra context")
    print(f"Output: {json.dumps(output, indent=2)}")
    assert output["hookSpecificOutput"]["permissionDecision"] == "allow"
    assert output["hookSpecificOutput"]["additionalContext"] == "Extra context"
    print("✓ PASS\n")

    # Test 3: UserPromptSubmit allow() with systemMessage (no permissionDecision)
    print("Test 3: UserPromptSubmit allow() with systemMessage")
    output = test_hook_output("UserPromptSubmit", "allow", system_message="Reminder")
    print(f"Output: {json.dumps(output, indent=2)}")
    assert "systemMessage" in output
    assert "permissionDecision" not in output.get("hookSpecificOutput", {}), \
        "UserPromptSubmit should NOT have permissionDecision"
    print("✓ PASS\n")

    # Test 4: UserPromptSubmit allow() with additionalContext
    print("Test 4: UserPromptSubmit allow() with additionalContext")
    output = test_hook_output("UserPromptSubmit", "allow", additional_context="Context")
    print(f"Output: {json.dumps(output, indent=2)}")
    assert output["hookSpecificOutput"]["additionalContext"] == "Context"
    assert "permissionDecision" not in output["hookSpecificOutput"]
    print("✓ PASS\n")

    # Test 5: PreToolUse block()
    print("Test 5: PreToolUse block()")
    output = test_hook_output("PreToolUse", "block", "Dangerous operation")
    print(f"Output: {json.dumps(output, indent=2)}")
    assert output["hookSpecificOutput"]["permissionDecision"] == "deny"
    assert output["hookSpecificOutput"]["permissionDecisionReason"] == "Dangerous operation"
    assert "decision" not in output, "Should NOT have top-level 'decision'"
    print("✓ PASS\n")

    # Test 6: UserPromptSubmit block() (should use continue: false)
    print("Test 6: UserPromptSubmit block()")
    output = test_hook_output("UserPromptSubmit", "block", "Blocked")
    print(f"Output: {json.dumps(output, indent=2)}")
    assert output.get("continue") == False, "Should have continue: false"
    assert output.get("stopReason") == "Blocked"
    assert "permissionDecision" not in output.get("hookSpecificOutput", {})
    print("✓ PASS\n")

    print("=" * 50)
    print("All tests passed! ✓")
    print("=" * 50)

if __name__ == "__main__":
    main()
