#!/bin/bash
# Guard against running pip install outside a virtual environment
# This hook intercepts pip install commands and ensures they run within a venv

# Check if this is a pip install command
if [[ "$1" == *"pip install"* ]] || [[ "$1" == *"pip3 install"* ]]; then
  # Check if we're in a Python virtual environment
  if [[ -z "$VIRTUAL_ENV" ]]; then
    # Not in a venv - check for common venv directory names
    venv_found=false
    venv_name=""

    for potential_venv in .venv venv env virtualenv .env; do
      if [[ -d "$potential_venv" && -f "$potential_venv/bin/activate" ]]; then
        venv_found=true
        venv_name="$potential_venv"
        break
      fi
    done

    if [[ "$venv_found" == true ]]; then
      echo "⚠️  WARNING: Attempting pip install outside virtual environment"
      echo ""
      echo "Found virtual environment at: $venv_name"
      echo "Activate it first:"
      echo "  source $venv_name/bin/activate"
      echo ""
      echo "Then run your pip install command again."
      exit 1
    else
      echo "⚠️  WARNING: No virtual environment detected"
      echo ""
      echo "For this project, consider creating a virtual environment:"
      echo "  python -m venv .venv"
      echo "  source .venv/bin/activate"
      echo ""
      echo "For new projects, a venv is always preferred over global installation."
      echo "Continuing with pip install (be aware this modifies your global Python)..."
    fi
  fi
fi

# Allow the command to proceed (exit 0 is implicit)
