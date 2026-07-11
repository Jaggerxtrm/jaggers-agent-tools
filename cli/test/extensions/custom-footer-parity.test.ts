import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@earendil-works/pi-coding-agent", () => ({
	isToolCallEventType: vi.fn(() => false),
	isBashToolResult: vi.fn(() => false),
}));
vi.mock("@earendil-works/pi-tui", () => ({
	truncateToWidth: vi.fn((s: string) => s),
	visibleWidth: vi.fn((s: string) => s.length),
}));

import customFooterExtension from "../../../packages/pi-extensions/extensions/custom-footer/index";
import { EventAdapter, SubprocessRunner } from "../../../packages/pi-extensions/src/core";

vi.mock("../../../packages/pi-extensions/src/core", async () => {
	const actual = await vi.importActual<any>("../../../packages/pi-extensions/src/core");
	return {
		...actual,
		SubprocessRunner: { run: vi.fn() },
		EventAdapter: { isBeadsProject: vi.fn(() => true) },
	};
});

describe("custom-footer parity", () => {
	let handlers: Record<string, Function[]>;
	let footerRenderer: any;
	let ctx: any;
	let setFooterSpy: any;
	let requestRenderSpy: any;
	let branchChangeHandler: (() => void) | null;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.resetAllMocks();
		handlers = {};
		footerRenderer = null;
		requestRenderSpy = vi.fn();
		branchChangeHandler = null;

		setFooterSpy = vi.fn((factory: any) => {
			footerRenderer = factory(
				{ requestRender: requestRenderSpy },
				{ fg: (_c: string, text: string) => text },
				{
					getGitBranch: () => "xt/demo",
					onBranchChange: (handler: () => void) => {
						branchChangeHandler = handler;
						return () => {
							if (branchChangeHandler === handler) branchChangeHandler = null;
						};
					},
					getAvailableProviderCount: () => 1,
				},
			);
		});

		ctx = {
			cwd: "/repo/.xtrm/worktrees/demo",
			sessionManager: { getSessionId: () => "session-1" },
			model: { id: "gpt-5" },
			getContextUsage: () => ({ percent: 37 }),
			hasUI: true,
			ui: { setFooter: setFooterSpy },
		};
	});

	const createPi = () => ({
		on: (event: string, fn: Function) => {
			if (!handlers[event]) handlers[event] = [];
			handlers[event].push(fn);
		},
	});

	it("render does not invoke SubprocessRunner", async () => {
		(SubprocessRunner.run as any).mockResolvedValue({ code: 1, stdout: "", stderr: "" });

		customFooterExtension(createPi() as any);
		await handlers.session_start[0]({}, ctx);
		await vi.runOnlyPendingTimersAsync();
		await Promise.resolve();
		vi.clearAllMocks();

		footerRenderer.render(120);
		await vi.advanceTimersByTimeAsync(6000);
		footerRenderer.render(120);

		expect(SubprocessRunner.run).not.toHaveBeenCalled();
	});

	it("renders three lines with claim title parity", async () => {
		(EventAdapter.isBeadsProject as any).mockReturnValue(true);
		(SubprocessRunner.run as any).mockImplementation(async (cmd: string, args: string[]) => {
			if (cmd === "git" && args[0] === "rev-parse") return { code: 0, stdout: "/repo\n", stderr: "" };
			if (cmd === "git" && args[0] === "branch") return { code: 0, stdout: "xt/demo\n", stderr: "" };
			if (cmd === "git" && args.includes("status")) return { code: 0, stdout: " M file.ts\nA  new.ts\n", stderr: "" };
			if (cmd === "git" && args.includes("rev-list")) return { code: 0, stdout: "0 1\n", stderr: "" };
			if (cmd === "bd" && args[0] === "list" && args[1] === "--status=in_progress") return { code: 0, stdout: "◐ xtrm-123 in progress\n", stderr: "" };
			if (cmd === "bd" && args[0] === "show") {
				return { code: 0, stdout: JSON.stringify([{ status: "in_progress", title: "Fix footer parity" }]), stderr: "" };
			}
			if (cmd === "bd" && args[0] === "list") return { code: 0, stdout: "(4 open, 1 in progress)", stderr: "" };
			return { code: 1, stdout: "", stderr: "" };
		});

		customFooterExtension(createPi() as any);
		await handlers.session_start[0]({}, ctx);
		await vi.runOnlyPendingTimersAsync();
		await Promise.resolve();

		const lines = footerRenderer.render(120);
		expect(lines).toHaveLength(3);
		expect(lines[0]).toContain("xt/demo");
		expect(lines[1]).toContain("gpt-5");
		expect(lines[2]).toContain("◐ 123");
		expect(lines[2]).toContain("Fix footer parity");
	});

	it("falls back to open issue count when no claim", async () => {
		(EventAdapter.isBeadsProject as any).mockReturnValue(true);
		(SubprocessRunner.run as any).mockImplementation(async (cmd: string, args: string[]) => {
			if (cmd === "git" && args[0] === "rev-parse") return { code: 0, stdout: "/repo\n", stderr: "" };
			if (cmd === "git" && args[0] === "branch") return { code: 0, stdout: "xt/demo\n", stderr: "" };
			if (cmd === "git" && args.includes("status")) return { code: 0, stdout: "", stderr: "" };
			if (cmd === "git" && args.includes("rev-list")) return { code: 0, stdout: "0 0\n", stderr: "" };
			if (cmd === "bd" && args[0] === "list" && args[1] === "--status=in_progress") return { code: 0, stdout: "", stderr: "" };
			if (cmd === "bd" && args[0] === "list") return { code: 0, stdout: "(5 open, 0 in progress)", stderr: "" };
			return { code: 1, stdout: "", stderr: "" };
		});

		customFooterExtension(createPi() as any);
		await handlers.session_start[0]({}, ctx);
		await vi.runOnlyPendingTimersAsync();
		await Promise.resolve();

		const lines = footerRenderer.render(100);
		expect(lines[2]).toContain("○ 5 open");
	});

	it("coalesces lifecycle refresh triggers and redraws on state update", async () => {
		(EventAdapter.isBeadsProject as any).mockReturnValue(true);
		let resolveRefresh: (() => void) | null = null;
		const refreshGate = new Promise<void>((resolve) => {
			resolveRefresh = resolve;
		});
		(SubprocessRunner.run as any).mockImplementation(async (cmd: string, args: string[]) => {
			await refreshGate;
			if (cmd === "git" && args[0] === "rev-parse") return { code: 0, stdout: "/repo\n", stderr: "" };
			if (cmd === "git" && args[0] === "branch") return { code: 0, stdout: "xt/demo\n", stderr: "" };
			if (cmd === "git" && args.includes("status")) return { code: 0, stdout: "", stderr: "" };
			if (cmd === "git" && args.includes("rev-list")) return { code: 0, stdout: "0 0\n", stderr: "" };
			if (cmd === "bd" && args[0] === "list" && args[1] === "--status=in_progress") return { code: 0, stdout: "", stderr: "" };
			if (cmd === "bd" && args[0] === "list") return { code: 0, stdout: "(5 open, 0 in progress)", stderr: "" };
			return { code: 1, stdout: "", stderr: "" };
		});

		customFooterExtension(createPi() as any);
		await handlers.session_start[0]({}, ctx);
		await vi.advanceTimersByTimeAsync(1);
		expect(SubprocessRunner.run).toHaveBeenCalledTimes(2);

		await handlers.tool_result[0]({ input: { command: "git status" } });
		await handlers.tool_result[0]({ input: { command: "git commit -m test" } });
		branchChangeHandler?.();
		await vi.advanceTimersByTimeAsync(250);
		expect(SubprocessRunner.run).toHaveBeenCalledTimes(2);

		resolveRefresh?.();
		await Promise.resolve();
		await Promise.resolve();
		await vi.runOnlyPendingTimersAsync();
		expect(SubprocessRunner.run).toHaveBeenCalledTimes(6);
		expect(requestRenderSpy).toHaveBeenCalled();
	});

	it("schedules beads refresh from relevant tool results", async () => {
		(EventAdapter.isBeadsProject as any).mockReturnValue(true);
		(SubprocessRunner.run as any).mockImplementation(async (cmd: string, args: string[]) => {
			if (cmd === "git" && args[0] === "rev-parse") return { code: 0, stdout: "/repo\n", stderr: "" };
			if (cmd === "git" && args[0] === "branch") return { code: 0, stdout: "xt/demo\n", stderr: "" };
			if (cmd === "git" && args.includes("status")) return { code: 0, stdout: "", stderr: "" };
			if (cmd === "git" && args.includes("rev-list")) return { code: 0, stdout: "0 0\n", stderr: "" };
			if (cmd === "bd" && args[0] === "list" && args[1] === "--status=in_progress") return { code: 0, stdout: "", stderr: "" };
			if (cmd === "bd" && args[0] === "list") return { code: 0, stdout: "(5 open, 0 in progress)", stderr: "" };
			return { code: 1, stdout: "", stderr: "" };
		});

		customFooterExtension(createPi() as any);
		await handlers.session_start[0]({}, ctx);
		await vi.runOnlyPendingTimersAsync();
		await Promise.resolve();
		const settledCalls = (SubprocessRunner.run as any).mock.calls.length;

		await handlers.tool_result[0]({ input: { command: "bd update xtrm-123" } });
		await vi.advanceTimersByTimeAsync(250);
		await Promise.resolve();

		expect(SubprocessRunner.run).toHaveBeenCalledTimes(settledCalls + 2);
		expect(requestRenderSpy).toHaveBeenCalled();
	});

	it("cleans pending footer timers on session shutdown", async () => {
		(SubprocessRunner.run as any).mockResolvedValue({ code: 1, stdout: "", stderr: "" });

		customFooterExtension(createPi() as any);
		await handlers.session_start[0]({}, ctx);
		await handlers.session_shutdown[0]();
		await vi.advanceTimersByTimeAsync(500);

		expect(SubprocessRunner.run).not.toHaveBeenCalled();
		expect(setFooterSpy).toHaveBeenCalledTimes(1);
	});

	it("reapplies footer on model/session refresh events", async () => {
		(SubprocessRunner.run as any).mockResolvedValue({ code: 1, stdout: "", stderr: "" });

		customFooterExtension(createPi() as any);
		await handlers.session_start[0]({}, ctx);
		await vi.advanceTimersByTimeAsync(45);
		const initialCalls = setFooterSpy.mock.calls.length;

		await handlers.model_select[0]({}, ctx);
		await vi.advanceTimersByTimeAsync(45);
		await handlers.session_switch[0]({}, ctx);
		await vi.advanceTimersByTimeAsync(45);

		expect(setFooterSpy.mock.calls.length).toBeGreaterThan(initialCalls);
	});

	it("keeps latest branch listener and redraw after footer reapply race", async () => {
		let activeBranchChangeHandler: (() => void) | null = null;
		let previousRenderer: any = null;
		const racySetFooterSpy = vi.fn((factory: any) => {
			const renderer = factory(
				{ requestRender: requestRenderSpy },
				{ fg: (_c: string, text: string) => text },
				{
					getGitBranch: () => "xt/demo",
					onBranchChange: (handler: () => void) => {
						activeBranchChangeHandler = handler;
						return () => {
							if (activeBranchChangeHandler === handler) activeBranchChangeHandler = null;
						};
					},
					getAvailableProviderCount: () => 1,
				},
			);
			const staleRenderer = previousRenderer;
			previousRenderer = renderer;
			footerRenderer = renderer;
			staleRenderer?.dispose();
		});
		ctx.ui.setFooter = racySetFooterSpy;
		(SubprocessRunner.run as any).mockImplementation(async (cmd: string, args: string[]) => {
			if (cmd === "git" && args[0] === "rev-parse") return { code: 0, stdout: "/repo\n", stderr: "" };
			if (cmd === "git" && args[0] === "branch") return { code: 0, stdout: "xt/demo\n", stderr: "" };
			if (cmd === "git" && args.includes("status")) return { code: 0, stdout: "", stderr: "" };
			if (cmd === "git" && args.includes("rev-list")) return { code: 0, stdout: "0 0\n", stderr: "" };
			return { code: 1, stdout: "", stderr: "" };
		});

		customFooterExtension(createPi() as any);
		await handlers.session_start[0]({}, ctx);
		await vi.runOnlyPendingTimersAsync();
		await Promise.resolve();
		expect(racySetFooterSpy).toHaveBeenCalledTimes(2);
		vi.clearAllMocks();

		expect(activeBranchChangeHandler).not.toBeNull();
		activeBranchChangeHandler?.();
		await vi.runOnlyPendingTimersAsync();
		await Promise.resolve();
		await Promise.resolve();

		expect(SubprocessRunner.run).toHaveBeenCalledTimes(4);
		expect(requestRenderSpy).toHaveBeenCalled();
	});
});
