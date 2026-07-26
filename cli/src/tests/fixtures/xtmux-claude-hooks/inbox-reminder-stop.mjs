#!/usr/bin/env node
// Stop: surface unread pane-scoped inbound messages once each.
//
// xtrm-wiy5n.4.24. Pi polls its inbox on a bounded 30 s cycle; Claude had no
// equivalent surface. The xtmux side of the PR (Jaggerxtrm/xtmux#87) makes
// `message-list --pane $TMUX_PANE` resolve `--for` from live tmux, so this
// hook can query the pane's inbox in one call.
//
// Anti-spin (mandatory, PR body must state it):
//   - Fires on Stop only; there is no poller, no daemon.
//   - Skips when `stop_hook_active` is true, matching the existing Stop hook.
//   - Records each surfaced messageKey in the tmux option
//     `@agent_inbox_reminded_keys` (comma-separated). Same-message-still-
//     pending on the next Stop is INTENTIONALLY silent: it stays recorded
//     and stays silent until the operator acks or replies (at which point
//     the row leaves the `--unacked` projection anyway). A NEW message on
//     a later Stop is a NEW key and gets its own one-time reminder.
//   - Bounded per Stop: at most `--limit LIMIT` rows + one option read +
//     one option write. No retries, no loops.
//
// Skipped entirely when there is no live tmux pane (TMUX_PANE unset): the
// query surface itself has nothing to resolve to, and this hook exists to
// serve tmux-panes, not headless invocations.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const PICKER = process.env.XTMUX_PICKER || `${process.env.HOME}/.local/bin/xtmux`;
const LIMIT = Math.max(1, Math.min(Number(process.env.XTMUX_INBOX_REMINDER_LIMIT ?? 5) || 5, 25));
const OPTION_NAME = "@agent_inbox_reminded_keys";
const MAX_REMINDED_KEYS = 128; // bounded ring so the option cannot grow forever
const CMD_TIMEOUT_MS = 5000;

function readInput() {
  try { return JSON.parse(readFileSync(0, "utf8")); } catch { return null; }
}

function pickerJson(args, command) {
  const result = spawnSync(PICKER, args, { encoding: "utf8", timeout: CMD_TIMEOUT_MS });
  if (result.status !== 0) {
    const detail = String(result.stderr || result.error?.message || `exit ${result.status}`).trim().replace(/\s+/g, " ").slice(0, 400);
    throw new Error(`${command} failed${detail ? `: ${detail}` : ""}`);
  }
  try { return JSON.parse(result.stdout || ""); }
  catch (error) { throw new Error(`Malformed ${command} JSON: ${error instanceof Error ? error.message : String(error)}`); }
}

// tmux show-options -qv returns the empty string on unknown option (no error);
// -q silences the "unknown option" message so a fresh pane never sees a stack.
function readRemindedKeys(pane) {
  const result = spawnSync("tmux", ["show-options", "-p", "-t", pane, "-qv", OPTION_NAME], { encoding: "utf8", timeout: CMD_TIMEOUT_MS });
  if (result.status !== 0) return new Set();
  return new Set(String(result.stdout || "").trim().split(",").filter(Boolean));
}

function writeRemindedKeys(pane, keys) {
  const bounded = keys.slice(Math.max(0, keys.length - MAX_REMINDED_KEYS));
  spawnSync("tmux", ["set-option", "-p", "-t", pane, OPTION_NAME, bounded.join(",")], { timeout: CMD_TIMEOUT_MS });
}

function formatReminder(row) {
  const sender = String(row.senderId ?? "?");
  const bead = row.beadId ? ` (${row.beadId})` : "";
  const summary = String(row.summary ?? "").replace(/\s+/g, " ").slice(0, 200);
  return row.expectsReply
    ? `Reply required: ${sender}${bead}: ${summary}`
    : `Inbox FYI: ${sender}${bead}: ${summary}`;
}

function main() {
  if (process.env.XTMUX_INBOX_REMINDER_DISABLE === "1") return;
  const pane = process.env.TMUX_PANE;
  if (!pane) return;
  const input = readInput();
  if (input && input.stop_hook_active) return;

  try {
    const rows = pickerJson(
      ["message-list", "--pane", pane, "--unacked", "--expects-reply", "--json", "--limit", String(LIMIT)],
      "message-list",
    );
    if (!Array.isArray(rows) || rows.length === 0) return;
    const invalid = rows.filter((row) => typeof row?.messageKey !== "string");
    if (invalid.length > 0) throw new Error("Incompatible message-list JSON result");

    const alreadyReminded = readRemindedKeys(pane);
    const fresh = rows.filter((row) => !alreadyReminded.has(String(row.messageKey)));
    if (fresh.length === 0) return;

    for (const row of fresh) {
      process.stderr.write(`xtmux inbox: ${formatReminder(row)}\n`);
    }
    process.stderr.write(`xtmux inbox: reply with \`xtmux message-reply --in-reply-to <messageKey> --text ...\` (${fresh.length} new; ${rows.length - fresh.length} suppressed as already reminded).\n`);

    const updated = [...alreadyReminded, ...fresh.map((row) => String(row.messageKey))];
    writeRemindedKeys(pane, updated);
  } catch (error) {
    // Best-effort: never block Stop, never crash the pane. Print a one-line
    // diagnostic so a broken CLI surface stays visible without derailing
    // whatever the operator was doing.
    process.stderr.write(`xtmux inbox reminder unavailable: ${String(error instanceof Error ? error.message : error).slice(0, 300)}\n`);
  }
}

main();
