---
name: python-testing
description: Python testing strategies using pytest, TDD methodology, fixtures, mocking, parametrization, and coverage requirements.
---

# Python Testing Patterns

Comprehensive testing strategies for Python applications using pytest, TDD methodology, and best practices.

## When to Activate

- Writing new Python code (follow TDD: red, green, refactor)
- Designing test suites for Python projects
- Reviewing Python test coverage
- Setting up testing infrastructure

## Core Testing Philosophy

### Test-Driven Development (TDD)

Always follow the TDD cycle:

1. **RED**: Write a failing test for the desired behavior
2. **GREEN**: Write minimal code to make the test pass
3. **REFACTOR**: Improve code while keeping tests green

```python
# Step 1: Write failing test (RED)
def test_add_numbers():
    result = add(2, 3)
    assert result == 5

# Step 2: Write minimal implementation (GREEN)
def add(a, b):
    return a + b

# Step 3: Refactor if needed (REFACTOR)
```

### Coverage Requirements

- **Target**: 80%+ code coverage
- **Critical paths**: 100% coverage required
- Use `pytest --cov` to measure coverage

```bash
pytest --cov=mypackage --cov-report=term-missing --cov-report=html
```


## pytest Fundamentals

### Basic Test Structure

```python
import pytest

def test_addition():
    """Test basic addition."""
    assert 2 + 2 == 4

def test_string_uppercase():
    """Test string uppercasing."""
    text = "hello"
    assert text.upper() == "HELLO"

def test_list_append():
    """Test list append."""
    items = [1, 2, 3]
    items.append(4)
    assert 4 in items
    assert len(items) == 4
```

### Assertions

```python
# Equality
assert result == expected

# Inequality
assert result != unexpected

# Truthiness
assert result  # Truthy
assert not result  # Falsy
assert result is True  # Exactly True
assert result is False  # Exactly False
assert result is None  # Exactly None

# Membership
assert item in collection
assert item not in collection

# Comparisons
assert result > 0
assert 0 <= result <= 100

# Type checking
assert isinstance(result, str)

# Exception testing (preferred approach)
with pytest.raises(ValueError):
    raise ValueError("error message")

# Check exception message
with pytest.raises(ValueError, match="invalid input"):
    raise ValueError("invalid input provided")

# Check exception attributes
with pytest.raises(ValueError) as exc_info:
    raise ValueError("error message")
assert str(exc_info.value) == "error message"
```


## Best Practices

### DO

- **Follow TDD**: Write tests before code (red-green-refactor)
- **Test one thing**: Each test should verify a single behavior
- **Use descriptive names**: `test_user_login_with_invalid_credentials_fails`
- **Use fixtures**: Eliminate duplication with fixtures
- **Mock external dependencies**: Don't depend on external services
- **Test edge cases**: Empty inputs, None values, boundary conditions
- **Aim for 80%+ coverage**: Focus on critical paths
- **Keep tests fast**: Use marks to separate slow tests

### DON'T

- **Don't test implementation**: Test behavior, not internals
- **Don't use complex conditionals in tests**: Keep tests simple
- **Don't ignore test failures**: All tests must pass
- **Don't test third-party code**: Trust libraries to work
- **Don't share state between tests**: Tests should be independent
- **Don't catch exceptions in tests**: Use `pytest.raises`
- **Don't use print statements**: Use assertions and pytest output
- **Don't write tests that are too brittle**: Avoid over-specific mocks


## Deep-Dive References

Load on demand — do not read these before writing your first failing test:

- [references/fixtures.md](references/fixtures.md) — fixture usage, setup/teardown, scopes, parameters, autouse, conftest
- [references/parametrization.md](references/parametrization.md) — parametrize, IDs, parameterized fixtures
- [references/markers.md](references/markers.md) — custom markers, test selection, pytest.ini marker config
- [references/mocking.md](references/mocking.md) — mocks, return values, exceptions, context managers, autospec, properties
- [references/async.md](references/async.md) — pytest-asyncio, async fixtures, mocking async calls
- [references/exceptions-and-side-effects.md](references/exceptions-and-side-effects.md) — exception assertions, file ops, tmp_path
- [references/organization.md](references/organization.md) — directory layout, test classes
- [references/patterns.md](references/patterns.md) — API endpoint, database, and class-method testing patterns
- [references/configuration.md](references/configuration.md) — pytest.ini, pyproject.toml, CLI usage
