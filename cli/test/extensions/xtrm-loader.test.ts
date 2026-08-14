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

const DOCTRINE_PATH = "/workspace/project/.xtrm/config/instructions/memory-doctrine.md";

describe("XTRM Loader Extension (xtrm-x12p3)", () => {
	let harness: ExtensionHarness;

	beforeEach(() => {
		vi.resetAllMocks();
		harness = new ExtensionHarness("/workspace/project");
	});

	it("injects the canonical memory doctrine into system prompt at before_agent_start (xtrm-3ljgz.3)", async () => {
		(fs.existsSync as any).mockImplementation((p: string) => p === DOCTRINE_PATH);
		(fs.readFileSync as any).mockImplementation((p: string) => {
			if (p === DOCTRINE_PATH) return "# BD Memory Doctrine\n\nUse `bd memories <topic>` when history is relevant.";
			return "";
		});

		xtrmLoaderExtension(harness.pi);
		const result = await harness.emit("before_agent_start", { systemPrompt: "Base prompt" });

		expect(result?.systemPrompt).toBe(
			"Base prompt\n\n# BD Memory Doctrine\n\nUse `bd memories <topic>` when history is relevant.",
		);
	});

	it("never injects .xtrm/memory.md even when it exists (xtrm-3ljgz.3)", async () => {
		(fs.existsSync as any).mockImplementation((p: string) =>
			p === DOCTRINE_PATH || p === "/workspace/project/.xtrm/memory.md");
		(fs.readFileSync as any).mockImplementation((p: string) => {
			if (p === DOCTRINE_PATH) return "# BD Memory Doctrine";
			if (p === "/workspace/project/.xtrm/memory.md") return "stale synthesized state that must not leak";
			return "";
		});

		xtrmLoaderExtension(harness.pi);
		const result = await harness.emit("before_agent_start", { systemPrompt: "Base" });

		expect(result?.systemPrompt).toContain("# BD Memory Doctrine");
		expect(result?.systemPrompt).not.toContain("stale synthesized state");
	});

	it("returns undefined (fail open) when the doctrine is absent", async () => {
		(fs.existsSync as any).mockReturnValue(false);

		xtrmLoaderExtension(harness.pi);
		const result = await harness.emit("before_agent_start", { systemPrompt: "Base prompt" });

		expect(result).toBeUndefined();
	});

	it("no longer eager-loads using-xtrm SKILL.md (moved to /skill:using-xtrm on demand)", async () => {
		// Simulate a project that has the doctrine and using-xtrm skill available.
		// Only the doctrine should end up in the systemPrompt; using-xtrm body must NOT.
		(fs.existsSync as any).mockImplementation((p: string) => {
			if (p === DOCTRINE_PATH) return true;
			if (p === "/workspace/project/.pi/skills/using-xtrm/SKILL.md") return true;
			return false;
		});
		(fs.readFileSync as any).mockImplementation((p: string) => {
			if (p === DOCTRINE_PATH) return "# BD Memory Doctrine";
			if (p === "/workspace/project/.pi/skills/using-xtrm/SKILL.md") return "USING-XTRM-BODY-SHOULD-NOT-APPEAR";
			return "";
		});

		xtrmLoaderExtension(harness.pi);
		const result = await harness.emit("before_agent_start", { systemPrompt: "Base" });

		expect(result?.systemPrompt).toContain("# BD Memory Doctrine");
		expect(result?.systemPrompt).not.toContain("USING-XTRM-BODY-SHOULD-NOT-APPEAR");
		expect(result?.systemPrompt).not.toContain("Session Operating Manual");
	});

	it("no longer eager-loads ROADMAP / rules / skills inventory", async () => {
		(fs.existsSync as any).mockImplementation((p: string) => {
			// Pretend all the pre-x12p3 sources exist. None should end up in the prompt.
			if (p === DOCTRINE_PATH) return true;
			if (p.endsWith("ROADMAP.md")) return true;
			if (p.endsWith(".claude/rules")) return true;
			if (p.endsWith(".claude/skills")) return true;
			return false;
		});
		(fs.readFileSync as any).mockImplementation((p: string) => {
			if (p === DOCTRINE_PATH) return "# BD Memory Doctrine";
			return "ROADMAP-OR-RULE-BODY-SHOULD-NOT-APPEAR";
		});

		xtrmLoaderExtension(harness.pi);
		const result = await harness.emit("before_agent_start", { systemPrompt: "Base" });

		expect(result?.systemPrompt).toContain("# BD Memory Doctrine");
		expect(result?.systemPrompt).not.toContain("ROADMAP-OR-RULE-BODY-SHOULD-NOT-APPEAR");
		expect(result?.systemPrompt).not.toContain("Project Roadmap");
		expect(result?.systemPrompt).not.toContain("Project Rules");
		expect(result?.systemPrompt).not.toContain("Available Project Skills");
	});
});
