import { createHash } from 'node:crypto';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';

// Ownership proof for per-project Claude hook registrations that the global
// install already covers. Ported from scripts/dedupe-legacy-hooks.mjs (PR #460),
// which validated it across 8 consumer projects: 152 duplicates planned,
// 2 preserved, 0 false positives. Taxonomy: docs/legacy-hook-duplication.md.
//
// An entry is xt-owned-and-redundant iff the same (event, matcher, command)
// exists in ~/.claude/settings.json once <repo>/.xtrm/hooks is normalised to
// ~/.xtrm/hooks, AND — when the command names a project hook file — that file is
// byte-identical to its global counterpart. Anything else is preserved: drift,
// uncovered xt registrations, and foreign hooks are never removed.
//
// Provenance markers (_source / _xtrm.hash) are deliberately NOT part of the
// proof: legacy per-project entries predate provenance tagging and carry
// neither, which is what made the old predicate a no-op (xtrm-v1yck).

// Join key fields with a byte that cannot occur in an event, matcher or command.
const SEP = String.fromCharCode(0);

export type PreservedClassification = 'xt-owned-drift' | 'xt-owned-uncovered' | 'foreign';

export interface HookRegistration {
    event: string;
    matcher: string;
    command: string;
}

export interface PlannedRemoval extends HookRegistration {
    classification: 'duplicate-of-global';
}

export interface PreservedRegistration extends HookRegistration {
    classification: PreservedClassification;
    reason: string;
}

// Structural minimum shared by every hook shape in the codebase — kept free of
// index signatures so the concrete HookWrapper/CommandHook types stay assignable.
interface CommandHookLike {
    command?: string;
}

export interface HookWrapperLike {
    matcher?: string;
    hooks?: CommandHookLike[];
}

export interface LegacyHookDedupePlan<W extends HookWrapperLike> {
    /** Input hooks map with every planned removal pruned out. */
    hooks: Record<string, W[]>;
    planned: PlannedRemoval[];
    preserved: PreservedRegistration[];
    /** Set when the proof could not be evaluated — nothing was removed. */
    skipped?: string;
}

function registrationKey(event: string, matcher: string, command: string): string {
    return `${event}${SEP}${matcher}${SEP}${command}`;
}

async function readJsonOrNull(file: string): Promise<Record<string, unknown> | null> {
    try {
        return await fs.readJson(file) as Record<string, unknown>;
    } catch {
        return null;
    }
}

async function sha256(file: string): Promise<string | null> {
    try {
        return createHash('sha256').update(await fs.readFile(file)).digest('hex');
    } catch {
        return null;
    }
}

// Rewrite a project-scoped hook path to its global equivalent so project and
// global registrations can be compared as strings.
function normaliseCommand(command: string, projectHooksDir: string, globalHooksDir: string): string {
    return command.split(projectHooksDir).join(globalHooksDir);
}

// The project hook file a command invokes, if any. Used for the byte-identity
// check. Commands look like: node "/repo/.xtrm/hooks/gitnexus/gitnexus-hook.cjs"
function referencedHookFile(command: string, projectHooksDir: string): string | null {
    const prefix = `${projectHooksDir}${path.sep}`;
    const start = command.indexOf(prefix);
    if (start === -1) return null;
    const rest = command.slice(start + prefix.length);
    const end = rest.search(/["'\s]/);
    return end === -1 ? rest : rest.slice(0, end);
}

function indexGlobalRegistrations(settings: Record<string, unknown> | null): Set<string> {
    const index = new Set<string>();
    const hooks = (settings?.hooks ?? {}) as Record<string, HookWrapperLike[]>;
    for (const [event, wrappers] of Object.entries(hooks)) {
        if (!Array.isArray(wrappers)) continue;
        for (const wrapper of wrappers) {
            for (const hook of wrapper?.hooks ?? []) {
                index.add(registrationKey(event, wrapper.matcher ?? '', hook?.command ?? ''));
            }
        }
    }
    return index;
}

// Rebuild the hooks map without the planned commands, dropping wrappers and
// events that end up empty. Everything else is copied through as-is.
function pruneHooks<W extends HookWrapperLike>(
    hooks: Record<string, W[]>,
    remove: Set<string>,
): Record<string, W[]> {
    const pruned: Record<string, W[]> = {};
    for (const [event, wrappers] of Object.entries(hooks)) {
        if (!Array.isArray(wrappers)) {
            pruned[event] = wrappers;
            continue;
        }
        const keptWrappers: W[] = [];
        for (const wrapper of wrappers) {
            const keptHooks = (wrapper?.hooks ?? []).filter(
                (hook) => !remove.has(registrationKey(event, wrapper.matcher ?? '', hook?.command ?? '')),
            );
            if (keptHooks.length > 0) keptWrappers.push({ ...wrapper, hooks: keptHooks } as W);
        }
        if (keptWrappers.length > 0) pruned[event] = keptWrappers;
    }
    return pruned;
}

/**
 * Classify every registration in a project's Claude hooks map against the global
 * install and prune the ones proven redundant.
 *
 * Fail-open by contract: if ~/.claude/settings.json is unreadable or
 * ~/.xtrm/hooks/ is missing, the input map is returned untouched with `skipped`
 * set. It never throws.
 */
export async function planLegacyHookDedupe<W extends HookWrapperLike>(
    projectRoot: string,
    hooks: Record<string, W[]> | undefined,
    opts: { home?: string } = {},
): Promise<LegacyHookDedupePlan<W>> {
    const unchanged: LegacyHookDedupePlan<W> = { hooks: hooks ?? {}, planned: [], preserved: [] };
    if (!hooks || Object.keys(hooks).length === 0) return unchanged;

    try {
        const home = opts.home ?? os.homedir();
        const globalHooksDir = path.join(home, '.xtrm', 'hooks');
        const globalSettingsPath = path.join(home, '.claude', 'settings.json');

        const globalSettings = await readJsonOrNull(globalSettingsPath);
        if (!globalSettings) {
            return { ...unchanged, skipped: `cannot read ${globalSettingsPath}` };
        }
        if (!(await fs.pathExists(globalHooksDir))) {
            return { ...unchanged, skipped: `${globalHooksDir} is missing` };
        }

        const globalIndex = indexGlobalRegistrations(globalSettings);
        const projectHooksDir = path.join(projectRoot, '.xtrm', 'hooks');
        const planned: PlannedRemoval[] = [];
        const preserved: PreservedRegistration[] = [];
        const remove = new Set<string>();

        for (const [event, wrappers] of Object.entries(hooks)) {
            if (!Array.isArray(wrappers)) continue;
            for (const wrapper of wrappers) {
                const matcher = wrapper?.matcher ?? '';
                for (const hook of wrapper?.hooks ?? []) {
                    const command = hook?.command ?? '';
                    const item: HookRegistration = { event, matcher, command };
                    const normalised = normaliseCommand(command, projectHooksDir, globalHooksDir);

                    if (!globalIndex.has(registrationKey(event, matcher, normalised))) {
                        const isProjectXtrm = normalised !== command;
                        preserved.push({
                            ...item,
                            classification: isProjectXtrm ? 'xt-owned-uncovered' : 'foreign',
                            reason: isProjectXtrm
                                ? 'references project .xtrm/hooks but the global install has no equivalent — needs migration, not deletion'
                                : 'not an xtrm-managed registration',
                        });
                        continue;
                    }

                    // Covered globally. If it names a project hook file, that file must be
                    // byte-identical to the global one before we call it a safe duplicate.
                    const hookFile = referencedHookFile(command, projectHooksDir);
                    if (hookFile) {
                        const [projectHash, globalHash] = await Promise.all([
                            sha256(path.join(projectHooksDir, hookFile)),
                            sha256(path.join(globalHooksDir, hookFile)),
                        ]);
                        if (projectHash === null || globalHash === null || projectHash !== globalHash) {
                            preserved.push({
                                ...item,
                                classification: 'xt-owned-drift',
                                reason: `project hook ${hookFile} does not match the global copy — resolve the drift before deduping`,
                            });
                            continue;
                        }
                    }

                    planned.push({ ...item, classification: 'duplicate-of-global' });
                    remove.add(registrationKey(event, matcher, command));
                }
            }
        }

        if (planned.length === 0) return { hooks, planned, preserved };
        return { hooks: pruneHooks(hooks, remove), planned, preserved };
    } catch (error) {
        return { ...unchanged, skipped: error instanceof Error ? error.message : String(error) };
    }
}
