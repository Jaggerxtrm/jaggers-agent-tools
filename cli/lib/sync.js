import path from 'path';
import fs from 'fs-extra';
import kleur from 'kleur';
import { transformGeminiConfig, transformSkillToCommand } from './transform-gemini.js';
import { safeMergeConfig } from './atomic-config.js';
import { ConfigAdapter } from './config-adapter.js';

/**
 * Execute a sync plan based on changeset and mode
 */
export async function executeSync(repoRoot, systemRoot, changeSet, mode, actionType, isDryRun = false) {
  const isClaude = systemRoot.includes('.claude') || systemRoot.includes('Claude');
  const isQwen = systemRoot.includes('.qwen') || systemRoot.includes('Qwen');
  const isGemini = systemRoot.includes('.gemini') || systemRoot.includes('Gemini');
  const categories = ['skills', 'hooks', 'config'];
  
  if (isQwen) {
    categories.push('qwen-commands');
  } else if (isGemini) {
    categories.push('commands', 'antigravity-workflows');
  } else if (!isClaude) {
    categories.push('commands');
  }

  let count = 0;
  const adapter = new ConfigAdapter(systemRoot);

  for (const category of categories) {
    const itemsToProcess = [];

    if (actionType === 'sync') {
      itemsToProcess.push(...changeSet[category].missing);
      itemsToProcess.push(...changeSet[category].outdated);
      
      // PRUNE: Handle removals from system if no longer in repo
      if (mode === 'prune') {
        for (const itemToDelete of changeSet[category].drifted || []) {
           const dest = path.join(systemRoot, category, itemToDelete);
           console.log(kleur.red(`  [x] PRUNING ${category}/${itemToDelete}`));
           if (!isDryRun) await fs.remove(dest);
           count++;
        }
      }
    } else if (actionType === 'backport') {
      itemsToProcess.push(...changeSet[category].drifted);
    }

    for (const item of itemsToProcess) {
      let src, dest;

      if (category === 'config' && item === 'settings.json' && actionType === 'sync') {
        src = path.join(repoRoot, 'config', 'settings.json');
        dest = path.join(systemRoot, 'settings.json');
        
        console.log(kleur.gray(`  --> config/settings.json`));

        const repoConfig = await fs.readJson(src);
        let finalRepoConfig = resolveConfigPaths(repoConfig, systemRoot);

        if (!isClaude) {
          finalRepoConfig = transformGeminiConfig(finalRepoConfig, systemRoot);
        }
        
        // Inject MCP Servers
        const mcpSrc = path.join(repoRoot, 'config', 'mcp_servers.json');
        if (await fs.pathExists(mcpSrc)) {
          const mcpRaw = await fs.readJson(mcpSrc);
          const mcpAdapted = adapter.adaptMcpConfig(mcpRaw);
          if (mcpAdapted.mcpServers) {
            finalRepoConfig.mcpServers = { ...(finalRepoConfig.mcpServers || {}), ...mcpAdapted.mcpServers };
            if (!isDryRun) console.log(kleur.dim(`      (Injected MCP servers)`));
          }
        }

        // Inject Hooks
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

          // Handle PRUNE mode for mcpServers and hooks
          if (mode === 'prune') {
            // Remove local MCP servers NOT in our canonical source
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
            backupOnSuccess: true,
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

      if (mode === 'symlink' && actionType === 'sync' && category !== 'config') {
        if (!isDryRun) {
          await fs.remove(dest);
          await fs.ensureSymlink(src, dest);
        }
      } else {
        if (!isDryRun) {
          await fs.remove(dest);
          await fs.copy(src, dest);
        }
      }

      // Gemini Skill -> Command transformation
      if (category === 'skills' && !isClaude && actionType === 'sync') {
        const skillMdPath = path.join(src, 'SKILL.md');
        if (fs.existsSync(skillMdPath)) {
          const result = await transformSkillToCommand(skillMdPath);
          if (result && !isDryRun) {
            const commandDest = path.join(systemRoot, 'commands', `${result.commandName}.toml`);
            await fs.ensureDir(path.dirname(commandDest));
            await fs.writeFile(commandDest, result.toml);
            console.log(kleur.cyan(`      (Auto-generated slash command: /${result.commandName})`));
          }
        }
      }

      count++;
    }
  }

  // Final Step: Write Sync Manifest
  if (!isDryRun && actionType === 'sync') {
    const manifestPath = path.join(systemRoot, '.jaggers-sync-manifest.json');
    const manifest = {
        lastSync: new Date().toISOString(),
        repoRoot,
        items: count
    };
    await fs.writeJson(manifestPath, manifest, { spaces: 2 });
  }

  return count;
}

/**
 * Recursively resolves paths in the config to match the target directory
 *
 * This function corrects hardcoded paths (e.g. /home/dawid/...) to match the current user's home directory.
 * It's applied to both repository config AND local config to ensure existing installations get updated.
 *
 * @param {Object} config - The configuration object to process
 * @param {string} targetDir - The target directory (e.g. /home/jagger/.claude)
 * @returns {Object} - New config object with resolved paths
 */
function resolveConfigPaths(config, targetDir) {
  const newConfig = JSON.parse(JSON.stringify(config));

  function recursiveReplace(obj) {
    for (const key in obj) {
      if (typeof obj[key] === 'string') {
        // Match absolute paths containing /hooks/ and replace the prefix with targetDir/hooks
        if (obj[key].match(/\/[^\s"']+\/hooks\//)) {
           const hooksDir = path.join(targetDir, 'hooks');
           obj[key] = obj[key].replace(/(\/[^\s"']+\/hooks\/)/g, `${hooksDir}/`);
        }
      } else if (typeof obj[key] === 'object' && obj[key] !== null) {
        recursiveReplace(obj[key]);
      }
    }
  }

  recursiveReplace(newConfig);
  return newConfig;
}