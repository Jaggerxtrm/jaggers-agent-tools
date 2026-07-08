import { describe, it, expect, vi, beforeEach } from "vitest";
import { ExtensionHarness } from "./extension-harness";
import xtrmLoaderExtension from "../../../packages/pi-extensions/extensions/xtrm-loader/index";
import * as fs from "node:fs";

vi.mock("node:os", () => ({
	homedir: () => "/home/test",
}));

vi.mock("node:fs", () => ({
	existsSync: vi.fn(),
	readFileSync: vi.fn(),
	readdirSync: vi.fn(),
	promises: {
		readFile: vi.fn(),
	},
}));

describe("XTRM Loader Extension", () => {
	let harness: ExtensionHarness;

	beforeEach(() => {
		vi.resetAllMocks();
		harness = new ExtensionHarness("/workspace/project");
		(fs.readdirSync as any).mockReturnValue([]);
	});

	it("injects using-xtrm content into system prompt at before_agent_start", async () => {
		// Batch G+: only project-local .pi/skills path is checked
		(fs.existsSync as any).mockImplementation((p: string) => {
			if (p === "/workspace/project/.pi/skills/using-xtrm/SKILL.md") return true;
			if (p.endsWith("ROADMAP.md")) return false;
			if (p.endsWith(".claude/rules")) return false;
			if (p.endsWith(".claude/skills")) return false;
			return false;
		});

		(fs.readFileSync as any).mockImplementation((p: string) => {
			if (p === "/workspace/project/.pi/skills/using-xtrm/SKILL.md") {
				return "---\nname: using-xtrm\n---\n# Manual\nUse bd prime";
			}
			return "";
		});

		xtrmLoaderExtension(harness.pi);
		await harness.emit("session_start", {});
		const result = await harness.emit("before_agent_start", { systemPrompt: "Base prompt" });

		expect(result?.systemPrompt).toContain("XTRM Session Operating Manual");
		expect(result?.systemPrompt).toContain("Use bd prime");
		expect(result?.systemPrompt).not.toContain("name: using-xtrm");
	});
});
