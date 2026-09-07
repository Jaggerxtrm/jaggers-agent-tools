# Documentation maintenance

Treat docs as routing/contract surfaces, not duplicated implementation manuals. Determine
which document owns a fact, compare it with current source/runtime behavior, update the
smallest authoritative set, and remove superseded instructions rather than layering
corrections forever.

For CLAUDE.md/AGENTS.md-style agent docs, keep durable project invariants and pointers;
move task-specific procedures into skills/references and exact mutable command syntax into
live help.