# Impact and refactoring

Before rename/extract/move/behavior changes to shared symbols:

- inspect upstream dependants and affected processes/modules;
- inspect downstream dependencies when the implementation contract may change;
- use a dry-run coordinated rename when the active GitNexus tool supports it;
- verify dynamic/config/string-based uses with repository search when the graph cannot
  model them;
- raise scrutiny for broad/high-risk impact instead of hiding it behind a mechanical
  refactor label.

After edits, inspect diff/change impact and run the validation required by the affected
callers. A LOW graph risk is useful evidence, not permission to skip tests.