import path from 'path';
import fs from 'fs-extra';
import kleur from 'kleur';
import { transformGeminiConfig, transformSkillToCommand } from '../utils/transform-gemini.js';
import { safeMergeConfig } from '../utils/atomic-config.js';
import { ConfigAdapter } from '../utils/config-adapter.js';
import { syncMcpServersWithCli, loadCanonicalMcpConfig, detectAgent, promptOptionalServers } from '../utils/sync-mcp-cli.js';
import { createBackup, restoreBackup, cleanupBackup, type BackupInfo } from './rollback.js';
import type { ChangeSet } from '../types/config.js';

/**
 * Execute a sync plan based on changeset and mode
 */
export async function executeSync(
    repoRoot: string,
    systemRoot: string,
    changeSet: ChangeSet,
    mode: 'copy' | 'symlink' | 'prune',
    actionType: 'sync' | 'backport',
    isDryRun: boolean = false
): Promise<number> {
    const isClaude = systemRoot.includes('.claude') || systemRoot.includes('Claude');
    const isQwen = systemRoot.includes('.qwen') || systemRoot.includes('Qwen');
    const isGemini = systemRoot.includes('.gemini') || systemRoot.includes('Gemini');

    const categories: Array<keyof ChangeSet> = ['skills', 'hooks', 'config'];

    if (isQwen) categories.push('qwen-commands');
    else if (isGemini) categories.push('commands', 'antigravity-workflows');
    else if (!isClaude) categories.push('commands');

    let count = 0;
    const adapter = new ConfigAdapter(systemRoot);
    const backups: BackupInfo[] = [];

    try {
        const agent = detectAgent(systemRoot);
        if (agent && actionType === 'sync') {
            console.log(kleur.gray(`  --> ${agent} MCP servers (via ${agent} mcp CLI)`));
            
            // Check if optional servers prompt was already shown
            const manifestPath = path.join(systemRoot, '.jaggers-sync-manifest.json');
            let manifest: any = {};
            if (await fs.pathExists(manifestPath)) {
                manifest = await fs.readJson(manifestPath);
            }
            
            const wasOptionalPromptShown = manifest.optionalServersPrompted || false;
            
            // Prompt for optional servers if not shown yet
            let includeOptional = false;
            let selectedOptionalServers: string[] = [];
            
            if (!wasOptionalPromptShown) {
                const selected = await promptOptionalServers(repoRoot);
                if (selected && Array.isArray(selected)) {
                    includeOptional = selected.length > 0;
                    selectedOptionalServers = selected;
                }
                // Mark that prompt was shown (even if user declined)
                manifest.optionalServersPrompted = true;
            }
            
            const canonicalConfig = loadCanonicalMcpConfig(repoRoot, includeOptional);
            
            // If user selected specific optional servers, filter to only those
            if (selectedOptionalServers.length > 0 && canonicalConfig.mcpServers) {
                const filteredServers: any = {};
                const coreServers = fs.readJsonSync(path.join(repoRoot, 'config', 'mcp_servers.json')).mcpServers;
                for (const [name, server] of Object.entries(canonicalConfig.mcpServers)) {
                    // Include all core servers + selected optional ones
                    if (coreServers[name] || selectedOptionalServers.includes(name)) {
                        filteredServers[name] = server;
                    }
                }
                canonicalConfig.mcpServers = filteredServers;
            }
            
            await syncMcpServersWithCli(agent, canonicalConfig, isDryRun, mode === 'prune');
            count++;
            
            // Update manifest to track that prompt was shown
            if (!isDryRun) {
                await fs.writeJson(manifestPath, manifest, { spaces: 2 });
            }
        }

        for (const category of categories) {
            const itemsToProcess: string[] = [];

            if (actionType === 'sync') {
                const cat = changeSet[category] as any;
                itemsToProcess.push(...cat.missing);
                itemsToProcess.push(...cat.outdated);

                // PRUNE: Handle removals from system if no longer in repo
                if (mode === 'prune') {
                    for (const itemToDelete of cat.drifted || []) {
                        const dest = path.join(systemRoot, category, itemToDelete);
                        console.log(kleur.red(`  [x] PRUNING ${category}/${itemToDelete}`));
                        if (!isDryRun) {
                            if (await fs.pathExists(dest)) {
                                backups.push(await createBackup(dest));
                                await fs.remove(dest);
                            }
                        }
                        count++;
                    }
                }
            } else if (actionType === 'backport') {
                const cat = changeSet[category] as any;
                itemsToProcess.push(...cat.drifted);
            }

            for (const item of itemsToProcess) {
                let src: string, dest: string;

                if (category === 'config' && item === 'settings.json' && actionType === 'sync') {
                    src = path.join(repoRoot, 'config', 'settings.json');
                    dest = path.join(systemRoot, 'settings.json');

                    console.log(kleur.gray(`  --> config/settings.json`));

                    if (agent) {
                        console.log(kleur.gray(`  (Skipped: ${agent} uses ${agent} mcp CLI for MCP servers)`));
                        count++;
                        continue;
                    }

                    if (!isDryRun && await fs.pathExists(dest)) {
                        backups.push(await createBackup(dest));
                    }

                    const repoConfig = await fs.readJson(src);
                    let finalRepoConfig = resolveConfigPaths(repoConfig, systemRoot);

                    const hooksSrc = path.join(repoRoot, 'config', 'hooks.json');
                    if (await fs.pathExists(hooksSrc)) {
                        const hooksRaw = await fs.readJson(hooksSrc);
                        const hooksAdapted = adapter.adaptHooksConfig(hooksRaw);
                        if (hooksAdapted.hooks) {
                            finalRepoConfig.hooks = { ...(finalRepoConfig.hooks || {}), ...hooksAdapted.hooks };
                            if (!isDryRun) console.log(kleur.dim(`      (Injected hooks)`));
                        }
                    }

                    if (fs.existsSync(dest)) {
                        const localConfig = await fs.readJson(dest);
                        const resolvedLocalConfig = resolveConfigPaths(localConfig, systemRoot);

                        if (mode === 'prune') {
                            if (localConfig.mcpServers && finalRepoConfig.mcpServers) {
                                const canonicalServers = new Set(Object.keys(finalRepoConfig.mcpServers));
                                for (const serverName of Object.keys(localConfig.mcpServers)) {
                                    if (!canonicalServers.has(serverName)) {
                                        delete localConfig.mcpServers[serverName];
                                        if (!isDryRun) console.log(kleur.red(`      (Pruned local MCP server: ${serverName})`));
                                    }
                                }
                            }
                        }

                        const mergeResult = await safeMergeConfig(dest, finalRepoConfig, {
                            backupOnSuccess: false, // Handled by our own rollback system
                            preserveComments: true,
                            dryRun: isDryRun,
                            resolvedLocalConfig: resolvedLocalConfig
                        });

                        if (mergeResult.updated) {
                            console.log(kleur.blue(`      (Configuration safely merged)`));
                        }
                    } else {
                        if (!isDryRun) {
                            await fs.ensureDir(path.dirname(dest));
                            await fs.writeJson(dest, finalRepoConfig, { spaces: 2 });
                        }
                        console.log(kleur.green(`      (Created new configuration)`));
                    }
                    count++;
                    continue;
                }

                // Standard file sync for other items
                const repoPath = category === 'commands' ? path.join(repoRoot, '.gemini', 'commands') :
                    category === 'qwen-commands' ? path.join(repoRoot, '.qwen', 'commands') :
                        category === 'antigravity-workflows' ? path.join(repoRoot, '.gemini', 'antigravity', 'global_workflows') :
                            path.join(repoRoot, category);

                const systemPath = category === 'qwen-commands' ? path.join(systemRoot, 'commands') :
                    category === 'antigravity-workflows' ? path.join(systemRoot, '.gemini', 'antigravity', 'global_workflows') :
                        path.join(systemRoot, category);

                if (actionType === 'backport') {
                    src = path.join(systemPath, item);
                    dest = path.join(repoPath, item);
                } else {
                    src = path.join(repoPath, item);
                    dest = path.join(systemPath, item);
                }

                console.log(kleur.gray(`  ${actionType === 'backport' ? '<--' : '-->'} ${category}/${item}`));

                if (!isDryRun && actionType === 'sync' && await fs.pathExists(dest)) {
                    backups.push(await createBackup(dest));
                }

                if (mode === 'symlink' && actionType === 'sync' && category !== 'config') {
                    if (!isDryRun) {
                        if (process.platform === 'win32') {
                            console.log(kleur.yellow('  ⚠ Symlinks require Developer Mode on Windows — falling back to copy.'));
                            await fs.remove(dest);
                            await fs.copy(src, dest);
                        } else {
                            await fs.remove(dest);
                            await fs.ensureSymlink(src, dest);
                        }
                    }
                } else {
                    if (!isDryRun) {
                        await fs.remove(dest);
                        await fs.copy(src, dest);
                    }
                }

                if (category === 'skills' && !isClaude && actionType === 'sync') {
                    const skillMdPath = path.join(src, 'SKILL.md');
                    if (fs.existsSync(skillMdPath)) {
                        const result = await transformSkillToCommand(skillMdPath);
                        if (result && !isDryRun) {
                            const commandDest = path.join(systemRoot, 'commands', `${result.commandName}.toml`);

                            if (await fs.pathExists(commandDest)) {
                                backups.push(await createBackup(commandDest));
                            }

                            await fs.ensureDir(path.dirname(commandDest));
                            await fs.writeFile(commandDest, result.toml);
                            console.log(kleur.cyan(`      (Auto-generated slash command: /${result.commandName})`));
                        }
                    }
                }

                count++;
            }
        }

        if (!isDryRun && actionType === 'sync') {
            const manifestPath = path.join(systemRoot, '.jaggers-sync-manifest.json');
            const manifest = {
                lastSync: new Date().toISOString(),
                repoRoot,
                items: count
            };
            await fs.writeJson(manifestPath, manifest, { spaces: 2 });
        }

        // Cleanup backups on success
        for (const backup of backups) {
            await cleanupBackup(backup);
        }

        return count;

    } catch (error: any) {
        console.error(kleur.red(`\nSync failed, rolling back ${backups.length} changes...`));
        for (const backup of backups) {
            await restoreBackup(backup);
            await cleanupBackup(backup);
        }
        throw error;
    }
}

function resolveConfigPaths(config: any, targetDir: string): any {
    const newConfig = JSON.parse(JSON.stringify(config));

    function recursiveReplace(obj: any) {
        for (const key in obj) {
            if (typeof obj[key] === 'string') {
                if (obj[key].match(/\/[^\s"']+\/hooks\//)) {
                    const hooksDir = path.join(targetDir, 'hooks');
                    let replacementDir = `${hooksDir}/`;

                    if (process.platform === 'win32') {
                        replacementDir = replacementDir.replace(/\\/g, '/');
                    }

                    obj[key] = obj[key].replace(/(\/[^\s"']+\/hooks\/)/g, replacementDir);
                }
            } else if (typeof obj[key] === 'object' && obj[key] !== null) {
                recursiveReplace(obj[key]);
            }
        }
    }

    recursiveReplace(newConfig);
    return newConfig;
}
