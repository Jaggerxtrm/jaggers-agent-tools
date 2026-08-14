#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

try {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  const cwd = input?.cwd ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const doctrine = readFileSync(resolve(cwd, '.xtrm', 'config', 'instructions', 'memory-doctrine.md'), 'utf8').trim();
  if (doctrine) {
    process.stdout.write(`${JSON.stringify({
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalSystemPrompt: doctrine },
    })}\n`);
  }
} catch {
  // Session start must fail open when the doctrine is absent or unreadable.
}
