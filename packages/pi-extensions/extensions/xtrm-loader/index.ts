import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import { Logger } from "../../src/core";

const logger = new Logger({ namespace: "xtrm-loader" });

/**
 * xtrm-loader (xtrm-x12p3): scoped down from the pre-x12p3 eager loader.
 *
 * Before x12p3 the loader appended the following to every Pi provider request:
 *   - full ROADMAP / architecture body (~20 KB in core)
 *   - every .claude/rules/**\/*.md body concatenated
 *   - a recursive .md inventory of .claude/skills/ that duplicated Pi's
 *     native `<available_skills>` metadata (~35 KB in a typical install)
 *   - .xtrm/memory.md
 *   - the full using-xtrm SKILL.md body
 *
 * Only the last two are kept. Everything else is now a one-line pointer in
 * .xtrm/config/instructions/{agents,claude}-top.md so agents READ the
 * source when the task needs it — routing, not embedding.
 *
 *   - `.xtrm/memory.md`: small per-project synthesized context, always useful
 *     enough that an eager inject is worth the tokens.
 *   - using-xtrm SKILL.md: the session operating manual. Small (~8 KB) and
 *     genuinely per-turn essential. Everything else is discoverable on demand.
 */

function resolveUsingXtrmSkillPath(cwd: string): string | null {
	const candidates = [
		path.join(cwd, ".pi", "skills", "using-xtrm", "SKILL.md"),
	];

	for (const candidate of candidates) {
		if (fs.existsSync(candidate)) return candidate;
	}
	return null;
}

function loadSkillContent(skillPath: string): string | null {
	try {
		const content = fs.readFileSync(skillPath, "utf8");
		return content.replace(/^---[\s\S]*?---\n/, "").trim();
	} catch {
		return null;
	}
}

export default function (pi: ExtensionAPI) {
	let usingXtrmContent: string | null = null;

	pi.on("session_start", async (_event, ctx) => {
		const usingXtrmPath = resolveUsingXtrmSkillPath(ctx.cwd);
		usingXtrmContent = usingXtrmPath ? loadSkillContent(usingXtrmPath) : null;
		if (usingXtrmPath && usingXtrmContent) {
			logger.info(`Loaded using-xtrm skill from ${usingXtrmPath}`);
		}
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const parts: string[] = [];

		if (usingXtrmContent) {
			parts.push("# XTRM Session Operating Manual\n\n" + usingXtrmContent);
		}

		const memoryPath = path.join(ctx.cwd, ".xtrm", "memory.md");
		if (fs.existsSync(memoryPath)) {
			try {
				const memoryContent = fs.readFileSync(memoryPath, "utf8").trim();
				if (memoryContent) parts.push(memoryContent);
			} catch { /* fail open */ }
		}

		if (parts.length === 0) return undefined;

		return {
			systemPrompt: event.systemPrompt + "\n\n" + parts.join("\n\n---\n\n"),
		};
	});
}
