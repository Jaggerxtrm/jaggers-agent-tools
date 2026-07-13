import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@earendil-works/pi-coding-agent", () => ({
	isToolCallEventType: vi.fn(() => false),
	isBashToolResult: vi.fn(() => false),
}));
vi.mock("@earendil-works/pi-tui", () => ({
	truncateToWidth: vi.fn((s: string) => s),
	visibleWidth: vi.fn((s: string) => s.replace(/\x1b\[[0-9;]*m/g, "").length),
}));

import customFooterExtension from "../../../packages/pi-extensions/extensions/custom-footer/index";
import { SubprocessRunner } from "../../../packages/pi-extensions/src/core";
import * as beadsCache from "../../../.xtrm/hooks/beads-status-cache.mjs";

vi.mock("../../../packages/pi-extensions/src/core", async () => {
	const actual = await vi.importActual<any>("../../../packages/pi-extensions/src/core");
	return { ...actual, SubprocessRunner: { run: vi.fn() } };
});

const repoRoot = join(import.meta.dirname, "../../..");

describe("custom-footer shared beads cache", () => {
	let handlers: Record<string, Function[]>;
	let footerRenderer: any;
	let ctx: any;
	let toolsExpanded: boolean;
	let commands: Record<string, any>;
	let shortcuts: Record<string, any>;
	let requestRenderSpy: ReturnType<typeof vi.fn>;
	let cacheRoot: string;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.resetAllMocks();
		handlers = {};
		footerRenderer = null;
		toolsExpanded = false;
		commands = {};
		shortcuts = {};
		requestRenderSpy = vi.fn();
		cacheRoot = mkdtempSync(join(tmpdir(), "xtrm-footer-cache-"));
		process.env.XTRM_BEADS_CACHE_ROOT = cacheRoot;
		ctx = {
			cwd: repoRoot,
			model: { id: "gpt-5", contextWindow: 200_000 },
			getContextUsage: () => ({ percent: 37, contextWindow: 200_000 }),
			hasUI: true,
			mode: "tui",
			ui: {
				getToolsExpanded: () => toolsExpanded,
				setFooter: vi.fn((factory: any) => {
					footerRenderer = factory(
						{ requestRender: requestRenderSpy },
						{ fg: (_color: string, text: string) => text },
						{
							getGitBranch: () => "feature/footer",
							onBranchChange: () => () => {},
							getAvailableProviderCount: () => 1,
						},
					);
				}),
			},
		};
		(SubprocessRunner.run as any).mockImplementation(async (command: string, args: string[]) => {
			if (command === "git" && args[0] === "rev-parse" && args[1] === "--show-toplevel") {
				return { code: 0, stdout: `${repoRoot}\n`, stderr: "" };
			}
			return { code: 1, stdout: "", stderr: "" };
		});
	});

	afterEach(() => {
		delete process.env.XTRM_BEADS_CACHE_ROOT;
		rmSync(cacheRoot, { recursive: true, force: true });
		vi.useRealTimers();
	});

	const createPi = () => ({
		on: (event: string, fn: Function) => {
			if (!handlers[event]) handlers[event] = [];
			handlers[event].push(fn);
		},
		getThinkingLevel: () => "off",
		registerCommand: (name: string, options: any) => { commands[name] = options; },
		registerShortcut: (key: string, options: any) => { shortcuts[key] = options; },
	});

	async function start() {
		customFooterExtension(createPi() as any);
		await handlers.session_start[0]({}, ctx);
		await vi.runOnlyPendingTimersAsync();
	}

	it("cleans cache synchronization and refresh timers on shutdown", async () => {
		beadsCache.writeCache(cacheRoot, {
			counts: { open: 1, in_progress: 0, blocked: 0 }, activeIssues: [], activeEpic: null,
		});
		await start();
		expect(vi.getTimerCount()).toBeGreaterThan(0);
		await handlers.session_shutdown[0]();
		expect(vi.getTimerCount()).toBe(0);
	});

	it("renders the same compact formatter output as Claude from a fixture cache", async () => {
		beadsCache.writeCache(cacheRoot, {
			counts: { open: 12, in_progress: 2, blocked: 0 },
			activeIssues: [],
			activeEpic: { id: "xtrm-k2ufi", title: "Role parity", closed: 1, total: 3 },
		});
		await start();
		const lines = footerRenderer.render(120);
		expect(lines).toHaveLength(3);
		expect(lines[2].replace(/\x1b\[[0-9;]*m/g, "")).toContain("12 open · 2 in progress · epic k2ufi (1/3 done)");
	});

	it("render performs no subprocess work", async () => {
		beadsCache.writeCache(cacheRoot, {
			counts: { open: 5, in_progress: 0, blocked: 0 }, activeIssues: [], activeEpic: null,
		});
		await start();
		vi.clearAllMocks();
		footerRenderer.render(100);
		footerRenderer.render(100);
		expect(SubprocessRunner.run).not.toHaveBeenCalled();
	});

	it("expands cached in-progress issues without an epic on Alt+G", async () => {
		beadsCache.writeCache(cacheRoot, {
			counts: { open: 2, in_progress: 3, blocked: 0 },
			activeIssues: [
				{ id: "xtrm-one", title: "First claim", status: "in_progress" },
				{ id: "xtrm-two", title: "Second claim", status: "in_progress" },
				{ id: "xtrm-three", title: "Third claim", status: "in_progress" },
			],
			activeEpic: null,
		});
		await start();
		expect(shortcuts["ctrl+b"]).toBeUndefined();
		expect(shortcuts["alt+b"]).toBeUndefined();
		expect(shortcuts["alt+g"]).toBeDefined();
		await shortcuts["alt+g"].handler(ctx);
		const text = footerRenderer.render(120).join("\n");
		expect(text).toContain("in progress (3)");
		expect(text).toContain("◐ one  First claim");
		expect(text).toContain("◐ two  Second claim");
		expect(text).toContain("◐ three  Third claim");
	});

	it("keeps Ctrl+O tool expansion independent from the beads tree", async () => {
		beadsCache.writeCache(cacheRoot, {
			counts: { open: 2, in_progress: 1, blocked: 0 },
			activeIssues: [],
			activeEpic: { id: "xtrm-epic", title: "Compact footer", closed: 1, total: 3 },
			descendants: {
				epicId: "xtrm-epic", ts: Date.now(), overflow: 0,
				items: [
					{ id: "xtrm-epic.1", parent: "xtrm-epic", title: "First child", status: "in_progress" },
					{ id: "xtrm-epic.1.1", parent: "xtrm-epic.1", title: "Nested child", status: "open" },
					{ id: "xtrm-epic.1.1.1", parent: "xtrm-epic.1.1", title: "Closed leaf", status: "closed" },
				],
			},
		});
		toolsExpanded = true;
		await start();
		expect(footerRenderer.render(120).join("\n")).not.toContain("First child");
		await commands.beads.handler("", ctx);
		const text = footerRenderer.render(120).join("\n");
		expect(text).toContain("epic epic (1/3 done) — Compact footer");
		expect(text).toContain("  ◐ .1  in progress  First child");
		expect(text).toContain("    ○ .1.1  open  Nested child");
		expect(text).toContain("      ✓ .1.1.1  closed  Closed leaf");
	});

	it("caps expanded trees at 50 rows and reports overflow", async () => {
		const items = Array.from({ length: 52 }, (_, index) => ({
			id: `xtrm-epic.${index + 1}`,
			parent: "xtrm-epic",
			title: `Child ${index + 1}`,
			status: "open",
		}));
		beadsCache.writeCache(cacheRoot, {
			counts: { open: 52, in_progress: 1, blocked: 0 }, activeIssues: [],
			activeEpic: { id: "xtrm-epic", title: "Large epic", closed: 0, total: 52 },
			descendants: { epicId: "xtrm-epic", ts: Date.now(), items: items.slice(0, 50), overflow: 2 },
		});
		await start();
		await commands.beads.handler("", ctx);
		expect(footerRenderer.render(120).join("\n")).toContain("+2 more (bd show xtrm-epic)");
	});

	it("shows a loading skeleton, fetches descendants once, then repaints", async () => {
		beadsCache.writeCache(cacheRoot, {
			counts: { open: 2, in_progress: 1, blocked: 0 }, activeIssues: [],
			activeEpic: { id: "xtrm-epic", title: "Compact footer", closed: 0, total: 1 },
		});
		(SubprocessRunner.run as any).mockImplementation(async (command: string, args: string[]) => {
			if (command === "bd" && args[0] === "query") {
				return { code: 0, stdout: JSON.stringify([
					{ id: "xtrm-epic.1", parent: "xtrm-epic", title: "Fetched child", status: "open" },
				]), stderr: "" };
			}
			return { code: 1, stdout: "", stderr: "" };
		});
		await start();
		await commands.beads.handler("", ctx);
		expect(footerRenderer.render(120).join("\n")).toContain("loading epic tree…");
		await vi.runOnlyPendingTimersAsync();
		await Promise.resolve();
		expect((SubprocessRunner.run as any).mock.calls.filter((call: any[]) => call[0] === "bd")).toHaveLength(1);
		expect(footerRenderer.render(120).join("\n")).toContain("Fetched child");
		expect(requestRenderSpy).toHaveBeenCalled();
	});

	it("renders a non-epic parent-child group with closed siblings", async () => {
		beadsCache.writeCache(cacheRoot, {
			counts: { open: 1, in_progress: 1, blocked: 0 },
			activeIssues: [{ id: "xtrm-parent.2", parent: "xtrm-parent", title: "Active child", status: "in_progress" }],
			activeEpic: null,
		});
		(SubprocessRunner.run as any).mockImplementation(async (command: string, args: string[]) => {
			if (command !== "bd") return { code: 1, stdout: "", stderr: "" };
			if (args[0] === "show" && args[1] === "xtrm-parent") {
				return { code: 0, stdout: JSON.stringify([{ id: "xtrm-parent", title: "Ordinary parent", status: "closed" }]), stderr: "" };
			}
			if (args[0] === "children" && args[1] === "xtrm-parent") {
				return { code: 0, stdout: JSON.stringify([
					{ id: "xtrm-parent.1", parent: "xtrm-parent", title: "Closed sibling", status: "closed" },
					{ id: "xtrm-parent.2", parent: "xtrm-parent", title: "Active child", status: "in_progress" },
				]), stderr: "" };
			}
			return { code: 1, stdout: "", stderr: "" };
		});
		await start();
		await commands.beads.handler("", ctx);
		expect(footerRenderer.render(120).join("\n")).toContain("loading parent-child group…");
		await vi.runOnlyPendingTimersAsync();
		await Promise.resolve();
		const text = footerRenderer.render(120).join("\n");
		expect(text).toContain("parent parent (1/2 done) — Ordinary parent");
		expect(text).toContain("✓ .1  closed  Closed sibling");
		expect(text).toContain("◐ .2  in progress  Active child");
	});

	it("falls back to the active issue's structural parent when the cache predates parent ids", async () => {
		beadsCache.writeCache(cacheRoot, {
			counts: { open: 1, in_progress: 1, blocked: 0 },
			activeIssues: [{ id: "xtrm-parent.2", title: "Active child", status: "in_progress" }],
			activeEpic: null,
		});
		(SubprocessRunner.run as any).mockImplementation(async (command: string, args: string[]) => {
			if (command !== "bd") return { code: 1, stdout: "", stderr: "" };
			if (args[0] === "show" && args[1] === "xtrm-parent.2") {
				return { code: 0, stdout: JSON.stringify([{ id: "xtrm-parent.2", parent: "xtrm-parent" }]), stderr: "" };
			}
			if (args[0] === "show" && args[1] === "xtrm-parent") {
				return { code: 0, stdout: JSON.stringify([{ id: "xtrm-parent", title: "Ordinary parent", status: "open" }]), stderr: "" };
			}
			if (args[0] === "children" && args[1] === "xtrm-parent") {
				return { code: 0, stdout: JSON.stringify([{ id: "xtrm-parent.2", title: "Active child", status: "in_progress" }]), stderr: "" };
			}
			return { code: 1, stdout: "", stderr: "" };
		});
		await start();
		await commands.beads.handler("", ctx);
		await vi.runOnlyPendingTimersAsync();
		await Promise.resolve();
		expect(footerRenderer.render(120).join("\n")).toContain("parent parent (0/1 done) — Ordinary parent");
		expect((SubprocessRunner.run as any).mock.calls.filter((call: any[]) => call[0] === "bd")).toHaveLength(3);
	});

	it("loads only the first active parent-child group", async () => {
		beadsCache.writeCache(cacheRoot, {
			counts: { open: 2, in_progress: 2, blocked: 0 },
			activeIssues: [
				{ id: "xtrm-first.1", parent: "xtrm-first", title: "First child", status: "in_progress" },
				{ id: "xtrm-second.1", parent: "xtrm-second", title: "Second child", status: "in_progress" },
			],
			activeEpic: null,
		});
		(SubprocessRunner.run as any).mockImplementation(async (command: string, args: string[]) => {
			if (command !== "bd" || args[1] !== "xtrm-first") return { code: 1, stdout: "", stderr: "" };
			if (args[0] === "show") return { code: 0, stdout: JSON.stringify([{ id: "xtrm-first", title: "First parent", status: "open" }]), stderr: "" };
			return { code: 0, stdout: JSON.stringify([{ id: "xtrm-first.1", title: "First child", status: "in_progress" }]), stderr: "" };
		});
		await start();
		await commands.beads.handler("", ctx);
		await vi.runOnlyPendingTimersAsync();
		await Promise.resolve();
		const text = footerRenderer.render(120).join("\n");
		expect(text).toContain("First parent");
		expect(text).not.toContain("Second child");
		expect((SubprocessRunner.run as any).mock.calls.filter((call: any[]) => call[0] === "bd")).toHaveLength(2);
	});

	it("does not create a group from non-parent dependency metadata", async () => {
		beadsCache.writeCache(cacheRoot, {
			counts: { open: 1, in_progress: 1, blocked: 0 },
			activeIssues: [{
				id: "xtrm-standalone",
				title: "Standalone",
				status: "in_progress",
				dependencies: [{ id: "xtrm-origin", dependency_type: "discovered-from" }],
			}],
			activeEpic: null,
		});
		(SubprocessRunner.run as any).mockImplementation(async (command: string, args: string[]) => {
			if (command === "bd" && args[0] === "show" && args[1] === "xtrm-standalone") {
				return { code: 0, stdout: JSON.stringify([{ id: "xtrm-standalone", dependencies: [{ id: "xtrm-origin", dependency_type: "discovered-from" }] }]), stderr: "" };
			}
			return { code: 1, stdout: "", stderr: "" };
		});
		await start();
		await commands.beads.handler("", ctx);
		await vi.runOnlyPendingTimersAsync();
		expect(footerRenderer.render(120).join("\n")).not.toContain("parent ");
		const bdCalls = (SubprocessRunner.run as any).mock.calls.filter((call: any[]) => call[0] === "bd");
		expect(bdCalls).toHaveLength(1);
		expect(bdCalls[0][1]).toEqual(["show", "xtrm-standalone", "--json"]);
	});
});
