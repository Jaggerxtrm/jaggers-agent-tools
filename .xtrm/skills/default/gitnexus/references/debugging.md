# Debugging with GitNexus

Start from the observed symptom, error, failing test, or wrong output.

1. Locate the execution flow/symbol nearest the symptom.
2. Walk callers/callees and relevant process steps to form a bounded hypothesis.
3. Confirm the hypothesis against source and runtime/test evidence.
4. Inspect blast radius before changing the suspected symbol.
5. After the fix, use changed-symbol/diff impact to check for missed callers or tests.

Do not edit the first suspicious function merely because it appears in the graph. The
root cause must explain the observed failure.