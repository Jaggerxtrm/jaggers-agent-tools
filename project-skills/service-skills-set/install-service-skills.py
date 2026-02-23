#!/usr/bin/env python3
"""
Install the Service Skill Trinity into the current project.

Run from inside your target project directory:
    python3 /path/to/jaggers-agent-tools/project-skills/install-service-skills.py

Installs:
  .claude/skills/creating-service-skills/   — scaffold new service skills
  .claude/skills/using-service-skills/      — session-start catalog injection
  .claude/skills/updating-service-skills/   — drift detection on file writes
  .claude/settings.json                     — SessionStart + PostToolUse hooks
  .githooks/pre-commit                      — doc-reminder (non-blocking)
  .githooks/pre-push                        — skill-staleness (non-blocking)
  .git/hooks/pre-commit + pre-push          — activated

Idempotent. Safe to re-run.
"""

import json
import shutil
import subprocess
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent.resolve()            # project-skills/service-skills-set/
REPO_ROOT  = SCRIPT_DIR.parent.parent.resolve()         # jaggers-agent-tools/
SKILLS_SRC = SCRIPT_DIR / ".claude"                     # service-skills-set/.claude/<skill>/
GIT_HOOKS  = SKILLS_SRC / "git-hooks"                   # service-skills-set/.claude/git-hooks/

GREEN  = "\033[0;32m"
YELLOW = "\033[1;33m"
NC     = "\033[0m"

TRINITY = ["creating-service-skills", "using-service-skills", "updating-service-skills"]

SETTINGS_HOOKS = {
    "SessionStart": [
        {"hooks": [{"type": "command",
            "command": "python3 \"$CLAUDE_PROJECT_DIR/.claude/skills/using-service-skills/scripts/cataloger.py\""}]}
    ],
    "PreToolUse": [
        {"matcher": "Read|Write|Edit|Glob|Grep|Bash",
         "hooks": [{"type": "command",
             "command": "python3 \"$CLAUDE_PROJECT_DIR/.claude/skills/using-service-skills/scripts/skill_activator.py\""}]}
    ],
    "PostToolUse": [
        {"matcher": "Write|Edit",
         "hooks": [{"type": "command",
             "command": "python3 \"$CLAUDE_PROJECT_DIR/.claude/skills/updating-service-skills/scripts/drift_detector.py\" check-hook",
             "timeout": 10}]}
    ]
}

MARKER_DOC       = "# [jaggers] doc-reminder"
MARKER_STALENESS = "# [jaggers] skill-staleness"


def get_project_root() -> Path:
    try:
        r = subprocess.run(["git", "rev-parse", "--show-toplevel"],
                           capture_output=True, text=True, check=True, timeout=5)
        root = Path(r.stdout.strip())
        if root == REPO_ROOT:
            print("Error: run this from inside your TARGET project, not jaggers-agent-tools itself.")
            sys.exit(1)
        return root
    except subprocess.CalledProcessError:
        print("Error: not inside a git repository.")
        sys.exit(1)


def install_skills(project_root: Path) -> None:
    print("\n── Skills ──────────────────────────────")
    for skill in TRINITY:
        src  = SKILLS_SRC / skill
        dest = project_root / ".claude" / "skills" / skill
        if dest.exists():
            shutil.rmtree(dest)
        shutil.copytree(src, dest, ignore=shutil.ignore_patterns("*.Zone.Identifier"))
        print(f"{GREEN}  ✓{NC} .claude/skills/{skill}/")


def install_settings(project_root: Path) -> None:
    print("\n── settings.json ───────────────────────")
    path = project_root / ".claude" / "settings.json"
    path.parent.mkdir(parents=True, exist_ok=True)

    existing = {}
    if path.exists():
        try:
            existing = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass

    hooks = existing.setdefault("hooks", {})
    for event, config in SETTINGS_HOOKS.items():
        if event not in hooks:
            hooks[event] = config
            print(f"{GREEN}  ✓{NC} added hook: {event}")
        else:
            print(f"{YELLOW}  ○{NC} hook already present: {event} (not overwritten)")

    path.write_text(json.dumps(existing, indent=2) + "\n", encoding="utf-8")


def install_git_hooks(project_root: Path) -> None:
    print("\n── Git hooks ───────────────────────────")
    doc_script      = GIT_HOOKS / "doc_reminder.py"
    staleness_script = GIT_HOOKS / "skill_staleness.py"

    pre_commit = project_root / ".githooks" / "pre-commit"
    pre_push   = project_root / ".githooks" / "pre-push"

    for hp in (pre_commit, pre_push):
        if not hp.exists():
            hp.parent.mkdir(parents=True, exist_ok=True)
            hp.write_text("#!/usr/bin/env bash\n", encoding="utf-8")
            hp.chmod(0o755)

    snippets = [
        (pre_commit, MARKER_DOC,
         f"\n{MARKER_DOC}\nif command -v python3 &>/dev/null && [ -f \"{doc_script}\" ]; then\n    python3 \"{doc_script}\" || true\nfi\n"),
        (pre_push, MARKER_STALENESS,
         f"\n{MARKER_STALENESS}\nif command -v python3 &>/dev/null && [ -f \"{staleness_script}\" ]; then\n    python3 \"{staleness_script}\" || true\nfi\n"),
    ]

    changed = False
    for hook_path, marker, snippet in snippets:
        content = hook_path.read_text(encoding="utf-8")
        if marker not in content:
            hook_path.write_text(content + snippet, encoding="utf-8")
            print(f"{GREEN}  ✓{NC} {hook_path.relative_to(project_root)}")
            changed = True
        else:
            print(f"{YELLOW}  ○{NC} already installed: {hook_path.name}")

    if changed:
        git_dir = project_root / ".git" / "hooks"
        git_dir.mkdir(parents=True, exist_ok=True)
        for src, name in ((pre_commit, "pre-commit"), (pre_push, "pre-push")):
            if src.exists():
                dest = git_dir / name
                shutil.copy2(src, dest)
                dest.chmod(0o755)
        print(f"{GREEN}  ✓{NC} activated in .git/hooks/")


def main() -> None:
    project_root = get_project_root()
    print(f"Installing into: {project_root}")

    install_skills(project_root)
    install_settings(project_root)
    install_git_hooks(project_root)

    print(f"\n{GREEN}Done.{NC}")
    print(f"  Hooks active: SessionStart (catalog) · PreToolUse (skill activator) · PostToolUse (drift) · pre-commit · pre-push")


if __name__ == "__main__":
    main()
