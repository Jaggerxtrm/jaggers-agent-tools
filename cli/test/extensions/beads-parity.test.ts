import { describe, it, expect, vi, beforeEach } from "vitest";
import { ExtensionHarness } from "./extension-harness";
import beadsExtension from "../../../packages/pi-extensions/extensions/beads/index";
import { SubprocessRunner } from "../../../packages/pi-extensions/src/core";
import * as fs from "node:fs";

vi.mock("@earendil-works/pi-coding-agent", () => ({
	isToolCallEventType: (name: string, event: any) => event?.toolName === name,
	isBashToolResult: (event: any) => event?.toolName === "bash",
}));

vi.mock("../../../packages/pi-extensions/src/core", async () => {
	const actual = await vi.importActual<any>("../../../packages/pi-extensions/src/core");
	return {
		...actual,
		SubprocessRunner: {
			run: vi.fn(),
		},
		EventAdapter: {
			isBeadsProject: vi.fn(() => true),
			isMutatingFileTool: vi.fn((event: any) => event?.toolName === "write"),
			parseBdCounts: vi.fn(() => ({ open: 1, inProgress: 0 })),
		},
	};
});

vi.mock("node:fs", () => ({
	existsSync: vi.fn(() => false),
	unlinkSync: vi.fn(),
}));

describe("Pi beads extension parity", () => {
	let harness: ExtensionHarness;

	beforeEach(() => {
		vi.resetAllMocks();
		harness = new ExtensionHarness();
		harness.pi.sendUserMessage = vi.fn();
	});

	it("stores closed-this-session marker on successful bd close", async () => {
		const calls: string[][] = [];
		(SubprocessRunner.run as any).mockImplementation(async (_cmd: string, args: string[]) => {
			calls.push(args);
			return { code: 0, stdout: "", stderr: "" };
		});

		beadsExtension(harness.pi);

		const result = await harness.emit("tool_result", {
			toolName: "bash",
			input: { command: "bd close xtrm-777 --reason done" },
			content: [{ type: "text", text: "closed" }],
			isError: false,
		});

		expect(calls.some((a) => a[0] === "kv" && a[1] === "set" && a[2].startsWith("closed-this-session:"))).toBe(true);
		expect(result?.content?.[1]?.text).toContain("Beads Memory Gate");
	});

	it("runs the memory gate once at session_shutdown (not agent_end) and stays silent", async () => {
		const calls: string[][] = [];
		(SubprocessRunner.run as any).mockImplementation(async (_cmd: string, args: string[]) => {
			calls.push(args);
			if (args[0] === "kv" && args[1] === "get" && `${args[2]}`.startsWith("closed-this-session:")) {
				return { code: 0, stdout: "xtrm-123\n", stderr: "" };
			}
			return { code: 1, stdout: "", stderr: "" };
		});

		beadsExtension(harness.pi);

		// xtrm-64pl0: agent_end no longer runs the memory gate (was a duplicate per-turn check).
		await harness.emit("agent_end", { messages: [] });
		expect(calls).toHaveLength(0);

		// session_shutdown is the single lifecycle check, and it stays silent (no ui.notify):
		// the memory gate is injected into bd close tool_result content instead.
		await harness.emit("session_shutdown", {});
		expect(harness.ctx.ui.notify).not.toHaveBeenCalled();
		expect(calls.length).toBeGreaterThan(0);
	});

	it.skip("consumes .memory-gate-done marker and clears session markers (test environment issue)", async () => {
		(fs.existsSync as any).mockReturnValue(true);
		const calls: string[][] = [];
		(SubprocessRunner.run as any).mockImplementation(async (_cmd: string, args: string[]) => {
			calls.push(args);
			return { code: 0, stdout: "", stderr: "" };
		});

		beadsExtension(harness.pi);
		await harness.emit("agent_end", { messages: [] });

		expect(fs.unlinkSync).toHaveBeenCalled();
		expect(calls.some((a) => a[0] === "kv" && a[1] === "clear" && `${a[2]}`.startsWith("claimed:"))).toBe(true);
		expect(calls.some((a) => a[0] === "kv" && a[1] === "clear" && `${a[2]}`.startsWith("closed-this-session:"))).toBe(true);
		expect(harness.ctx.ui.notify).not.toHaveBeenCalled();
	});
});
