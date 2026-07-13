import path from 'node:path';
import { resolveGlobalSkillsRoot } from './skills-layout.js';
import { isRepoMigratedSync } from '../utils/known-repos.js';

// Global skills mode is active when EITHER the env flag is set (transition
// opt-in) OR the target repo is recorded as skills-migrated in
// ~/.xtrm/known-repos.json (durability — once migrated, stay migrated).
// Callers with a repoRoot MUST pass it so the check is durable; the no-arg
// form falls back to env-only for callers that don't yet know the repo.
export function shouldUseGlobalSkills(repoRoot?: string): boolean {
    if (process.env.XTRM_GLOBAL_SKILLS === '1') return true;
    if (repoRoot && isRepoMigratedSync(repoRoot, { skills: true })) return true;
    return false;
}

export function getGlobalSkillsOverrideRoots(repoRoot?: string): Record<string, string> | undefined {
    if (!shouldUseGlobalSkills(repoRoot)) {
        return undefined;
    }

    const globalSkillsRoot = resolveGlobalSkillsRoot();
    return {
        skills: path.join(globalSkillsRoot, 'default'),
        skills_optional: path.join(globalSkillsRoot, 'optional'),
    };
}
