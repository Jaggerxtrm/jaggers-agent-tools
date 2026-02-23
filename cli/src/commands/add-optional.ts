import { Command } from 'commander';
import kleur from 'kleur';
import ora from 'ora';
import { findRepoRoot } from '../utils/repo-root.js';
import { loadCanonicalMcpConfig, promptOptionalServers, syncMcpServersWithCli, detectAgent } from '../utils/sync-mcp-cli.js';
import path from 'path';
import fs from 'fs-extra';

export function createAddOptionalCommand(): Command {
    return new Command('add-optional')
        .description('Add optional MCP servers (unitAI, omni-search-engine, etc.)')
        .action(async () => {
            const repoRoot = await findRepoRoot();
            
            console.log(kleur.cyan().bold('\nAdding Optional MCP Servers\n'));
            
            // Prompt for which optional servers to install
            const selected = await promptOptionalServers(repoRoot);
            
            if (!selected || selected.length === 0) {
                console.log(kleur.gray('  No optional servers selected.\n'));
                return;
            }
            
            console.log(kleur.green(`\n  Selected: ${selected.join(', ')}\n`));
            
            // Load only the selected optional servers
            const optionalConfig = loadCanonicalMcpConfig(repoRoot, true);
            const filteredConfig: any = { mcpServers: {} };
            
            for (const serverName of selected) {
                if (optionalConfig.mcpServers[serverName]) {
                    filteredConfig.mcpServers[serverName] = optionalConfig.mcpServers[serverName];
                }
            }
            
            // Get targets from context
            const { getContext } = await import('../core/context.js');
            const ctx = await getContext();
            
            // Sync to each target
            for (const target of ctx.targets) {
                const agent = detectAgent(target);
                if (agent) {
                    console.log(kleur.bold(`\n📂 Target: ${path.basename(target)}`));
                    await syncMcpServersWithCli(agent, filteredConfig, false, false);
                }
            }
            
            console.log(kleur.green('\n✓ Optional MCP servers added successfully\n'));
        });
}
