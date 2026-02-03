import path from 'path';
import fs from 'fs-extra';
import kleur from 'kleur';
import { transformGeminiConfig, transformSkillToCommand } from './transform-gemini.js';

/**
 * Execute a sync plan based on changeset and mode
 */
export async function executeSync(repoRoot, systemRoot, changeSet, mode, actionType) {
    const isClaude = systemRoot.includes('.claude') || systemRoot.includes('Claude');
    const categories = ['skills', 'hooks', 'config'];
    if (!isClaude) categories.push('commands'); // Commands are only managed for Gemini environments
    
    let count = 0;

    const fileMapping = {
        'config/settings.json': { repo: 'config/settings.json', sys: 'settings.json' }
    };

    for (const category of categories) {
        const itemsToProcess = [];

        if (actionType === 'sync') {
            itemsToProcess.push(...changeSet[category].missing);
            itemsToProcess.push(...changeSet[category].outdated);
        } else if (actionType === 'backport') {
            itemsToProcess.push(...changeSet[category].drifted);
        }

        for (const item of itemsToProcess) {
            let src, dest;

            if (category === 'config') {
                const mapping = fileMapping[`config/${item}`] || { repo: `config/${item}`, sys: item };
                if (actionType === 'backport') {
                    src = path.join(systemRoot, mapping.sys);
                    dest = path.join(repoRoot, mapping.repo);
                } else {
                    src = path.join(repoRoot, mapping.repo);
                    dest = path.join(systemRoot, mapping.sys);
                }
            } else if (category === 'commands') {
                // Commands are always in .gemini/commands in repo
                const repoCmdDir = path.join(repoRoot, '.gemini', 'commands');
                if (actionType === 'backport') {
                    src = path.join(systemRoot, category, item);
                    dest = path.join(repoCmdDir, item);
                } else {
                    src = path.join(repoCmdDir, item);
                    dest = path.join(systemRoot, category, item);
                }
            } else {
                const repoPath = path.join(repoRoot, category);
                const systemPath = path.join(systemRoot, category);
                if (actionType === 'backport') {
                    src = path.join(systemPath, item);
                    dest = path.join(repoPath, item);
                } else {
                    src = path.join(repoPath, item);
                    dest = path.join(systemPath, item);
                }
            }

            console.log(kleur.gray(`  ${actionType === 'backport' ? '<--' : '-->'} ${category}/${item}`));

            if (category === 'config' && actionType === 'sync' && fs.existsSync(dest)) {
                await fs.copy(dest, `${dest}.bak`);
                console.log(kleur.gray(`      (Backup created: ${path.basename(dest)}.bak)`));
            }

            if (category === 'config' && item === 'settings.json' && !isClaude && actionType === 'sync') {
                const configContent = await fs.readJson(src);
                const transformedConfig = transformGeminiConfig(configContent, systemRoot);
                await fs.remove(dest);
                await fs.writeJson(dest, transformedConfig, { spaces: 2 });
            } else if (mode === 'symlink' && actionType === 'sync') {
                await fs.remove(dest);
                await fs.ensureSymlink(src, dest);
            } else {
                await fs.remove(dest);
                await fs.copy(src, dest);
            }
            
            // Automatic Skill -> Command transformation for Gemini
            if (category === 'skills' && !isClaude && actionType === 'sync') {
                const skillMdPath = path.join(src, 'SKILL.md');
                if (fs.existsSync(skillMdPath)) {
                    const tomlContent = await transformSkillToCommand(skillMdPath);
                    if (tomlContent) {
                        const commandName = item.endsWith('.skill') ? item.replace('.skill', '') : item;
                        const commandDest = path.join(systemRoot, 'commands', `${commandName}.toml`);
                        await fs.ensureDir(path.dirname(commandDest));
                        await fs.writeFile(commandDest, tomlContent);
                        console.log(kleur.cyan(`      (Auto-generated slash command: /${commandName})`));
                    }
                }
            }
            
            count++;
        }
    }

    return count;
}