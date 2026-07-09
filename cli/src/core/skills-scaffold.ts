import os from 'node:os';
import path from 'path';
import fs from 'fs-extra';
import kleur from 'kleur';
import { rebuildAllRuntimeActiveViews } from './skills-materializer.js';
import { resolveGlobalSkillsRoot, resolveSkillsRoot, resolveUserPacksRoot } from './skills-layout.js';
import { validateSkillsInvariants } from './skill-discovery.js';
import { hasServiceRegistry } from './service-skills-ensure.js';

export interface SkillsActivationResult {
    readonly activatedClaudeSkills: number;
    readonly activatedPiSkills: number;
}

interface EnsureSkillsSymlinkOptions {
    readonly force?: boolean;
}

type PointerScope = 'global' | 'project';

type PointerAction = 'create' | 'refuse' | 'normalize';

async function collectFileSnapshot(rootDir: string): Promise<Map<string, string>> {
    const snapshot = new Map<string, string>();

    async function walk(currentDir: string): Promise<void> {
        const entries = await fs.readdir(currentDir, { withFileTypes: true }).catch(() => [] as fs.Dirent[]);
        entries.sort((left, right) => left.name.localeCompare(right.name));

        for (const entry of entries) {
            const entryPath = path.join(currentDir, entry.name);
            const relativePath = path.relative(rootDir, entryPath);

            if (entry.isDirectory()) {
                await walk(entryPath);
                continue;
            }

            if (!entry.isFile()) {
                continue;
            }

            snapshot.set(relativePath, await fs.readFile(entryPath, 'utf8'));
        }
    }

    if (await fs.pathExists(rootDir)) {
        await walk(rootDir);
    }

    return snapshot;
}

async function backupManagedSkillsDirectory(linkPath: string): Promise<string> {
    const backupPath = `${linkPath}.bak-${new Date().toISOString().replace(/:/g, '-')}`;
    await fs.copy(linkPath, backupPath, { overwrite: true, errorOnExist: false, dereference: true });
    return backupPath;
}

async function appendPointerLog(event: {
    readonly scope: PointerScope;
    readonly action: PointerAction;
    readonly outcome: 'ok' | 'refused';
    readonly target: string;
    readonly existing: string | null;
}): Promise<void> {
    const logPath = path.join(os.homedir(), '.xtrm', 'logs', 'skills-migration.jsonl');
    await fs.ensureDir(path.dirname(logPath));
    await fs.appendFile(logPath, `${JSON.stringify({
        timestamp: new Date().toISOString(),
        component: 'skills-bootstrap',
        event: `pointer.${event.action}`,
        scope: event.scope,
        target: event.target,
        existing: event.existing,
        action: event.action,
        outcome: event.outcome,
    })}\n`);
}

async function describeExistingPath(linkPath: string): Promise<string | null> {
    const existing = await fs.lstat(linkPath).catch(() => null);
    if (!existing) {
        return null;
    }

    if (existing.isSymbolicLink()) {
        return `symlink:${await fs.readlink(linkPath)}`;
    }

    if (existing.isDirectory()) {
        return 'directory';
    }

    if (existing.isFile()) {
        return 'file';
    }

    return 'other';
}

function isSkillsMigrationForced(options: EnsureSkillsSymlinkOptions): boolean {
    return options.force || ['1', 'true', 'yes'].includes(String(process.env.XTRM_FORCE_SKILLS_MIGRATION ?? '').toLowerCase());
}

async function replaceRealDirectoryWithSymlink(
    linkPath: string,
    symlinkTarget: string,
    label: string,
    scope: PointerScope,
    options: EnsureSkillsSymlinkOptions,
): Promise<void> {
    if (label === '.claude/skills') {
        console.log(kleur.yellow('  ⚠ .claude/skills is runtime-managed read-only view; direct writes unsupported.'));
        console.log(kleur.yellow('    Move custom skills to .xtrm/skills/user/ then rebuild.'));
    }

    const isForced = isSkillsMigrationForced(options);

    if (isForced) {
        const backupPath = await backupManagedSkillsDirectory(linkPath);
        console.log(kleur.yellow(`  ⚠ ${label} backed up to ${backupPath}`));
    }

    await fs.remove(linkPath);
    await fs.mkdirp(path.dirname(linkPath));
    await fs.symlink(symlinkTarget, linkPath);
    await appendPointerLog({
        scope,
        action: 'normalize',
        outcome: 'ok',
        target: symlinkTarget,
        existing: 'directory',
    });
    console.log(kleur.yellow(`  ⚠ ${label} real path replaced with managed symlink`));
}

export async function ensureSkillsSymlink(
    linkPath: string,
    symlinkTarget: string,
    label: string,
    scope: PointerScope,
    options: EnsureSkillsSymlinkOptions = {},
): Promise<void> {
    const existing = await fs.lstat(linkPath).catch(() => null);
    if (existing) {
        if (existing.isSymbolicLink()) {
            const current = await fs.readlink(linkPath);
            // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
            const resolvedTarget = path.resolve(path.dirname(linkPath), current);
            if (current === symlinkTarget && await fs.pathExists(resolvedTarget)) {
                console.log(kleur.dim(`  ✓ ${label} symlink already in place`));
                return;
            }
            await fs.remove(linkPath);
            await appendPointerLog({
                scope,
                action: 'normalize',
                outcome: 'ok',
                target: symlinkTarget,
                existing: `symlink:${current}`,
            });
        } else {
            // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
            const targetSnapshot = await collectFileSnapshot(path.resolve(path.dirname(linkPath), symlinkTarget));
            const existingSnapshot = await collectFileSnapshot(linkPath);
            const matchesManagedView = targetSnapshot.size === existingSnapshot.size && [...targetSnapshot.entries()].every(([relativePath, content]) => existingSnapshot.get(relativePath) === content);

            if (!matchesManagedView && !isSkillsMigrationForced(options)) {
                await appendPointerLog({
                    scope,
                    action: 'refuse',
                    outcome: 'refused',
                    target: symlinkTarget,
                    existing: await describeExistingPath(linkPath),
                });
                throw new Error(
                    `Refusing to replace existing ${label}. Backup existing files from ${label}, then re-run with --force. See docs/cat-b-distribution.md.`,
                );
            }

            await replaceRealDirectoryWithSymlink(linkPath, symlinkTarget, label, scope, options);
            return;
        }
    }

    await fs.mkdirp(path.dirname(linkPath));
    await fs.symlink(symlinkTarget, linkPath);
    await appendPointerLog({
        scope,
        action: 'create',
        outcome: 'ok',
        target: symlinkTarget,
        existing: null,
    });
    console.log(`${kleur.green('  ✓')} ${label} → ${symlinkTarget}`);
}

async function hasProjectScopedSkillsContent(projectRoot: string): Promise<boolean> {
    const skillsRoot = resolveSkillsRoot(projectRoot);
    const packsRoot = resolveUserPacksRoot(skillsRoot);
    const packEntries = await fs.readdir(packsRoot, { withFileTypes: true }).catch(() => [] as fs.Dirent[]);
    if (packEntries.some((entry) => entry.isDirectory())) {
        return true;
    }

    return hasServiceRegistry(projectRoot);
}

async function hasReadyGlobalRuntimePointers(): Promise<boolean> {
    const globalActiveRoot = path.join(resolveGlobalSkillsRoot(), 'active');
    if (!await fs.pathExists(globalActiveRoot)) {
        return false;
    }

    const claudePointerPath = path.join(os.homedir(), '.claude', 'skills');
    const piPointerPath = path.join(os.homedir(), '.pi', 'agent', 'skills');
    const claudeTarget = await fs.readlink(claudePointerPath).catch(() => null);
    const piTarget = await fs.readlink(piPointerPath).catch(() => null);
    if (claudeTarget !== globalActiveRoot || piTarget !== globalActiveRoot) {
        return false;
    }

    const claudeResolvedTarget = path.resolve(path.dirname(claudePointerPath), claudeTarget);
    const piResolvedTarget = path.resolve(path.dirname(piPointerPath), piTarget);
    return await fs.pathExists(claudeResolvedTarget) && await fs.pathExists(piResolvedTarget);
}

export async function ensureUserAgentsSkillsSymlink(options: EnsureSkillsSymlinkOptions = {}): Promise<void> {
    const globalActiveRoot = path.join(resolveGlobalSkillsRoot(), 'active');
    if (!await fs.pathExists(globalActiveRoot)) {
        throw new Error(`Global runtime skills root missing: ${globalActiveRoot}`);
    }

    await ensureSkillsSymlink(
        path.join(os.homedir(), '.claude', 'skills'),
        globalActiveRoot,
        '~/.claude/skills',
        'global',
        options,
    );
    await ensureSkillsSymlink(
        path.join(os.homedir(), '.pi', 'agent', 'skills'),
        globalActiveRoot,
        '~/.pi/agent/skills',
        'global',
        options,
    );
}

export async function ensureAgentsSkillsSymlink(projectRoot: string, options: EnsureSkillsSymlinkOptions = {}): Promise<SkillsActivationResult> {
    const skillsRoot = resolveSkillsRoot(projectRoot);
    if (!await fs.pathExists(path.join(skillsRoot, 'default'))) {
        return {
            activatedClaudeSkills: 0,
            activatedPiSkills: 0,
        };
    }

    const invariantViolations = await validateSkillsInvariants(skillsRoot);
    if (invariantViolations.length > 0) {
        const summary = invariantViolations.map(violation => `${violation.code}: ${violation.message}`).join('; ');
        throw new Error(`Skills invariants failed. ${summary}`);
    }

    const materializedViews = await rebuildAllRuntimeActiveViews(skillsRoot);
    const activatedClaudeSkills = materializedViews[0]?.discoveredSkillCount ?? 0;
    const activatedPiSkills = activatedClaudeSkills;

    const shouldUseProjectPointer = await hasProjectScopedSkillsContent(projectRoot);
    if (shouldUseProjectPointer) {
        await ensureSkillsSymlink(
            path.join(projectRoot, '.claude', 'skills'),
            path.join('..', '.xtrm', 'skills', 'active'),
            '.claude/skills',
            'project',
            options,
        );
    } else if (await hasReadyGlobalRuntimePointers()) {
        console.log(kleur.dim('  ○ project-scope skills pointer skipped (using global)'));
    } else {
        await ensureSkillsSymlink(
            // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
            path.join(projectRoot, '.claude', 'skills'),
            path.join('..', '.xtrm', 'skills', 'active'),
            '.claude/skills',
            'project',
            options,
        );
    }



    return {
        activatedClaudeSkills,
        activatedPiSkills,
    };
}
