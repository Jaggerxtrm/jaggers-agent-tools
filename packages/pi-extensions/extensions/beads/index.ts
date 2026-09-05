import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType, isBashToolResult } from "@earendil-works/pi-coding-agent";
import { SubprocessRunner, EventAdapter } from "../../src/core";

export default function (pi: ExtensionAPI) {
	const getCwd = (ctx: any) => ctx.cwd || process.cwd();

	let cachedSessionId: string | null = null;
	let memoryGateFired = false;

	// Resolve a stable session ID across event types.
	const getSessionId = (ctx: any): string => {
		const fromManager = ctx?.sessionManager?.getSessionId?.();
		const fromContext = ctx?.sessionId ?? ctx?.session_id;
		const resolved = fromManager || fromContext || cachedSessionId || process.pid.toString();
		if (resolved && !cachedSessionId) cachedSessionId = resolved;
		return resolved;
	};

	const getSessionClaim = async (sessionId: string, cwd: string): Promise<string | null> => {
		const result = await SubprocessRunner.run("bd", ["kv", "get", `claimed:${sessionId}`], { cwd });
		if (result.code !== 0) return null;
		const claim = result.stdout.trim();
		return claim.length > 0 ? claim : null;
	};

	const clearClaimMarker = async (sessionId: string, cwd: string) => {
		await SubprocessRunner.run("bd", ["kv", "clear", `claimed:${sessionId}`], { cwd });
	};

	const isIssueInProgress = async (issueId: string, cwd: string): Promise<boolean | null> => {
		const result = await SubprocessRunner.run("bd", ["show", issueId, "--json"], { cwd });
		if (result.code !== 0 || !result.stdout.trim()) return null;
		try {
			const parsed = JSON.parse(result.stdout);
			const issue = Array.isArray(parsed) ? parsed[0] : parsed;
			if (!issue?.status) return null;
			return issue.status === "in_progress";
		} catch {
			return null;
		}
	};

	const getActiveClaim = async (sessionId: string, cwd: string): Promise<string | null> => {
		const claim = await getSessionClaim(sessionId, cwd);
		if (!claim) return null;

		const inProgress = await isIssueInProgress(claim, cwd);
		if (inProgress === false) {
			await clearClaimMarker(sessionId, cwd);
			return null;
		}

		return claim;
	};

	const getClosedThisSession = async (sessionId: string, cwd: string): Promise<string | null> => {
		const result = await SubprocessRunner.run("bd", ["kv", "get", `closed-this-session:${sessionId}`], { cwd });
		if (result.code !== 0) return null;
		const issue = result.stdout.trim();
		return issue.length > 0 ? issue : null;
	};

	const clearSessionMarkers = async (sessionId: string, cwd: string) => {
		await SubprocessRunner.run("bd", ["kv", "clear", `claimed:${sessionId}`], { cwd });
		await SubprocessRunner.run("bd", ["kv", "clear", `closed-this-session:${sessionId}`], { cwd });
	};

	// --- Claim-lookup cache (run-scoped) -----------------------------------------
	// getActiveClaim spawns bd kv get (~850ms) + bd show (~300ms). Running these on EVERY
	// mutating tool call added ~1s to each edit. Cache the resolved claim for the lifetime
	// of the run and invalidate only when we OBSERVE a claim/close/KV mutation in the
	// tool_result hook below. xtrm-64pl0: replaces the old 3s time-based TTL, which re-spawned
	// bd every 3s even when claim state had not changed.
	let activeClaimCache: { sessionId: string; cwd: string; value: string | null } | null = null;

	const invalidateClaimCache = (): void => {
		activeClaimCache = null;
	};

	const getActiveClaimCached = async (sessionId: string, cwd: string): Promise<string | null> => {
		if (activeClaimCache && activeClaimCache.sessionId === sessionId && activeClaimCache.cwd === cwd) {
			return activeClaimCache.value;
		}
		const value = await getActiveClaim(sessionId, cwd);
		activeClaimCache = { sessionId, cwd, value };
		return value;
	};

	const stripQuoted = (command: string): string => command.replace(/'[^']*'|"[^"]*"/g, "");
	const isSpecialistsSubprocessCommand = (commandUnquoted: string): boolean =>
		/\bspecialists\s+(run|resume|result|feed|stop|status)\b/.test(commandUnquoted);

	const getClosedIssueIdFromCommand = (commandUnquoted: string): string | null => {
		const match = commandUnquoted.match(/\bbd\s+close\s+(\S+)/);
		const issueId = match?.[1]?.trim();
		if (!issueId || issueId.startsWith("-")) return null;
		return issueId;
	};

	const hasIssueMemoryAck = async (issueId: string, cwd: string): Promise<boolean> => {
		const result = await SubprocessRunner.run("bd", ["kv", "get", `memory-acked:${issueId}`], { cwd });
		return result.code === 0 && result.stdout.trim().length > 0;
	};

	const closeMemoryBlockReason = (issueId: string): string =>
		`MEMORY_GATE_BLOCK issue=${issueId} run="bd remember '<insight>' && bd kv set 'memory-acked:${issueId}' 'saved:<key>'" or="bd kv set 'memory-acked:${issueId}' 'nothing novel:<reason>'" then="xt work done ${issueId} --reason='<reason>'"`;

	pi.on("session_start", async (_event, ctx) => {
		cachedSessionId = ctx?.sessionManager?.getSessionId?.() ?? ctx?.sessionId ?? ctx?.session_id ?? cachedSessionId;
		return undefined;
	});

	pi.on("tool_call", async (event, ctx) => {
		const cwd = getCwd(ctx);
		if (!EventAdapter.isBeadsProject(cwd)) return undefined;
		const sessionId = getSessionId(ctx);

		// xtrm-64pl0: the edit gate no longer falls back to `bd list` (hasTrackableWork) to
		// decide whether the board has work. Within a beads project (isBeadsProject guard above)
		// an edit without an active claim is blocked directly — no bd list subprocess. Behavior
		// change: empty-board edits in a beads project now require a claim too (documented in
		// CHANGELOG.md and docs/pi-extensions.md).
		if (EventAdapter.isMutatingFileTool(event)) {
			const claim = await getActiveClaimCached(sessionId, cwd);
			if (!claim) {
				if (ctx.hasUI) {
					ctx.ui.notify("XTRM: Edit blocked. Check in to tracked work first.", "warning");
				}
				return {
					block: true,
					reason:
						`No active work identity for session ${sessionId}.\n` +
						`  existing tracked work: xt work start --bead <id>\n` +
						`  bounded local work:   xt work start "<short title>" --validation "<proof>"\n` +
						`  substantial work:     /planning first\n` +
						`  lifecycle help:       xt work guide\n`,
				};
			}
		}

		if (isToolCallEventType("bash", event)) {
			const command = event.input.command ?? "";
			const commandUnquoted = stripQuoted(command);

			if (isSpecialistsSubprocessCommand(commandUnquoted)) return undefined;

			const closedIssueId = getClosedIssueIdFromCommand(commandUnquoted);
			if (closedIssueId) {
				const acked = await hasIssueMemoryAck(closedIssueId, cwd);
				if (!acked) {
					return {
						block: true,
						reason: closeMemoryBlockReason(closedIssueId),
					};
				}
			}

			if (/\bgit\s+commit\b/.test(commandUnquoted)) {
				const claim = await getActiveClaimCached(sessionId, cwd);
				if (claim) {
					return {
						block: true,
						reason: `Active work [${claim}] — close it first.\n  xt work done ${claim} --reason="<validated result>"\n  (Pi workflow) publish/merge are external steps; do not rely on xtrm finish.\n`,
					};
				}
			}
		}

		return undefined;
	});

	pi.on("tool_result", async (event, ctx) => {
		if (!isBashToolResult(event)) return undefined;

		const command = event.input.command || "";
		const sessionId = getSessionId(ctx);
		const cwd = getCwd(ctx);

		// xtrm-64pl0: invalidate the run-scoped claim cache when we observe a KV mutation that
		// could change claim state. claim/close mutations are also invalidated further below.
		if (/\bbd\s+kv\s+(set|clear)\s+["']?(claimed:|closed-this-session:)/.test(command)) {
			invalidateClaimCache();
		}

		// Auto-claim on bd update --claim regardless of exit code.
		if (/\bbd\s+update\b/.test(command) && /--claim\b/.test(command)) {
			const issueMatch = command.match(/\bbd\s+update\s+(\S+)/);
			if (issueMatch) {
				const issueId = issueMatch[1];
				await SubprocessRunner.run("bd", ["kv", "set", `claimed:${sessionId}`, issueId], { cwd });
				memoryGateFired = false;
				invalidateClaimCache();
				const claimNotice = `\n\n✅ **XTRM work**: Session \`${sessionId}\` claimed \`${issueId}\`. File edits are now unblocked.`;
				return { content: [...event.content, { type: "text", text: claimNotice }] };
			}
		}

		if (/\bbd\s+close\b/.test(command) && !event.isError) {
			const closeMatch = command.match(/\bbd\s+close\s+(\S+)/);
			const closedIssueId = closeMatch?.[1] ?? null;

			if (closedIssueId) {
				await SubprocessRunner.run("bd", ["kv", "set", `closed-this-session:${sessionId}`, closedIssueId], { cwd });
				memoryGateFired = false;
				invalidateClaimCache();
			}

			const memoryGateText = closedIssueId
				? `\n\n**Beads Memory Gate**: close-time memory ack verified for \`${closedIssueId}\` (\`memory-acked:${closedIssueId}\`).`
				: `\n\n**XTRM work**: Work completed. Consider if this session produced insights worth persisting via \`bd remember\`.`;
			return { content: [...event.content, { type: "text", text: memoryGateText }] };
		}

		return undefined;
	});

	// Memory gate: clean up session markers and check ack at session_shutdown.
	// Memory gate prompt was already injected into bd close tool_result context (silent, agent-visible only).
	// No UI notification — parity with Claude Stop hook {additionalContext} pattern.
	const triggerMemoryGateIfNeeded = async (ctx: any) => {
		const cwd = getCwd(ctx);
		if (!EventAdapter.isBeadsProject(cwd)) return;
		const sessionId = getSessionId(ctx);

		const markerCheck = await SubprocessRunner.run("bd", ["kv", "get", `memory-gate-done:${sessionId}`], { cwd });
		if (markerCheck.code === 0) {
			await SubprocessRunner.run("bd", ["kv", "clear", `memory-gate-done:${sessionId}`], { cwd });
			await clearSessionMarkers(sessionId, cwd);
			memoryGateFired = false;
			return;
		}

		if (memoryGateFired) return;

		const closedIssueId = await getClosedThisSession(sessionId, cwd);
		if (!closedIssueId) return;

		const closeTimeAcked = await hasIssueMemoryAck(closedIssueId, cwd);
		if (closeTimeAcked) {
			await SubprocessRunner.run("bd", ["kv", "clear", `closed-this-session:${sessionId}`], { cwd });
			memoryGateFired = false;
			return;
		}

		memoryGateFired = true;
		// No notify — memory gate was injected into bd close tool_result content (silent, agent-visible only).
	};

	// xtrm-64pl0: single lifecycle memory-gate check. Previously BOTH agent_end (every turn)
	// and session_shutdown ran this, each spawning ~4 bd kv subprocesses. The authoritative
	// memory safety is the bd-close block in tool_call above; this is end-of-session marker
	// hygiene only, so it now runs once at session_shutdown.
	pi.on("session_shutdown", async (_event, ctx) => {
		await triggerMemoryGateIfNeeded(ctx);
		return undefined;
	});
}
