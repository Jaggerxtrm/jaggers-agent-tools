import { describe, it, expect, vi, beforeEach } from "vitest";
import { ExtensionHarness } from "./extension-harness";
import xtrmLoaderExtension from "../../../packages/pi-extensions/extensions/xtrm-loader/index";
import * as fs from "node:fs";

vi.mock("node:fs", () => ({
	existsSync: vi.fn(),
	readFileSync: vi.fn(),
	promises: {
		readFile: vi.fn(),
	},
}));

describe("XTRM Loader Extension (xtrm-x12p3)", () => {
	let harness: ExtensionHarness;

	beforeEach(() => {
		vi.resetAllMocks();
		harness = new ExtensionHarness("/workspace/project");
	});

	it("injects .xtrm/memory.md into system prompt at before_agent_start", async () => {
		(fs.existsSync as any).mockImplementation((p: string) => p === "/workspace/project/.xtrm/memory.md");
		(fs.readFileSync as any).mockImplementation((p: string) => {
			if (p === "/workspace/project/.xtrm/memory.md") return "# Project Memory\n\nDo the thing.";
			return "";
		});

		xtrmLoaderExtension(harness.pi);
		const result = await harness.emit("before_agent_start", { systemPrompt: "Base prompt" });

		expect(result?.systemPrompt).toBe("Base prompt\n\n# Project Memory\n\nDo the thing.");
	});

	it("returns undefined (no eager inject) when .xtrm/memory.md is absent", async () => {
		(fs.existsSync as any).mockReturnValue(false);

		xtrmLoaderExtension(harness.pi);
		const result = await harness.emit("before_agent_start", { systemPrompt: "Base prompt" });

		expect(result).toBeUndefined();
	});

	it("no longer eager-loads using-xtrm SKILL.md (moved to /skill:using-xtrm on demand)", async () => {
		// Simulate a project that has both memory.md and using-xtrm skill available.
		// Only memory.md should end up in the systemPrompt; using-xtrm body must NOT.
		(fs.existsSync as any).mockImplementation((p: string) => {
			if (p === "/workspace/project/.xtrm/memory.md") return true;
			if (p === "/workspace/project/.pi/skills/using-xtrm/SKILL.md") return true;
			return false;
		});
		(fs.readFileSync as any).mockImplementation((p: string) => {
			if (p === "/workspace/project/.xtrm/memory.md") return "memory-only";
			if (p === "/workspace/project/.pi/skills/using-xtrm/SKILL.md") return "USING-XTRM-BODY-SHOULD-NOT-APPEAR";
			return "";
		});

		xtrmLoaderExtension(harness.pi);
		const result = await harness.emit("before_agent_start", { systemPrompt: "Base" });

		expect(result?.systemPrompt).toContain("memory-only");
		expect(result?.systemPrompt).not.toContain("USING-XTRM-BODY-SHOULD-NOT-APPEAR");
		expect(result?.systemPrompt).not.toContain("Session Operating Manual");
	});

	it("no longer eager-loads ROADMAP / rules / skills inventory", async () => {
		(fs.existsSync as any).mockImplementation((p: string) => {
			// Pretend all the pre-x12p3 sources exist. None should end up in the prompt.
			if (p === "/workspace/project/.xtrm/memory.md") return true;
			if (p.endsWith("ROADMAP.md")) return true;
			if (p.endsWith(".claude/rules")) return true;
			if (p.endsWith(".claude/skills")) return true;
			return false;
		});
		(fs.readFileSync as any).mockImplementation((p: string) => {
			if (p === "/workspace/project/.xtrm/memory.md") return "memory-content";
			return "ROADMAP-OR-RULE-BODY-SHOULD-NOT-APPEAR";
		});

		xtrmLoaderExtension(harness.pi);
		const result = await harness.emit("before_agent_start", { systemPrompt: "Base" });

		expect(result?.systemPrompt).toContain("memory-content");
		expect(result?.systemPrompt).not.toContain("ROADMAP-OR-RULE-BODY-SHOULD-NOT-APPEAR");
		expect(result?.systemPrompt).not.toContain("Project Roadmap");
		expect(result?.systemPrompt).not.toContain("Project Rules");
		expect(result?.systemPrompt).not.toContain("Available Project Skills");
	});
});
