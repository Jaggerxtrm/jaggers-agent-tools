#!/usr/bin/env node
// beads-gate-messages.mjs — centralized message templates for beads gate hooks
// Import from sibling hooks using: import { ... } from './beads-gate-messages.mjs';
//
// All user-facing strings live here. Edit this file to change messaging.
// Policy logic lives in beads-gate-core.mjs.

// ── Shared workflow steps ────────────────────────────────────────────

export const SESSION_CLOSE_PROTOCOL =
  '  xt work done <id> --reason="<validated result>"\n' +
  '  xt end\n';

export const COMMIT_NEXT_STEPS =
  '  xt work done <id> --reason="<validated result>"   ← closes durable work through current gates\n' +
  '  xt end                                             ← push, PR, merge, worktree cleanup\n';

// ── Edit gate messages ───────────────────────────────────────────

export function editBlockMessage(_sessionId) {
  return (
    '🚫 No active work identity — check in before editing.\n' +
    '  existing tracked work: xt work start --bead <id>\n' +
    '  bounded local work:   xt work start "<short title>" --validation "<proof>"\n' +
    '  substantial work:     /planning first\n' +
    '  lifecycle help:       xt work guide\n'
  );
}

export function editBlockFallbackMessage() {
  return (
    '🚫 No active work identity — create or claim tracked work before editing.\n' +
    '  existing tracked work: xt work start --bead <id>\n' +
    '  bounded local work:   xt work start "<short title>" --validation "<proof>"\n' +
    '  substantial work:     /planning first\n' +
    '  lifecycle help:       xt work guide\n'
  );
}

// ── Commit gate messages ─────────────────────────────────────────

export function commitBlockMessage(summary, claimed) {
  const issueSummary = summary ?? `  Claimed: ${claimed}`;
  return (
    '🚫 Close open work before committing.\n\n' +
    `${issueSummary}\n\n` +
    'Next steps:\n' + COMMIT_NEXT_STEPS
  );
}

// ── Stop gate messages ───────────────────────────────────────────

export function stopBlockMessage(summary, claimed) {
  const issueSummary = summary ?? `  Claimed: ${claimed}`;
  return (
    '🚫 Unresolved work — close or deliberately continue it before stopping.\n\n' +
    `${issueSummary}\n\n` +
    'If complete:\n' + SESSION_CLOSE_PROTOCOL
  );
}

// ── Memory gate messages ─────────────────────────────────────────

export function memoryPromptMessage(claimId, sessionId) {
  const claim = claimId ? `${claimId} ` : '';
  const ack = `bd kv set "memory-gate-done:${sessionId}"`;
  return `● Memory gate: ${claim}closed. ack: \`${ack} "saved:<key>"\` | \`${ack} "nothing novel - <reason>"\`\n`;
}
