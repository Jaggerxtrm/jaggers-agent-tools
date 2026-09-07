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
 * Only the shared bd memory doctrine survives here (xtrm-3ljgz.3): a small,
 * canonical retrieval doctrine shipped as
 * .xtrm/config/instructions/memory-doctrine.md and consumed identically by
 * the Claude project-memory hook. `.xtrm/memory.md` is never injected — it
 * stays a user-owned artifact of `xt memory update`, and live `bd memories`
 * retrieval replaces it. Everything else moved to routing pointers in the
 * -top templates; the using-xtrm skill body is on-demand via
 * `/skill:using-xtrm` when detailed workflow examples are needed.
 */

export default function (pi: ExtensionAPI) {
	pi.on("before_agent_start", async (event, ctx) => {
		const doctrinePath = path.join(ctx.cwd, ".xtrm", "config", "instructions", "memory-doctrine.md");
		if (!fs.existsSync(doctrinePath)) return undefined;

		let doctrineContent = "";
		try {
			doctrineContent = fs.readFileSync(doctrinePath, "utf8").trim();
		} catch {
			return undefined; // fail open
		}
		if (!doctrineContent) return undefined;

		return {
			systemPrompt: event.systemPrompt + "\n\n" + doctrineContent,
		};
	});
}
