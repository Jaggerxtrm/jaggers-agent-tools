# Testing and TDD

Use TDD when tests can define a stable behavior contract before implementation, especially
for bugs, pure logic, parsers, invariants, and clearly specified features. Do not force a
coverage percentage or test-first ceremony where the interface is exploratory and the
first task is discovering the correct behavior.

Prefer tests that prove behavior at the layer changed. A test is valuable if it would
have failed for the defect or missing capability it claims to protect.

Use mocks for isolation, not to replace the only meaningful boundary evidence. Integrated
CLI/API/agent/deploy changes require smoke or contract evidence in addition to unit/static
checks.