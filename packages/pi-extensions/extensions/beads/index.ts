import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType, isBashToolResult } from "@earendil-works/pi-coding-agent";
import { SubprocessRunner, EventAdapter } from "../../src/core";

const WORK_RECEIPT_PREFIX = "XTRM_WORK_RECEIPT ";

type WorkReceipt = {
	schema: "xt.work.receipt.v1";
	action: "start" | "resume" | "note" | "done";
	bead: string;
};

export default function (pi: ExtensionAPI) {
	const getCwd = (ctx: any) => ctx.cwd || process.cwd();

	let cachedSessionId: string | null = null;
	let memoryGateFired = false;

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

	const setSessionClaim = async (sessionId: string, issueId: string, cwd: string) => {
		await SubprocessRunner.run("bd", ["kv", "set", `claimed:${sessionId}`, issueId], { cwd });
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

	const getWorkDoneExplicitId = (commandUnquoted: string): string | null => {
		const match = commandUnquoted.match(/\b(?:xt|xtrm)\s+work\s+done(?:\s+(\S+))?/);
		const issueId = match?.[1]?.trim();
		if (!issueId || issueId.startsWith("-")) return null;
		return issueId;
	};

	const extractEventText = (content: unknown): string => {
		if (typeof content === "string") return content;
		if (!Array.isArray(content)) return "";
		return content
			.map((entry) => {
				if (typeof entry === "string") return entry;
				if (entry && typeof entry === "object" && "text" in entry && typeof (entry as any).text === "string") {
					return (entry as any).text;
				}
				return "";
			})
			.filter(Boolean)
			.join("\n");
	};

	const parseWorkReceipt = (content: unknown): WorkReceipt | null => {
		const text = extractEventText(content);
		for (const line of text.split(/\r?\n/)) {
			if (!line.startsWith(WORK_RECEIPT_PREFIX)) continue;
			try {
				const receipt = JSON.parse(line.slice(WORK_RECEIPT_PREFIX.length));
				if (
					receipt?.schema === "xt.work.receipt.v1" &&
					["start", "resume", "note", "done"].includes(receipt.action) &&
					typeof receipt.bead === "string" && receipt.bead.length > 0
				) return receipt as WorkReceipt;
			} catch { /* malformed receipt: ignore */ }
		}
		return null;
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

			let closingIssueId = getClosedIssueIdFromCommand(commandUnquoted);
			if (/\b(?:xt|xtrm)\s+work\s+done\b/.test(commandUnquoted)) {
				closingIssueId = getWorkDoneExplicitId(commandUnquoted) ?? await getActiveClaimCached(sessionId, cwd);
			}

			if (closingIssueId) {
				const acked = await hasIssueMemoryAck(closingIssueId, cwd);
				if (!acked) {
					return {
						block: true,
						reason: closeMemoryBlockReason(closingIssueId),
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

		return undefined;
	});

	pi.on("tool_result", async (event, ctx) => {
		if (!isBashToolResult(event)) return undefined;

		const command = event.input.command || "";
		const sessionId = getSessionId(ctx);
		const cwd = getCwd(ctx);
		const receipt = !event.isError ? parseWorkReceipt(event.content) : null;

		if (/\bbd\s+kv\s+(set|clear)\s+["']?(claimed:|closed-this-session:)/.test(command)) {
			invalidateClaimCache();
		}

		if (receipt?.action === "start" || receipt?.action === "resume") {
			await setSessionClaim(sessionId, receipt.bead, cwd);
			memoryGateFired = false;
			invalidateClaimCache();
			const claimNotice = `\n\n✅ **XTRM work**: Session \`${sessionId}\` claimed \`${receipt.bead}\`. File edits are now unblocked.`;
			return { content: [...event.content, { type: "text", text: claimNotice }] };
		}

		if (receipt?.action === "done") {
			await SubprocessRunner.run("bd", ["kv", "set", `closed-this-session:${sessionId}`, receipt.bead], { cwd });
			await clearClaimMarker(sessionId, cwd);
			memoryGateFired = false;
			invalidateClaimCache();
			const memoryGateText = `\n\n**XTRM work**: \`${receipt.bead}\` closed; close-time memory acknowledgement was verified before execution.`;
			return { content: [...event.content, { type: "text", text: memoryGateText }] };
		}

		// Raw bd compatibility path.
		if (/\bbd\s+update\b/.test(command) && /--claim\b/.test(command)) {
			const issueMatch = command.match(/\bbd\s+update\s+(\S+)/);
			if (issueMatch) {
				const issueId = issueMatch[1];
				await setSessionClaim(sessionId, issueId, cwd);
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
				await clearClaimMarker(sessionId, cwd);
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
	};

	pi.on("session_shutdown", async (_event, ctx) => {
		await triggerMemoryGateIfNeeded(ctx);
		return undefined;
	});
}
