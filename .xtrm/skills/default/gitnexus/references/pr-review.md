# PR/diff review with GitNexus

Use the actual diff and contract as the review boundary.

1. Identify changed symbols/files.
2. Inspect graph change impact or blast radius for shared symbols.
3. Compare affected processes/callers with tests and validation in the PR.
4. Look for hidden consumers that the author did not mention.
5. Verify any high-impact graph claim against source before blocking a PR.

GitNexus complements correctness/security/review discipline; it does not replace those
review lenses.