import path from 'path';
import fs from 'fs-extra';
import kleur from 'kleur';
import { transformGeminiConfig, transformSkillToCommand } from './transform-gemini.js';
import { safeMergeConfig } from './atomic-config.js';  // Import the new atomic config handler

/**
 * Execute a sync plan based on changeset and mode
 */
export async function executeSync(repoRoot, systemRoot, changeSet, mode, actionType, isDryRun = false) {
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
        // Use the safe merge for config files to preserve protected keys
        if (item === 'settings.json') {
          const repoConfig = await fs.readJson(src);

          // FIX: Resolve paths to match current target environment
          // This fixes hardcoded paths (e.g. /home/dawid/...) from the repo
          let finalRepoConfig = resolveConfigPaths(repoConfig, systemRoot);

          // Transform config for Gemini if needed
          if (!isClaude) {
            finalRepoConfig = transformGeminiConfig(finalRepoConfig, systemRoot);
          }

          // Use safe merge to preserve protected keys in local config
          const mergeResult = await safeMergeConfig(dest, finalRepoConfig, {
            backupOnSuccess: true,
            preserveComments: true,
            dryRun: isDryRun
          });

          if (mergeResult.updated) {
            console.log(kleur.blue(`      (Configuration safely merged with protected keys preserved)`));

            // Report specific changes
            if (mergeResult.changes.length > 0) {
              for (const change of mergeResult.changes) {
                if (isDryRun) {
                  console.log(kleur.yellow(`      (DRY RUN: ${change})`));
                } else {
                  console.log(kleur.green(`      (${change})`));
                }
              }
            }
          } else {
            console.log(kleur.gray(`      (No changes needed for configuration)`));
          }
        } else {
          // For other config files, use the original approach
          if (!isDryRun) {
            await fs.copy(dest, `${dest}.bak`);
          }
          console.log(kleur.gray(`      (Backup created: ${path.basename(dest)}.bak)`));

          if (!isDryRun) {
            await fs.copy(src, dest);
          }
        }
      } else if (category === 'config' && item === 'settings.json' && !isClaude && actionType === 'sync') {
        const configContent = await fs.readJson(src);
        
        // Resolve paths here too for non-merging case (e.g. first install)
        let transformedConfig = resolveConfigPaths(configContent, systemRoot);
        transformedConfig = transformGeminiConfig(transformedConfig, systemRoot);

        if (!isDryRun) {
          await fs.remove(dest);
          await fs.writeJson(dest, transformedConfig, { spaces: 2 });
        }
      } else if (mode === 'symlink' && actionType === 'sync') {
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

      // Automatic Skill -> Command transformation for Gemini
      if (category === 'skills' && !isClaude && actionType === 'sync') {
        const skillMdPath = path.join(src, 'SKILL.md');
        if (fs.existsSync(skillMdPath)) {
          const result = await transformSkillToCommand(skillMdPath);
          if (result) {
            const { toml, commandName } = result;
            const commandDest = path.join(systemRoot, 'commands', `${commandName}.toml`);

            if (!isDryRun) {
              await fs.ensureDir(path.dirname(commandDest));
              await fs.writeFile(commandDest, toml);
            }
            console.log(kleur.cyan(`      (Auto-generated slash command: /${commandName})`));
          }
        }
      }

      count++;
    }
  }

  return count;
}

/**
 * Recursively resolves paths in the config to match the target directory
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