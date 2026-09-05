#!/usr/bin/env node
// beads-claim-sync — PostToolUse hook
// Synchronizes durable Beads lifecycle into the current Claude runtime session.
// Supports both raw bd commands and the stable xt work facade.

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join, dirname, isAbsolute } from 'node:path';
import { resolveSessionId } from './beads-gate-utils.mjs';

const WORK_RECEIPT_PREFIX = 'XTRM_WORK_RECEIPT ';

function readInput() {
  try {
    return JSON.parse(readFileSync(0, 'utf-8'));
  } catch {
    return null;
  }
}

function isBeadsProject(cwd) {
  return existsSync(join(cwd, '.beads'));
}

function resolveMainRoot(cwd) {
  const r = spawnSync('git', ['rev-parse', '--git-common-dir'], {
    cwd, encoding: 'utf8', stdio: 'pipe',
  });
  const commonDir = r.stdout?.trim();
  if (commonDir && isAbsolute(commonDir)) return dirname(commonDir);
  return cwd;
}

function resolveClaimFileName(cwd) {
  const m = cwd.match(/\/\.xtrm\/worktrees\/([^/]+)/);
  return m ? `statusline-claim-${m[1]}` : 'statusline-claim';
}

function isShellTool(toolName) {
  return toolName === 'Bash' || toolName === 'bash' || toolName === 'execute_shell_command';
}

function commandSucceeded(payload) {
  const tr = payload?.tool_response ?? payload?.tool_result ?? payload?.result;
  if (!tr || typeof tr !== 'object') return true;
  if (tr.success === false) return false;
  if (tr.error) return false;
  const numeric = [tr.exit_code, tr.exitCode, tr.status, tr.returncode].find((v) => Number.isInteger(v));
  return !(typeof numeric === 'number' && numeric !== 0);
}

function toolResponseText(payload) {
  const tr = payload?.tool_response ?? payload?.tool_result ?? payload?.result ?? '';
  if (typeof tr === 'string') return tr;
  if (!tr || typeof tr !== 'object') return String(tr ?? '');

  const parts = [];
  for (const key of ['stdout', 'output', 'content', 'text']) {
    const value = tr[key];
    if (typeof value === 'string') parts.push(value);
    else if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === 'string') parts.push(entry);
        else if (entry && typeof entry === 'object' && typeof entry.text === 'string') parts.push(entry.text);
      }
    }
  }
  if (parts.length > 0) return parts.join('\n');
  try { return JSON.stringify(tr); } catch { return ''; }
}

function parseWorkReceipt(payload) {
  const text = toolResponseText(payload);
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith(WORK_RECEIPT_PREFIX)) continue;
    try {
      const receipt = JSON.parse(line.slice(WORK_RECEIPT_PREFIX.length));
      if (
        receipt?.schema === 'xt.work.receipt.v1' &&
        ['start', 'resume', 'note', 'done'].includes(receipt.action) &&
        typeof receipt.bead === 'string' &&
        receipt.bead.length > 0
      ) return receipt;
    } catch { /* malformed receipt: ignore */ }
  }
  return null;
}

function syncClaim(sessionId, cwd, issueId) {
  const result = spawnSync('bd', ['kv', 'set', `claimed:${sessionId}`, issueId], {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 5000,
  });
  if (result.status !== 0) {
    const err = (result.stderr || result.stdout || '').toString().trim();
    if (err) process.stderr.write(`Beads claim sync warning: ${err}\n`);
    return false;
  }

  try {
    const xtrmDir = join(resolveMainRoot(cwd), '.xtrm');
    mkdirSync(xtrmDir, { recursive: true });
    writeFileSync(join(xtrmDir, resolveClaimFileName(cwd)), issueId);
  } catch { /* non-fatal */ }
  return true;
}

function syncClose(sessionId, cwd, issueId) {
  try { unlinkSync(join(resolveMainRoot(cwd), '.xtrm', resolveClaimFileName(cwd))); } catch { /* ok if missing */ }
  if (!issueId) return;
  spawnSync('bd', ['kv', 'set', `closed-this-session:${sessionId}`, issueId], {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 5000,
  });
}

function emitClaimContext(sessionId, issueId) {
  process.stdout.write(JSON.stringify({
    additionalContext: `\n✅ **XTRM work**: Session \`${sessionId}\` claimed \`${issueId}\`.`,
  }));
  process.stdout.write('\n');
}

function emitCloseContext(issueId) {
  process.stdout.write(JSON.stringify({
    additionalContext: `\n🔓 **XTRM work**: \`${issueId}\` closed. Evaluate durable memory/evidence before commit.`,
  }));
  process.stdout.write('\n');
}

function main() {
  const input = readInput();
  if (!input || input.hook_event_name !== 'PostToolUse') process.exit(0);
  if (!isShellTool(input.tool_name)) process.exit(0);

  const cwd = input.cwd || process.cwd();
  if (!isBeadsProject(cwd)) process.exit(0);

  const command = input.tool_input?.command || '';
  const sessionId = resolveSessionId(input);
  const succeeded = commandSucceeded(input);
  const receipt = succeeded ? parseWorkReceipt(input) : null;

  // Stable xt work bridge. The CLI shells to bd internally, so raw bd command detection cannot
  // see those mutations; the receipt is the explicit runtime integration seam.
  if (receipt?.action === 'start' || receipt?.action === 'resume') {
    if (syncClaim(sessionId, cwd, receipt.bead)) emitClaimContext(sessionId, receipt.bead);
    process.exit(0);
  }
  if (receipt?.action === 'done') {
    syncClose(sessionId, cwd, receipt.bead);
    emitCloseContext(receipt.bead);
    process.exit(0);
  }

  // Raw bd compatibility path.
  // Auto-claim fires regardless of exit code because bd can return 1 for "already in_progress".
  if (/\bbd\s+update\b/.test(command) && /--claim\b/.test(command)) {
    const match = command.match(/\bbd\s+update\s+(\S+)/);
    if (match) {
      const issueId = match[1];
      if (syncClaim(sessionId, cwd, issueId)) emitClaimContext(sessionId, issueId);
      process.exit(0);
    }
  }

  if (/\bbd\s+close\b/.test(command) && succeeded) {
    const match = command.match(/\bbd\s+close\s+(\S+)/);
    const closedIssueId = match?.[1];
    if (closedIssueId) {
      syncClose(sessionId, cwd, closedIssueId);
      emitCloseContext(closedIssueId);
    }
    process.exit(0);
  }

  process.exit(0);
}

main();
