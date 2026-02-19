#!/usr/bin/env python3
import json
import sys
import os
import re

# Add script directory to path to allow importing shared modules
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from agent_context import AgentContext

def get_first_sentence(text):
    if not text:
        return ""
    # Remove newlines and extra spaces
    text = re.sub(r'\s+', ' ', text).strip()
    # Find the first period followed by a space or end of string
    match = re.search(r'^(.*?)[.!?](\s|$)', text)
    if match:
        return match.group(0).strip()
    return text

def parse_skill_md(file_path):
    try:
        with open(file_path, 'r') as f:
            content = f.read()
            
        # Extract YAML frontmatter
        match = re.search(r'^---\s*\n(.*?)\n---\s*\n', content, re.DOTALL)
        if match:
            frontmatter_raw = match.group(1)
            # Basic YAML-like parsing using regex to avoid external dependency (PyYAML)
            name_match = re.search(r'^name:\s*(.*)$', frontmatter_raw, re.MULTILINE)
            desc_match = re.search(r'^description:\s*(?:>-\s*)?\n?\s*(.*)$', frontmatter_raw, re.MULTILINE | re.DOTALL)
            
            name = name_match.group(1).strip() if name_match else os.path.basename(os.path.dirname(file_path))
            description = ""
            
            if desc_match:
                desc_raw = desc_match.group(1).strip()
                # If it was a folded scalar, it might have multiple lines
                if '\n' in desc_raw:
                    # Capture until next YAML key or end
                    description = desc_raw.split('\n')[0].strip()
                else:
                    description = desc_raw
            
            return name, get_first_sentence(description)
    except Exception as e:
        print(f"Error parsing {file_path}: {e}", file=sys.stderr)
    return None

def main():
    try:
        ctx = AgentContext()
        project_dir = os.environ.get('GEMINI_PROJECT_DIR', os.getcwd())
        skills_root = os.path.join(project_dir, 'skills')
        
        if not os.path.exists(skills_root):
            ctx.fail_open()

        available_skills = []
        for skill_dir in os.listdir(skills_root):
            skill_path = os.path.join(skills_root, skill_dir)
            if os.path.isdir(skill_path):
                skill_md = os.path.join(skill_path, 'SKILL.md')
                if os.path.exists(skill_md):
                    result = parse_skill_md(skill_md)
                    if result:
                        name, desc = result
                        available_skills.append(f"- {name}: {desc}")

        if not available_skills:
            ctx.fail_open()

        context_msg = "## Available Local Agent Skills\n"
        context_msg += "The following specialized skills are available in this repository. Use them when appropriate:\n"
        context_msg += "\n".join(sorted(available_skills))
        context_msg += "\n\nYou can activate a skill using `activate_skill(name='skill-name')`."

        ctx.allow(
            system_message="🚀 Loaded available local skills into context.",
            additional_context=context_msg
        )

    except Exception as e:
        print(f"Hook failed: {e}", file=sys.stderr)
        sys.exit(0)

if __name__ == "__main__":
    main()
