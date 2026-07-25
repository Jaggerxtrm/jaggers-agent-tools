#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

try {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  const cwd = input?.cwd ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const memory = readFileSync(resolve(cwd, '.xtrm', 'memory.md'), 'utf8').trim();
  if (memory) {
    process.stdout.write(`${JSON.stringify({
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalSystemPrompt: memory },
    })}\n`);
  }
} catch {
  // Session start must fail open when project memory is absent or unreadable.
}
