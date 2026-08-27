/**
 * service-knowledge ext v1 (xtrm-6z6.1)
 *
 * Replaces the stale `service-skills` extension. Self-gating registration:
 * at init it scans the session cwd for a service registry using the exact
 * semantics of the service-knowledge package's `find_umbrella_packs`
 * (packages/service-knowledge/src/service_knowledge/cli/common.py):
 *
 *   - candidate pack roots: [<cwd>/.xtrm/skills, <cwd>/.xtrm/skills/user/packs]
 *   - reserved pack names are skipped (default, optional, user, active, local-legacy)
 *   - the NEW umbrella `service-knowledge` wins over the LEGACY `service-skills`
 *   - a pack counts only if <pack>/<umbrella>/service-registry.json exists
 *
 * No registry → the extension registers NOTHING (zero surface: no tool, no
 * command, no event handlers). Live sessions load extensions from this package
 * source, so this gate is what keeps registrations airtight in non-service repos.
 *
 * With a registry, the surface is:
 *   (a) before_agent_start context note — service count + drift state
 *       (checks both the canonical .service-knowledge-drift-pending and the
 *       legacy .service-skills-drift-pending marker; canonical wins)
 *   (b) /service-knowledge:status — services, last_sync_ref vs git HEAD,
 *       drift marker presence, suggested action
 *   (c) guidance pointing at /updating-service-knowledge (NOT -skills)
 *
 * NON_GOALS (v1): no auto-update execution, no index rebuild trigger.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const NEW_UMBRELLA = "service-knowledge";
const LEGACY_UMBRELLA = "service-skills";
const RESERVED_PACK_NAMES = new Set(["default", "optional", "user", "active", "local-legacy"]);
const DRIFT_MARKER_REL = join(".xtrm", ".service-knowledge-drift-pending");
// Wave-1 repos carry the legacy marker name (mercury/infra reality); the new
// name wins when both are present (xtrm-6z6.2 coordinator finding).
const LEGACY_DRIFT_MARKER_REL = join(".xtrm", ".service-skills-drift-pending");
const RECONCILE_COMMAND = "/updating-service-knowledge";

export interface ServiceRegistryPack {
	/** Absolute pack dir (e.g. <cwd>/.xtrm/skills/infra). */
	packDir: string;
	/** The umbrella dir that won (service-knowledge preferred over service-skills). */
	umbrellaDir: string;
	/** Umbrella name actually used. */
	umbrellaName: string;
	/** Absolute path to service-registry.json. */
	registryPath: string;
}

/** Candidate pack roots, mirroring find_umbrella_packs (common.py). */
function candidatePackRoots(cwd: string): string[] {
	return [join(cwd, ".xtrm", "skills"), join(cwd, ".xtrm", "skills", "user", "packs")];
}

/**
 * Find every pack carrying a service-knowledge OR service-skills umbrella with
 * a registry. New name wins over legacy per pack (find_umbrella_packs semantics).
 */
export function findUmbrellaPacks(cwd: string): ServiceRegistryPack[] {
	const out: ServiceRegistryPack[] = [];
	const seen = new Set<string>();
	for (const root of candidatePackRoots(cwd)) {
		let packNames: string[] = [];
		try {
			packNames = readdirSync(root, { withFileTypes: true })
				.filter((e) => e.isDirectory())
				.map((e) => e.name);
		} catch {
			continue; // missing root is not an error
		}
		for (const name of packNames.sort()) {
			if (RESERVED_PACK_NAMES.has(name)) continue;
			const packDir = resolve(join(root, name));
			if (seen.has(packDir)) continue;
			for (const umbrellaName of [NEW_UMBRELLA, LEGACY_UMBRELLA]) {
				const umbrellaDir = join(packDir, umbrellaName);
				const registryPath = join(umbrellaDir, "service-registry.json");
				if (existsSync(registryPath)) {
					seen.add(packDir);
					out.push({ packDir, umbrellaDir, umbrellaName, registryPath });
					break;
				}
			}
		}
	}
	return out;
}

/** Load + validate the registry JSON; returns null on any parse/read failure. */
export function loadRegistry(registryPath: string): { services: Record<string, Record<string, unknown>> } | null {
	try {
		const raw = JSON.parse(readFileSync(registryPath, "utf8"));
		if (raw && typeof raw === "object" && raw.services && typeof raw.services === "object") {
			return raw as { services: Record<string, Record<string, unknown>> };
		}
		return null;
	} catch {
		return null;
	}
}

/** Current git HEAD short sha (fixed 7 chars); null when the cwd is not in a git repo. */
export function gitHead(cwd: string): string | null {
	try {
		return execFileSync("git", ["rev-parse", "--short=7", "HEAD"], { cwd, encoding: "utf8" }).trim() || null;
	} catch {
		return null;
	}
}

/** Per-service last_sync_ref (first 7 chars, matching `git rev-parse --short`) from the registry; empty when absent. */
function syncRefs(registry: { services: Record<string, Record<string, unknown>> }): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [id, info] of Object.entries(registry.services)) {
		out[id] = String(info?.last_sync_ref ?? "").slice(0, 7);
	}
	return out;
}

/**
 * Whether a drift pending marker is present in this repo. Checks both the
 * canonical (service-knowledge) and legacy (service-skills) marker names;
 * the canonical one wins when both exist (xtrm-6z6.2).
 */
export function hasDriftMarker(cwd: string): boolean {
	return existsSync(join(cwd, DRIFT_MARKER_REL)) || existsSync(join(cwd, LEGACY_DRIFT_MARKER_REL));
}

/** The marker file actually present (canonical preferred), or null. */
export function driftMarkerPath(cwd: string): string | null {
	if (existsSync(join(cwd, DRIFT_MARKER_REL))) return DRIFT_MARKER_REL;
	if (existsSync(join(cwd, LEGACY_DRIFT_MARKER_REL))) return LEGACY_DRIFT_MARKER_REL;
	return null;
}

function packLabel(pack: ServiceRegistryPack): string {
	return `${pack.umbrellaName}@${pack.packDir.replace(/^.*\/\.xtrm\/skills\//, "")}`;
}

/** Build the before_agent_start context note (service count + drift state). */
function buildContextNote(cwd: string, packs: ServiceRegistryPack[]): string {
	const total = packs.reduce((acc, p) => acc + (loadRegistry(p.registryPath)?.services ? Object.keys(loadRegistry(p.registryPath)!.services).length : 0), 0);
	const lines = [
		"<service_knowledge_context>",
		`service registry: ${packs.length} pack(s), ${total} service(s)`,
		...packs.map((p) => `- ${packLabel(p)} (${Object.keys(loadRegistry(p.registryPath)?.services ?? {}).length} services)`),
		driftMarkerPath(cwd)
			? `drift: PENDING marker present (${driftMarkerPath(cwd)}) — reconcile with ${RECONCILE_COMMAND}`
			: "drift: none detected",
		"</service_knowledge_context>",
	];
	return lines.join("\n");
}

export interface ServiceKnowledgeExtensionOptions {
	/** Override the init cwd scan (tests inject a fixture dir). Defaults to process.cwd(). */
	cwd?: string;
}

export default function serviceKnowledgeExtension(pi: ExtensionAPI, opts: ServiceKnowledgeExtensionOptions = {}) {
	const getCwd = (ctx: any) => ctx?.cwd || process.cwd();

	// Self-gating: scan once at init. No registry → register nothing at all.
	const cwd = opts.cwd || getCwd({});
	const packs = findUmbrellaPacks(cwd);
	if (packs.length === 0) {
		return; // zero surface
	}

	// (a) per-turn context note. before_agent_start is the documented injection
	// point for a custom message into the LLM context (session_start return
	// values are not consumed as messages — xtrm-vs7f8 audit finding).
	pi.on("before_agent_start", async (_event, ctx) => {
		return {
			message: {
				customType: "service-knowledge-context",
				content: buildContextNote(getCwd(ctx), packs),
				display: false,
			},
		};
	});

	// (b) /service-knowledge:status command
	pi.registerCommand("service-knowledge:status", {
		description: "Show service registry status: services, last_sync_ref vs git HEAD, drift marker, suggested action",
		handler: async (_args, ctx) => {
			const repoCwd = getCwd(ctx);
			const lines: string[] = ["service-knowledge status"];
			for (const pack of packs) {
				const registry = loadRegistry(pack.registryPath);
				const svcCount = registry ? Object.keys(registry.services).length : -1;
				lines.push(`pack: ${packLabel(pack)}`);
				lines.push(`  umbrella: ${pack.umbrellaName} (registry: ${pack.registryPath})`);
				lines.push(`  services: ${svcCount}`);
				if (registry) {
					for (const [id, ref] of Object.entries(syncRefs(registry))) {
						lines.push(`  - ${id}: last_sync_ref ${ref || "(never)"}`);
					}
				}
			}
			const head = gitHead(repoCwd);
			lines.push(`git HEAD: ${head ?? "(not a git repo)"}`);
			const marker = driftMarkerPath(repoCwd);
			lines.push(`drift marker: ${marker ? `PRESENT (${marker})` : "absent"}`);
			const anyOutOfSync = packs.some((p) => {
				const registry = loadRegistry(p.registryPath);
				if (!registry) return false;
				return Object.values(syncRefs(registry)).some((ref) => ref && ref !== head);
			});
			lines.push(`suggested action: ${anyOutOfSync || hasDriftMarker(repoCwd) ? `run ${RECONCILE_COMMAND} to reconcile + stamp last_sync_ref` : "none — registry is in sync with HEAD"}`);
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
