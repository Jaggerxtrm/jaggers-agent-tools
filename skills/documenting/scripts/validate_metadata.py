#!/usr/bin/env python3
"""
Validate SSOT memory metadata compliance.

Checks if a memory file has all required frontmatter fields and follows
the naming conventions defined in the SSOT guidelines.
"""

import sys
import re
from pathlib import Path
import yaml


REQUIRED_FIELDS = {
    "ssot": ["title", "version", "updated", "scope", "category", "subcategory", "domain"],
    "pattern": ["title", "version", "updated", "scope", "category", "domain"],
    "plan": ["title", "version", "updated", "scope", "category"],
    "reference": ["title", "scope", "category"],
    "archive": ["title", "version", "updated", "scope", "category", "archived_date"],
}

CATEGORY_SUFFIXES = ["ssot", "pattern", "plan", "reference", "archive", "troubleshoot", "commit_log"]


def extract_frontmatter(content):
    """Extract YAML frontmatter from markdown content."""
    match = re.match(r'^---\n(.*?)\n---\n', content, re.DOTALL)
    if not match:
        return None
    try:
        return yaml.safe_load(match.group(1))
    except yaml.YAMLError as e:
        print(f"ERROR: Invalid YAML frontmatter: {e}")
        return None


def validate_naming(filename):
    """Validate filename follows naming conventions."""
    errors = []

    # Check if ends with .md
    if not filename.endswith('.md'):
        errors.append("Filename should end with .md")
        return errors

    stem = filename[:-3]  # Remove .md
    
    # Check if ends with known category suffix
    has_suffix = any(stem.endswith(f"_{suffix}") for suffix in CATEGORY_SUFFIXES)
    if not has_suffix:
        errors.append(f"Filename should end with one of: {', '.join(['_' + s + '.md' for s in CATEGORY_SUFFIXES])}")

    return errors


def validate_version(version):
    """Validate semantic version format (x.y.z)."""
    if not version:
        return False
    pattern = r'^\d+\.\d+\.\d+$'
    return bool(re.match(pattern, str(version)))


def validate_metadata(filepath):
    """Validate memory metadata."""
    path = Path(filepath)

    if not path.exists():
        print(f"ERROR: File not found: {filepath}")
        return False

    print(f"Validating: {path.name}")
    print("=" * 60)

    errors = []
    warnings = []

    # Check naming convention
    naming_errors = validate_naming(path.name)
    errors.extend(naming_errors)

    # Read content
    content = path.read_text(encoding='utf-8')

    # Extract frontmatter
    metadata = extract_frontmatter(content)
    if metadata is None:
        errors.append("Missing or invalid YAML frontmatter (should be between --- markers)")
        print_results(errors, warnings)
        return False

    # Determine category from filename suffix
    category = None
    stem = path.name[:-3]
    for suffix in CATEGORY_SUFFIXES:
        if stem.endswith(f"_{suffix}"):
            category = suffix
            break

    # Check required fields based on category
    # If category is troubleshoot or commit_log, they might not have strict requirements yet
    if category in REQUIRED_FIELDS:
        required = REQUIRED_FIELDS[category]
        missing_fields = [field for field in required if field not in metadata]
        if missing_fields:
            errors.append(f"Missing required fields: {', '.join(missing_fields)}")
    else:
        # Default to ssot requirements if unknown but has suffix
        required = REQUIRED_FIELDS["ssot"]
        missing_fields = [field for field in required if field not in metadata]
        if missing_fields:
            errors.append(f"Missing required fields: {', '.join(missing_fields)}")

    # Validate version format (if present)
    if "version" in metadata:
        if not validate_version(metadata["version"]):
            errors.append(f"Invalid version format: {metadata['version']} (should be x.y.z)")

    # Validate updated timestamp (if present)
    if "updated" in metadata:
        updated = str(metadata["updated"])
        # Check for ISO8601-ish format (basic validation)
        if not re.match(r'^\d{4}-\d{2}-\d{2}', updated):
            warnings.append(f"Updated timestamp should be ISO8601 format: {updated}")

    # Check for domain field (should be array)
    if "domain" in metadata:
        if not isinstance(metadata["domain"], list):
            errors.append("Domain field should be an array/list")

    # Check for changelog in SSOT files
    if category == "ssot" and "changelog" not in metadata:
        warnings.append("SSOT files should include a changelog section in frontmatter")

    print_results(errors, warnings)
    return len(errors) == 0


def print_results(errors, warnings):
    """Print validation results."""
    if errors:
        print("\n❌ ERRORS:")
        for error in errors:
            print(f"  - {error}")

    if warnings:
        print("\n⚠️  WARNINGS:")
        for warning in warnings:
            print(f"  - {warning}")

    if not errors and not warnings:
        print("\n✅ VALID: All checks passed!")

    print("=" * 60)


def main():
    if len(sys.argv) < 2:
        print("Usage: validate_metadata.py <memory-file.md>")
        print("Example: validate_metadata.py analytics_volatility_ssot.md")
        sys.exit(1)

    filepath = sys.argv[1]
    success = validate_metadata(filepath)
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
