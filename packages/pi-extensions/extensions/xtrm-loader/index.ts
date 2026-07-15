import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * xtrm-loader (xtrm-x12p3): scoped down from the pre-x12p3 eager loader.
 *
 * Before x12p3 the loader appended the following to every Pi provider request:
 *   - full ROADMAP / architecture body (~20 KB in core)
 *   - every .claude/rules/**\/*.md body concatenated
 *   - a recursive .md inventory of .claude/skills/ that duplicated Pi's
 *     native `<available_skills>` metadata (~35 KB in a typical install)
 *   - .xtrm/memory.md
 *   - the full using-xtrm SKILL.md body (~8 KB) — duplicated the session-
 *     start reflex + trigger patterns that now live in
 *     .xtrm/config/instructions/{agents,claude}-top.md
 *
 * Only .xtrm/memory.md survives here. It is small (<= a few KB), user-owned,
 * per-project, and can't live in a global -top file. Everything else moved
 * to routing pointers in the -top templates; the using-xtrm skill body is
 * on-demand via `/skill:using-xtrm` when detailed workflow examples are
 * needed.
 */

export default function (pi: ExtensionAPI) {
	pi.on("before_agent_start", async (event, ctx) => {
		const memoryPath = path.join(ctx.cwd, ".xtrm", "memory.md");
		if (!fs.existsSync(memoryPath)) return undefined;

		let memoryContent = "";
		try {
			memoryContent = fs.readFileSync(memoryPath, "utf8").trim();
		} catch {
			return undefined; // fail open
		}
		if (!memoryContent) return undefined;

		return {
			systemPrompt: event.systemPrompt + "\n\n" + memoryContent,
		};
	});
}
