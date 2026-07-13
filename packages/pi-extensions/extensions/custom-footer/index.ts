/** XTRM footer: git/model context plus shared beads status and Pi-only epic expansion. */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { SubprocessRunner } from "../../src/core";

type RefreshKind = "runtime" | "compact";

type CacheIssue = { id: string; title: string | null; status: string; parent?: string };
type Descendants = { epicId: string; ts: number; items: CacheIssue[]; overflow: number };
type BeadsCache = {
	v: number;
	ts: number;
	stale: boolean;
	counts: { open: number; in_progress: number; blocked: number };
	activeIssues: CacheIssue[];
	activeEpic: { id: string; title: string | null; closed: number; total: number } | null;
	descendants?: Descendants;
};
type CacheModule = {
	TTL_COMPACT_MS: number;
	TTL_DESCENDANTS_MS: number;
	resolveMainRoot(cwd: string): string;
	readCache(mainRoot: string): BeadsCache | null;
	isFresh(cache: BeadsCache | null, ttl?: number): boolean;
	writeCache(mainRoot: string, data: Omit<BeadsCache, "v" | "ts" | "stale">): void;
	takeLease(mainRoot: string): boolean;
	releaseLease(mainRoot: string): void;
	formatCompact(data: BeadsCache | null, options: { cols: number; color?: boolean }): string;
};

const CACHE_MODULE = ".xtrm/hooks/beads-status-cache.mjs";
const CACHE_REFRESH_SCRIPT = `
const [cwd, moduleUrl] = process.argv.slice(1);
const cache = await import(moduleUrl);
const root = cache.resolveMainRoot(cwd);
if (!cache.takeLease(root)) process.exit(0);
try {
  const previous = cache.readCache(root);
  const compact = cache.fetchCompact(cwd);
  cache.writeCache(root, { ...compact, ...(previous?.descendants ? { descendants: previous.descendants } : {}) });
} catch {
  cache.markStale(root);
  process.exitCode = 1;
} finally {
  cache.releaseLease(root);
}`;
const CACHE_TTL = 5000;
const REFRESH_TIMEOUT_MS = 2000;
const COMPACT_REFRESH_TIMEOUT_MS = 10_000;
const DESCENDANT_REFRESH_TIMEOUT_MS = 5000;
const TOOL_RESULT_REFRESH_DELAY_MS = 200;
const FOOTER_REAPPLY_DELAY_MS = 40;
const MAX_DESCENDANTS = 50;

const STATUS: Record<string, { icon: string; label: string; color: string }> = {
	open: { icon: "○", label: "open", color: "text" },
	in_progress: { icon: "◐", label: "in progress", color: "accent" },
	blocked: { icon: "●", label: "blocked", color: "warning" },
	closed: { icon: "✓", label: "closed", color: "dim" },
};

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10_000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
	return count < 10_000_000 ? `${(count / 1_000_000).toFixed(1)}M` : `${Math.round(count / 1_000_000)}M`;
}

function parseGitFlags(porcelain: string): string {
	let modified = false;
	let staged = false;
	let deleted = false;
	for (const line of porcelain.split("\n").filter(Boolean)) {
		if (/^ M|^AM|^MM/.test(line)) modified = true;
		if (/^A |^M /.test(line)) staged = true;
		if (/^ D|^D /.test(line)) deleted = true;
	}
	return `${modified ? "*" : ""}${staged ? "+" : ""}${deleted ? "-" : ""}`;
}

function orderDescendants(items: CacheIssue[], epicId: string): CacheIssue[] {
	const children = new Map<string, CacheIssue[]>();
	for (const item of items) {
		const parent = item.parent ?? epicId;
		const siblings = children.get(parent) ?? [];
		siblings.push(item);
		children.set(parent, siblings);
	}
	for (const siblings of children.values()) siblings.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

	const ordered: CacheIssue[] = [];
	const seen = new Set<string>();
	const visit = (parent: string) => {
		for (const child of children.get(parent) ?? []) {
			if (seen.has(child.id)) continue;
			seen.add(child.id);
			ordered.push(child);
			visit(child.id);
		}
	};
	visit(epicId);
	for (const item of items) if (!seen.has(item.id)) ordered.push(item);
	return ordered;
}

function descendantDepth(item: CacheIssue, descendants: Descendants): number {
	const byId = new Map(descendants.items.map((entry) => [entry.id, entry]));
	let depth = 1;
	let parent = item.parent;
	const seen = new Set<string>();
	while (parent && parent !== descendants.epicId && !seen.has(parent)) {
		seen.add(parent);
		depth += 1;
		parent = byId.get(parent)?.parent;
	}
	return depth;
}

function renderEpicTree(cache: BeadsCache, width: number, theme: any): string[] {
	const epic = cache.activeEpic;
	const descendants = cache.descendants;
	if (!epic) return [];
	const shortEpic = epic.id.split("-").pop() ?? epic.id;
	const title = epic.title ? ` — ${epic.title}` : "";
	const lines = [truncateToWidth(theme.fg("muted", `epic ${shortEpic} (${epic.closed}/${epic.total} done)${title}`), width)];
	if (!descendants || descendants.epicId !== epic.id || Date.now() - descendants.ts >= 30_000) {
		lines.push(theme.fg("dim", "  loading epic tree…"));
		return lines;
	}
	for (const item of descendants.items) {
		const status = STATUS[item.status] ?? STATUS.open;
		const relativeId = item.id.startsWith(`${epic.id}.`) ? item.id.slice(epic.id.length) : item.id;
		const indent = "  ".repeat(descendantDepth(item, descendants));
		const row = `${indent}${status.icon} ${relativeId}  ${status.label}  ${item.title ?? ""}`;
		lines.push(truncateToWidth(theme.fg(status.color, row), width));
	}
	if (descendants.overflow > 0) lines.push(theme.fg("dim", `  +${descendants.overflow} more (bd show ${epic.id})`));
	return lines;
}

export default function registerCustomFooter(pi: ExtensionAPI): void {
	let capturedCtx: any = null;
	let cacheModule: CacheModule | null = null;
	let cacheModuleUrl = "";
	let mainRoot = "";
	let beadsCache: BeadsCache | null = null;
	let requestRender: (() => void) | null = null;
	let branchChangeUnsub: (() => void) | null = null;
	let footerReapplyTimer: ReturnType<typeof setTimeout> | null = null;
	let scheduledRefreshTimer: ReturnType<typeof setTimeout> | null = null;
	let descendantRefreshTimer: ReturnType<typeof setTimeout> | null = null;
	let cacheSyncTimer: ReturnType<typeof setInterval> | null = null;
	let scheduledRefreshKinds = new Set<RefreshKind>();
	let runningRefreshPromise: Promise<void> | null = null;
	let refreshingRuntime = false;
	let refreshingCompact = false;
	let refreshingDescendants = false;
	let beadsExpanded = false;
	let runtimeState = { branch: null as string | null, gitStatus: "", lastFetch: 0 };

	const cwd = () => capturedCtx?.cwd || process.cwd();
	const run = (command: string, args: string[], timeoutMs = REFRESH_TIMEOUT_MS) =>
		SubprocessRunner.run(command, args, { cwd: cwd(), timeoutMs });

	const loadCacheModule = async (): Promise<void> => {
		if (cacheModule) return;
		const root = await run("git", ["rev-parse", "--show-toplevel"]);
		const projectRoot = root.code === 0 ? root.stdout.trim() : cwd();
		cacheModuleUrl = pathToFileURL(join(projectRoot, CACHE_MODULE)).href;
		try {
			cacheModule = (await import(/* @vite-ignore */ cacheModuleUrl)) as CacheModule;
			mainRoot = cacheModule.resolveMainRoot(cwd());
			beadsCache = cacheModule.readCache(mainRoot);
		} catch {
			cacheModule = null;
		}
	};

	const syncCache = (): void => {
		if (!cacheModule || !mainRoot) return;
		const next = cacheModule.readCache(mainRoot);
		if (next?.ts === beadsCache?.ts && next?.stale === beadsCache?.stale) return;
		beadsCache = next;
		requestRender?.();
	};

	const startCacheSync = (): void => {
		if (cacheSyncTimer) clearInterval(cacheSyncTimer);
		cacheSyncTimer = setInterval(syncCache, CACHE_TTL);
		cacheSyncTimer.unref?.();
	};

	const refreshRuntime = async (): Promise<void> => {
		if (refreshingRuntime || Date.now() - runtimeState.lastFetch < CACHE_TTL) return;
		refreshingRuntime = true;
		try {
			let branch: string | null = null;
			let gitStatus = "";
			const root = await run("git", ["rev-parse", "--show-toplevel"]);
			if (root.code === 0 && root.stdout.trim()) {
				const [branchResult, porcelainResult, abResult] = await Promise.all([
					run("git", ["branch", "--show-current"]),
					run("git", ["--no-optional-locks", "status", "--porcelain"]),
					run("git", ["--no-optional-locks", "rev-list", "--left-right", "--count", "@{upstream}...HEAD"]),
				]);
				branch = branchResult.code === 0 ? branchResult.stdout.trim() || null : null;
				gitStatus = porcelainResult.code === 0 ? parseGitFlags(porcelainResult.stdout) : "";
				if (abResult.code === 0) {
					const [behind, ahead] = abResult.stdout.trim().split(/\s+/).map(Number);
					gitStatus += ahead > 0 && behind > 0 ? "↕" : ahead > 0 ? "↑" : behind > 0 ? "↓" : "";
				}
			}
			runtimeState = { branch, gitStatus, lastFetch: Date.now() };
			requestRender?.();
		} finally {
			refreshingRuntime = false;
		}
	};

	const refreshCompact = async (): Promise<void> => {
		if (refreshingCompact) return;
		refreshingCompact = true;
		try {
			await loadCacheModule();
			if (!cacheModule || !cacheModuleUrl) return;
			await run(process.execPath, ["--input-type=module", "-e", CACHE_REFRESH_SCRIPT, cwd(), cacheModuleUrl], COMPACT_REFRESH_TIMEOUT_MS);
			syncCache();
		} finally {
			refreshingCompact = false;
		}
	};

	const refreshDescendants = async (): Promise<void> => {
		if (refreshingDescendants || !cacheModule || !mainRoot || !beadsCache?.activeEpic) return;
		const epicId = beadsCache.activeEpic.id;
		if (!cacheModule.isFresh(beadsCache)) await refreshCompact();
		if (!cacheModule.takeLease(mainRoot)) return;
		refreshingDescendants = true;
		try {
			const result = await run("bd", ["query", `id=\"${epicId}.*\"`, "--all", "--limit", "0", "--json"], DESCENDANT_REFRESH_TIMEOUT_MS);
			if (result.code !== 0) return;
			const raw = JSON.parse(result.stdout) as Array<Record<string, unknown>>;
			const allItems = raw.map((item) => ({
				id: String(item.id ?? ""),
				title: typeof item.title === "string" ? item.title.slice(0, 80) : null,
				status: String(item.status ?? "open"),
				parent: typeof item.parent === "string" ? item.parent : typeof item.parent_id === "string" ? item.parent_id : epicId,
			})).filter((item) => item.id);
			const ordered = orderDescendants(allItems, epicId);
			const current = cacheModule.readCache(mainRoot) ?? beadsCache;
			if (!current) return;
			cacheModule.writeCache(mainRoot, {
				counts: current.counts,
				activeIssues: current.activeIssues,
				activeEpic: current.activeEpic ? {
					...current.activeEpic,
					closed: ordered.filter((item) => item.status === "closed").length,
					total: ordered.length,
				} : null,
				descendants: {
					epicId,
					ts: Date.now(),
					items: ordered.slice(0, MAX_DESCENDANTS),
					overflow: Math.max(0, ordered.length - MAX_DESCENDANTS),
				},
			});
			syncCache();
		} catch {
			// Keep the compact cache and loading row.
		} finally {
			refreshingDescendants = false;
			cacheModule.releaseLease(mainRoot);
		}
	};

	const scheduleDescendants = (): void => {
		if (descendantRefreshTimer || refreshingDescendants) return;
		descendantRefreshTimer = setTimeout(() => {
			descendantRefreshTimer = null;
			void refreshDescendants();
		}, 0);
	};

	const runRefreshes = async (kinds: ReadonlySet<RefreshKind>): Promise<void> => {
		await Promise.all([
			kinds.has("runtime") ? refreshRuntime() : Promise.resolve(),
			kinds.has("compact") ? refreshCompact() : Promise.resolve(),
		]);
	};
	const flushRefreshes = async (): Promise<void> => {
		if (runningRefreshPromise) return runningRefreshPromise;
		const kinds = scheduledRefreshKinds;
		scheduledRefreshKinds = new Set<RefreshKind>();
		runningRefreshPromise = runRefreshes(kinds).finally(async () => {
			runningRefreshPromise = null;
			if (scheduledRefreshKinds.size) await flushRefreshes();
		});
		return runningRefreshPromise;
	};
	const scheduleRefresh = (kinds: readonly RefreshKind[], delayMs = 0): void => {
		for (const kind of kinds) scheduledRefreshKinds.add(kind);
		if (scheduledRefreshTimer) return;
		scheduledRefreshTimer = setTimeout(() => {
			scheduledRefreshTimer = null;
			void flushRefreshes();
		}, delayMs);
	};

	const applyFooter = (ctx: any): void => {
		capturedCtx = ctx;
		ctx.ui.setFooter((tui: any, theme: any, footerData: any) => {
			const instanceRender = () => tui.requestRender();
			requestRender = instanceRender;
			branchChangeUnsub?.();
			const unsubscribe = footerData.onBranchChange(() => {
				runtimeState.lastFetch = 0;
				scheduleRefresh(["runtime"]);
			});
			branchChangeUnsub = unsubscribe;
			return {
				dispose() {
					unsubscribe?.();
					if (branchChangeUnsub === unsubscribe) branchChangeUnsub = null;
					if (requestRender === instanceRender) requestRender = null;
				},
				invalidate() {},
				render(width: number): string[] {
					let pwd = ctx.cwd || process.cwd();
					const home = process.env.HOME || process.env.USERPROFILE;
					if (home && pwd.startsWith(home)) pwd = `~${pwd.slice(home.length)}`;
					const branch = runtimeState.branch || footerData.getGitBranch();
					if (branch) pwd += ` (${branch}${runtimeState.gitStatus ? ` ${runtimeState.gitStatus}` : ""})`;
					const lines = [truncateToWidth(theme.fg("dim", pwd), width, theme.fg("dim", "..."))];

					const usage = ctx.getContextUsage();
					const model = ctx.model;
					const contextWindow = usage?.contextWindow ?? model?.contextWindow ?? 0;
					const percentValue = usage?.percent ?? 0;
					const contextDisplay = usage?.percent == null ? `?/${formatTokens(contextWindow)}` : `${percentValue.toFixed(1)}%/${formatTokens(contextWindow)}`;
					let modelDisplay = model?.id || "no-model";
					if (model?.reasoning) modelDisplay += ` • ${pi.getThinkingLevel() || "off"}`;
					if (footerData.getAvailableProviderCount() > 1 && model) modelDisplay = `(${model.provider}) ${modelDisplay}`;
					const available = Math.max(0, width - visibleWidth(contextDisplay) - 1);
					const usageColor = percentValue > 90 ? "error" : percentValue > 70 ? "warning" : "dim";
					lines.push(`${theme.fg(usageColor, contextDisplay)} ${theme.fg("dim", truncateToWidth(modelDisplay, available, ""))}`);

					const compact = cacheModule?.formatCompact(beadsCache, { cols: width }) ?? "beads unavailable";
					lines.push(truncateToWidth(compact, width));
					if (beadsExpanded && beadsCache?.activeEpic) {
						const descendants = beadsCache.descendants;
						if (!descendants || descendants.epicId !== beadsCache.activeEpic.id || Date.now() - descendants.ts >= (cacheModule?.TTL_DESCENDANTS_MS ?? 30_000)) {
							scheduleDescendants();
						}
						lines.push(...renderEpicTree(beadsCache, width, theme));
					}
					return lines;
				},
			};
		});
	};

	const reapplyFooter = (ctx: any): void => {
		if (footerReapplyTimer) clearTimeout(footerReapplyTimer);
		footerReapplyTimer = setTimeout(() => {
			applyFooter(ctx);
			footerReapplyTimer = null;
		}, FOOTER_REAPPLY_DELAY_MS);
	};
	const reset = (): void => {
		beadsExpanded = false;
		runtimeState.lastFetch = 0;
		beadsCache = null;
		cacheModule = null;
		mainRoot = "";
	};

	const toggleBeads = (): void => {
		beadsExpanded = !beadsExpanded;
		if (beadsExpanded) scheduleDescendants();
		requestRender?.();
	};

	pi.registerCommand("beads", {
		description: "Toggle the active epic tree",
		handler: async () => toggleBeads(),
	});
	pi.registerShortcut("ctrl+b", {
		description: "Toggle the active epic tree",
		handler: async () => toggleBeads(),
	});

	pi.on("session_start", async (_event, ctx) => {
		capturedCtx = ctx;
		reset();
		await loadCacheModule();
		applyFooter(ctx);
		startCacheSync();
		reapplyFooter(ctx);
		scheduleRefresh(["runtime", ...(cacheModule?.isFresh(beadsCache) ? [] : ["compact" as const])]);
	});
	pi.on("session_switch", async (_event, ctx) => {
		capturedCtx = ctx;
		reset();
		await loadCacheModule();
		reapplyFooter(ctx);
		scheduleRefresh(["runtime", "compact"]);
	});
	pi.on("session_fork", async (_event, ctx) => {
		capturedCtx = ctx;
		reset();
		await loadCacheModule();
		reapplyFooter(ctx);
		scheduleRefresh(["runtime", "compact"]);
	});
	pi.on("model_select", async (_event, ctx) => reapplyFooter(ctx));
	pi.on("tool_result", async (event: any) => {
		const command = event?.input?.command;
		if (!command) return undefined;
		const kinds: RefreshKind[] = [];
		if (/\bbd\s+(close|update|create|claim|reopen)\b/.test(command)) kinds.push("compact");
		if (/\bgit\s+/.test(command)) {
			runtimeState.lastFetch = 0;
			kinds.push("runtime");
		}
		if (kinds.length) scheduleRefresh(kinds, TOOL_RESULT_REFRESH_DELAY_MS);
		return undefined;
	});
	pi.on("session_shutdown", async () => {
		for (const timer of [footerReapplyTimer, scheduledRefreshTimer, descendantRefreshTimer]) if (timer) clearTimeout(timer);
		if (cacheSyncTimer) clearInterval(cacheSyncTimer);
		footerReapplyTimer = scheduledRefreshTimer = descendantRefreshTimer = null;
		cacheSyncTimer = null;
		scheduledRefreshKinds.clear();
		branchChangeUnsub?.();
		branchChangeUnsub = null;
		requestRender = null;
	});
}
