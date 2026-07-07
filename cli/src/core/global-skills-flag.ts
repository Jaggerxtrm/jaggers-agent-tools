import path from 'node:path';
import { resolveGlobalSkillsRoot } from './skills-layout.js';

export function shouldUseGlobalSkills(): boolean {
    return process.env.XTRM_GLOBAL_SKILLS === '1';
}

export function getGlobalSkillsOverrideRoots(): Record<string, string> | undefined {
    if (!shouldUseGlobalSkills()) {
        return undefined;
    }

    const globalSkillsRoot = resolveGlobalSkillsRoot();
    return {
        skills: path.join(globalSkillsRoot, 'default'),
        skills_optional: path.join(globalSkillsRoot, 'optional'),
    };
}
