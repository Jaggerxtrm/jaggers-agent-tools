import { Command } from 'commander';
import kleur from 'kleur';
import ora from 'ora';
import { execSync } from 'child_process';
import { findRepoRoot } from '../utils/repo-root.js';
import { loadCanonicalMcpConfig, promptOptionalServers, syncMcpServersWithCli, detectAgent } from '../utils/sync-mcp-cli.js';
import path from 'path';

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

            // Load full optional config to access _notes metadata
            const optionalConfig = loadCanonicalMcpConfig(repoRoot, true);
            const filteredConfig: { mcpServers: Record<string, unknown> } = { mcpServers: {} };
            const postInstallMessages: string[] = [];

            for (const serverName of selected) {
                const server = optionalConfig.mcpServers[serverName];
                if (!server) continue;
                filteredConfig.mcpServers[serverName] = server;

                // Run prerequisite install command if defined (hardcoded config value, not user input)
                const installCmd: string | undefined = server._notes?.install_cmd;
                if (installCmd) {
                    const spinner = ora(`Installing prerequisite: ${installCmd}`).start();
                    try {
                        execSync(installCmd, { stdio: 'pipe' });
                        spinner.succeed(kleur.green(`Installed: ${installCmd}`));
                    } catch (err: any) {
                        spinner.fail(kleur.red(`Failed: ${installCmd}`));
                        const stderr = (err.stderr as Buffer | undefined)?.toString() || err.message;
                        console.log(kleur.dim(`  ${stderr.trim()}\n  You may need to run it manually.`));
                    }
                }

                // Collect post-install messages
                const msg: string | undefined = server._notes?.post_install_message;
                if (msg) postInstallMessages.push(`[${serverName}]\n  ${msg}`);
            }

            // Get targets from context
            const { getContext } = await import('../core/context.js');
            const ctx = await getContext();

            // Sync MCP to each target
            for (const target of ctx.targets) {
                const agent = detectAgent(target);
                if (agent) {
                    console.log(kleur.bold(`\n📂 Target: ${path.basename(target)}`));
                    await syncMcpServersWithCli(agent, filteredConfig, false, false);
                }
            }

            console.log(kleur.green('\n✓ Optional MCP servers added successfully\n'));

            // Print post-install guidance
            if (postInstallMessages.length > 0) {
                console.log(kleur.yellow().bold('⚠️  Next Steps Required:\n'));
                for (const msg of postInstallMessages) {
                    console.log(kleur.yellow(msg));
                }
                console.log('');
            }
        });
}
