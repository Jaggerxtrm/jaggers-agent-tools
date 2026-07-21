import { describe, it, expect, vi, beforeEach } from "vitest";
import { ExtensionHarness } from "./extension-harness";
import beadsExtension from "../../../packages/pi-extensions/extensions/beads/index";
import { SubprocessRunner } from "../../../packages/pi-extensions/src/core";

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
			parseBdCounts: vi.fn(() => ({ open: 2, inProgress: 0 })),
		},
	};
});

describe("Pi beads claim lifecycle", () => {
	let harness: ExtensionHarness;

	beforeEach(() => {
		vi.resetAllMocks();
		harness = new ExtensionHarness();
		harness.pi.sendUserMessage = vi.fn();
	});

	it("clears stale claim and blocks edits until a fresh claim is made", async () => {
		const calls: string[][] = [];
		(SubprocessRunner.run as any).mockImplementation(async (_cmd: string, args: string[]) => {
			calls.push(args);
			if (args[0] === "kv" && args[1] === "get") return { code: 0, stdout: "xtrm-old\n", stderr: "" };
			if (args[0] === "show") return { code: 0, stdout: JSON.stringify({ id: "xtrm-old", status: "closed" }), stderr: "" };
			if (args[0] === "list") return { code: 0, stdout: "Total: 2 issues (2 open, 0 in progress)", stderr: "" };
			if (args[0] === "kv" && args[1] === "clear") return { code: 0, stdout: "", stderr: "" };
			return { code: 0, stdout: "", stderr: "" };
		});

		beadsExtension(harness.pi);

		const result = await harness.emit("tool_call", {
			toolName: "write",
			input: { path: "src/main.ts" },
		});

		expect(calls.some((a) => a[0] === "kv" && a[1] === "clear" && `${a[2]}`.startsWith("claimed:"))).toBe(true);
		expect(result?.block).toBe(true);
		expect(result?.reason).toContain("No active claim");
	});

	it("does not block commit when claim is stale/closed", async () => {
		(SubprocessRunner.run as any).mockImplementation(async (_cmd: string, args: string[]) => {
			if (args[0] === "kv" && args[1] === "get") return { code: 0, stdout: "xtrm-old\n", stderr: "" };
			if (args[0] === "show") return { code: 0, stdout: JSON.stringify({ id: "xtrm-old", status: "closed" }), stderr: "" };
			if (args[0] === "kv" && args[1] === "clear") return { code: 0, stdout: "", stderr: "" };
			return { code: 0, stdout: "", stderr: "" };
		});

		beadsExtension(harness.pi);

		const result = await harness.emit("tool_call", {
			toolName: "bash",
			input: { command: "git commit -m 'test'" },
		});

		expect(result).toBeUndefined();
	});

	it("blocks commit when active claimed issue is still in progress", async () => {
		(SubprocessRunner.run as any).mockImplementation(async (_cmd: string, args: string[]) => {
			if (args[0] === "kv" && args[1] === "get") return { code: 0, stdout: "xtrm-live\n", stderr: "" };
			if (args[0] === "show") return { code: 0, stdout: JSON.stringify({ id: "xtrm-live", status: "in_progress" }), stderr: "" };
			return { code: 0, stdout: "", stderr: "" };
		});

		beadsExtension(harness.pi);

		const result = await harness.emit("tool_call", {
			toolName: "bash",
			input: { command: "git commit -m 'test'" },
		});

		expect(result?.block).toBe(true);
		expect(result?.reason).toContain("Active claim [xtrm-live]");
	});

	// --- xtrm-64pl0: run-scoped claim cache + bd-list removal -----------------------

	it("caches the active claim across edit checks within a run (no repeated bd subprocess)", async () => {
		const calls: string[][] = [];
		(SubprocessRunner.run as any).mockImplementation(async (_cmd: string, args: string[]) => {
			calls.push(args);
			if (args[0] === "kv" && args[1] === "get") return { code: 0, stdout: "xtrm-live\n", stderr: "" };
			if (args[0] === "show") return { code: 0, stdout: JSON.stringify({ id: "xtrm-live", status: "in_progress" }), stderr: "" };
			return { code: 0, stdout: "", stderr: "" };
		});

		beadsExtension(harness.pi);

		await harness.emit("tool_call", { toolName: "write", input: { path: "a.ts" } });
		await harness.emit("tool_call", { toolName: "write", input: { path: "b.ts" } });
		await harness.emit("tool_call", { toolName: "write", input: { path: "c.ts" } });

		const claimGets = calls.filter((a) => a[0] === "kv" && a[1] === "get" && `${a[2]}`.startsWith("claimed:"));
		expect(claimGets).toHaveLength(1); // resolved once, reused for the rest of the run
	});

	it("keeps the claim cached past the old 3s TTL (run-scoped, not time-based)", async () => {
		vi.useFakeTimers();
		try {
			const calls: string[][] = [];
			(SubprocessRunner.run as any).mockImplementation(async (_cmd: string, args: string[]) => {
				calls.push(args);
				if (args[0] === "kv" && args[1] === "get") return { code: 0, stdout: "xtrm-live\n", stderr: "" };
				if (args[0] === "show") return { code: 0, stdout: JSON.stringify({ id: "xtrm-live", status: "in_progress" }), stderr: "" };
				return { code: 0, stdout: "", stderr: "" };
			});

			beadsExtension(harness.pi);

			await harness.emit("tool_call", { toolName: "write", input: { path: "a.ts" } });
			await vi.advanceTimersByTimeAsync(10_000); // well past the removed 3s TTL
			await harness.emit("tool_call", { toolName: "write", input: { path: "b.ts" } });

			const claimGets = calls.filter((a) => a[0] === "kv" && a[1] === "get" && `${a[2]}`.startsWith("claimed:"));
			expect(claimGets).toHaveLength(1); // no time-based re-fetch
		} finally {
			vi.useRealTimers();
		}
	});

	it("invalidates the claim cache when a bd close mutation is observed", async () => {
		const calls: string[][] = [];
		(SubprocessRunner.run as any).mockImplementation(async (_cmd: string, args: string[]) => {
			calls.push(args);
			if (args[0] === "kv" && args[1] === "get") return { code: 0, stdout: "xtrm-live\n", stderr: "" };
			if (args[0] === "show") return { code: 0, stdout: JSON.stringify({ id: "xtrm-live", status: "in_progress" }), stderr: "" };
			return { code: 0, stdout: "", stderr: "" };
		});

		beadsExtension(harness.pi);

		await harness.emit("tool_call", { toolName: "write", input: { path: "a.ts" } });
		await harness.emit("tool_result", {
			toolName: "bash",
			input: { command: "bd close xtrm-live --reason done" },
			content: [{ type: "text", text: "closed" }],
			isError: false,
		});
		await harness.emit("tool_call", { toolName: "write", input: { path: "b.ts" } });

		const claimGets = calls.filter((a) => a[0] === "kv" && a[1] === "get" && `${a[2]}`.startsWith("claimed:"));
		expect(claimGets).toHaveLength(2); // close invalidated the cache -> re-resolved
	});

	it("invalidates the claim cache when a claimed: KV mutation is observed", async () => {
		const calls: string[][] = [];
		(SubprocessRunner.run as any).mockImplementation(async (_cmd: string, args: string[]) => {
			calls.push(args);
			if (args[0] === "kv" && args[1] === "get") return { code: 0, stdout: "xtrm-live\n", stderr: "" };
			if (args[0] === "show") return { code: 0, stdout: JSON.stringify({ id: "xtrm-live", status: "in_progress" }), stderr: "" };
			return { code: 0, stdout: "", stderr: "" };
		});

		beadsExtension(harness.pi);

		await harness.emit("tool_call", { toolName: "write", input: { path: "a.ts" } });
		await harness.emit("tool_result", {
			toolName: "bash",
			input: { command: "bd kv clear claimed:mock-session-123" },
			content: [{ type: "text", text: "cleared" }],
			isError: false,
		});
		await harness.emit("tool_call", { toolName: "write", input: { path: "b.ts" } });

		const claimGets = calls.filter((a) => a[0] === "kv" && a[1] === "get" && `${a[2]}`.startsWith("claimed:"));
		expect(claimGets).toHaveLength(2); // observed KV mutation invalidated the cache
	});

	it("blocks an unclaimed edit without calling bd list (hasTrackableWork removed)", async () => {
		const calls: string[][] = [];
		(SubprocessRunner.run as any).mockImplementation(async (_cmd: string, args: string[]) => {
			calls.push(args);
			if (args[0] === "kv" && args[1] === "get") return { code: 1, stdout: "", stderr: "" }; // no claim
			if (args[0] === "list") return { code: 0, stdout: "Total: 2 issues (2 open, 0 in progress)", stderr: "" };
			return { code: 0, stdout: "", stderr: "" };
		});

		beadsExtension(harness.pi);

		const result = await harness.emit("tool_call", { toolName: "write", input: { path: "a.ts" } });

		expect(result?.block).toBe(true);
		expect(result?.reason).toContain("No active claim");
		expect(calls.some((a) => a[0] === "list")).toBe(false); // no bd list fallback
	});
});
