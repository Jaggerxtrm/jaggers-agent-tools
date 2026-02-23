#!/usr/bin/env python3
"""
Service-skill-builder hook installer.

Appends skill-staleness and doc-reminder hook calls to the project's
.githooks/pre-commit and .githooks/pre-push files, then activates them
by copying to .git/hooks/.

Idempotent: safe to run multiple times. Uses marker comments to detect
whether hooks are already installed.

Usage:
    python3 .claude/skills/service-skill-builder/scripts/install_hooks.py
    python3 .claude/skills/service-skill-builder/scripts/install_hooks.py --uninstall
    python3 .claude/skills/service-skill-builder/scripts/install_hooks.py --status
"""
import sys
import shutil
import argparse
from pathlib import Path

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
SCRIPT_DIR   = Path(__file__).parent
HOOKS_SCRIPT = SCRIPT_DIR / "hooks"

PRE_COMMIT_HOOK  = Path(".githooks/pre-commit")
PRE_PUSH_HOOK    = Path(".githooks/pre-push")
GIT_HOOKS_DIR    = Path(".git/hooks")

DOC_REMINDER_PATH    = ".claude/skills/service-skill-builder/scripts/hooks/doc_reminder.py"
SKILL_STALENESS_PATH = ".claude/skills/service-skill-builder/scripts/hooks/skill_staleness.py"

MARKER_DOC      = "# [skill-hooks] doc-reminder"
MARKER_STALENESS = "# [skill-hooks] skill-staleness"

# The snippet appended to pre-commit
DOC_REMINDER_SNIPPET = f"""\

{MARKER_DOC}
if command -v python3 &>/dev/null && [ -f "{DOC_REMINDER_PATH}" ]; then
    python3 "{DOC_REMINDER_PATH}" || true
fi
"""

# The snippet appended to pre-push (stdin is automatically forwarded by bash)
SKILL_STALENESS_SNIPPET = f"""\

{MARKER_STALENESS}
if command -v python3 &>/dev/null && [ -f "{SKILL_STALENESS_PATH}" ]; then
    python3 "{SKILL_STALENESS_PATH}" || true
fi
"""

# Colors
GREEN  = "\033[0;32m"
YELLOW = "\033[1;33m"
BLUE   = "\033[0;34m"
RED    = "\033[0;31m"
NC     = "\033[0m"


def check_git_repo() -> bool:
    return Path(".git").is_dir()


def is_installed(hook_path: Path, marker: str) -> bool:
    if not hook_path.exists():
        return False
    return marker in hook_path.read_text()


def install_snippet(hook_path: Path, marker: str, snippet: str, label: str) -> bool:
    """Append snippet to hook file if not already present. Returns True if changed."""
    if not hook_path.exists():
        print(f"  {RED}✗ {hook_path} not found — create it first.{NC}")
        return False

    if marker in hook_path.read_text():
        print(f"  {BLUE}○ {label} already installed in {hook_path}{NC}")
        return False

    with open(hook_path, "a") as f:
        f.write(snippet)
    print(f"  {GREEN}✓ {label} added to {hook_path}{NC}")
    return True


def remove_snippet(hook_path: Path, marker: str, snippet: str, label: str) -> bool:
    """Remove snippet from hook file. Returns True if changed."""
    if not hook_path.exists():
        return False
    content = hook_path.read_text()
    if marker not in content:
        print(f"  {BLUE}○ {label} not present in {hook_path}{NC}")
        return False
    hook_path.write_text(content.replace(snippet, ""))
    print(f"  {GREEN}✓ {label} removed from {hook_path}{NC}")
    return True


def activate_hooks() -> None:
    """Copy .githooks/ to .git/hooks/ to activate."""
    GIT_HOOKS_DIR.mkdir(parents=True, exist_ok=True)
    for hook_file in [PRE_COMMIT_HOOK, PRE_PUSH_HOOK]:
        if hook_file.exists():
            dest = GIT_HOOKS_DIR / hook_file.name
            shutil.copy2(hook_file, dest)
            dest.chmod(0o755)
            print(f"  {GREEN}✓ Activated {dest}{NC}")


def print_status() -> None:
    doc_pre_commit = is_installed(PRE_COMMIT_HOOK, MARKER_DOC)
    staleness_pre_push = is_installed(PRE_PUSH_HOOK, MARKER_STALENESS)

    print()
    print(f"Skill hook status:")
    print(f"  pre-commit doc-reminder:     {'INSTALLED' if doc_pre_commit else 'NOT INSTALLED'}")
    print(f"  pre-push skill-staleness:    {'INSTALLED' if staleness_pre_push else 'NOT INSTALLED'}")
    print()

    git_pre_commit = GIT_HOOKS_DIR / "pre-commit"
    git_pre_push = GIT_HOOKS_DIR / "pre-push"
    print(f"Active git hooks (.git/hooks/):")
    print(f"  pre-commit:  {'present' if git_pre_commit.exists() else 'MISSING'}")
    print(f"  pre-push:    {'present' if git_pre_push.exists() else 'MISSING'}")
    print()


def main() -> None:
    parser = argparse.ArgumentParser(description="Install skill-builder git hooks")
    parser.add_argument("--uninstall", action="store_true", help="Remove hook snippets")
    parser.add_argument("--status",    action="store_true", help="Show installation status")
    args = parser.parse_args()

    if not check_git_repo():
        print(f"{RED}Error: not a git repository (no .git/ found).{NC}")
        sys.exit(1)

    if args.status:
        print_status()
        sys.exit(0)

    if args.uninstall:
        print(f"\n{YELLOW}Removing skill-builder hooks...{NC}\n")
        remove_snippet(PRE_COMMIT_HOOK, MARKER_DOC, DOC_REMINDER_SNIPPET, "doc-reminder")
        remove_snippet(PRE_PUSH_HOOK, MARKER_STALENESS, SKILL_STALENESS_SNIPPET, "skill-staleness")
        print(f"\n{YELLOW}Re-activating hooks...{NC}")
        activate_hooks()
        print(f"\n{GREEN}Uninstall complete.{NC}\n")
        sys.exit(0)

    # Install
    print(f"\n{BLUE}Installing skill-builder hooks...{NC}\n")

    changed = False
    changed |= install_snippet(
        PRE_COMMIT_HOOK, MARKER_DOC, DOC_REMINDER_SNIPPET, "doc-reminder"
    )
    changed |= install_snippet(
        PRE_PUSH_HOOK, MARKER_STALENESS, SKILL_STALENESS_SNIPPET, "skill-staleness"
    )

    if changed:
        print(f"\n{YELLOW}Activating hooks to .git/hooks/...{NC}")
        activate_hooks()

    print(f"\n{GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━{NC}")
    print(f"{GREEN}✓ Skill-builder hooks installed.{NC}")
    print(f"{GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━{NC}\n")
    print(f"  • {YELLOW}pre-commit{NC}: reminds to run /documenting when source files change")
    print(f"  • {YELLOW}pre-push{NC}:   warns when service skills may be stale")
    print()
    print(f"  Override strict mode: {YELLOW}SKILL_HOOK_STRICT=1 git push{NC}")
    print(f"  Bypass hooks:         {YELLOW}git commit --no-verify{NC} / {YELLOW}git push --no-verify{NC}")
    print(f"  Check status:         {YELLOW}python3 {__file__} --status{NC}")
    print()


if __name__ == "__main__":
    main()
