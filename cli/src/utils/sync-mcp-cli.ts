import { execSync } from 'child_process';
import fs from 'fs-extra';
import path from 'path';
import kleur from 'kleur';
import { ensureEnvFile, loadEnvFile, checkRequiredEnvVars, handleMissingEnvVars, getEnvFilePath } from './env-manager.js';

type AgentName = 'claude' | 'gemini' | 'qwen';

interface AgentCLI {
    command: string;
    listArgs: string[];
    addStdio: (name: string, cmd: string, args?: string[], env?: Record<string, string>) => string[];
    addHttp: (name: string, url: string, headers?: Record<string, string>) => string[];
    addSse: (name: string, url: string) => string[];
    remove: (name: string) => string[];
    parseList: (output: string) => string[];
}

const AGENT_CLI: Record<AgentName, AgentCLI> = {
    claude: {
        command: 'claude',
        listArgs: ['mcp', 'list'],
        addStdio: (name, cmd, args, env) => {
            const base = ['mcp', 'add', '-s', 'user', name, '--'];
            if (env && Object.keys(env).length > 0) {
                for (const [key, value] of Object.entries(env)) {
                    base.push('-e', `${key}=${resolveEnvVar(value)}`);
                }
            }
            base.push(cmd, ...(args || []));
            return base;
        },
        addHttp: (name, url, headers) => {
            const base = ['mcp', 'add', '-s', 'user', '--transport', 'http', name, url];
            if (headers) {
                for (const [key, value] of Object.entries(headers)) {
                    base.push('--header', `${key}: ${resolveEnvVar(value)}`);
                }
            }
            return base;
        },
        addSse: (name, url) => {
            return ['mcp', 'add', '-s', 'user', '--transport', 'sse', name, url];
        },
        remove: (name) => ['mcp', 'remove', '-s', 'user', name],
        parseList: (output) => parseMcpListOutput(output, /^([a-zA-Z0-9_-]+):/)
    },
    gemini: {
        command: 'gemini',
        listArgs: ['mcp', 'list'],
        addStdio: (name, cmd, args, env) => {
            const base = ['mcp', 'add', name, cmd];
            if (args && args.length > 0) base.push(...args);
            if (env && Object.keys(env).length > 0) {
                for (const [key, value] of Object.entries(env)) {
                    base.push('-e', `${key}=${resolveEnvVar(value)}`);
                }
            }
            return base;
        },
        addHttp: (name, url, headers) => {
            const base = ['mcp', 'add', '-t', 'http', name, url];
            if (headers) {
                for (const [key, value] of Object.entries(headers)) {
                    base.push('-H', `${key}=${resolveEnvVar(value)}`);
                }
            }
            return base;
        },
        addSse: (name, url) => {
            return ['mcp', 'add', '-t', 'sse', name, url];
        },
        remove: (name) => ['mcp', 'remove', name],
        parseList: (output) => parseMcpListOutput(output, /^✓ ([a-zA-Z0-9_-]+):/)
    },
    qwen: {
        command: 'qwen',
        listArgs: ['mcp', 'list'],
        addStdio: (name, cmd, args, env) => {
            const base = ['mcp', 'add', name, cmd];
            if (args && args.length > 0) base.push(...args);
            if (env && Object.keys(env).length > 0) {
                for (const [key, value] of Object.entries(env)) {
                    base.push('-e', `${key}=${resolveEnvVar(value)}`);
                }
            }
            return base;
        },
        addHttp: (name, url, headers) => {
            const base = ['mcp', 'add', '-t', 'http', name, url];
            if (headers) {
                for (const [key, value] of Object.entries(headers)) {
                    base.push('-H', `${key}=${resolveEnvVar(value)}`);
                }
            }
            return base;
        },
        addSse: (name, url) => {
            return ['mcp', 'add', '-t', 'sse', name, url];
        },
        remove: (name) => ['mcp', 'remove', name],
        parseList: (output) => parseMcpListOutput(output, /^✓ ([a-zA-Z0-9_-]+):/)
    }
};

function parseMcpListOutput(output: string, pattern: RegExp): string[] {
    const servers: string[] = [];
    for (const line of output.split('\n')) {
        const match = line.match(pattern);
        if (match) {
            servers.push(match[1]);
        }
    }
    return servers;
}

function resolveEnvVar(value: string): string {
    if (typeof value !== 'string') return value;

    const envMatch = value.match(/\$\{([A-Z0-9_]+)\}/i);
    if (envMatch) {
        const envName = envMatch[1];
        const envValue = process.env[envName];
        if (envValue) {
            return envValue;
        } else {
            console.warn(kleur.yellow(`  ⚠️  Environment variable ${envName} is not set in ${getEnvFilePath()}`));
            return '';
        }
    }

    return value;
}

export function detectAgent(systemRoot: string): AgentName | null {
    const normalizedRoot = systemRoot.replace(/\\/g, '/').toLowerCase();
    if (normalizedRoot.includes('.claude') || normalizedRoot.includes('/claude')) {
        return 'claude';
    } else if (normalizedRoot.includes('.gemini') || normalizedRoot.includes('/gemini')) {
        return 'gemini';
    } else if (normalizedRoot.includes('.qwen') || normalizedRoot.includes('/qwen')) {
        return 'qwen';
    }
    return null;
}

function buildAddCommand(agent: AgentName, name: string, server: any): string[] | null {
    const cli = AGENT_CLI[agent];
    if (!cli) return null;

    if (server.url || server.serverUrl) {
        const url = server.url || server.serverUrl;
        const type = server.type || (url.includes('/sse') ? 'sse' : 'http');

        if (type === 'sse') {
            return cli.addSse(name, url);
        } else {
            return cli.addHttp(name, url, server.headers);
        }
    }

    if (server.command) {
        return cli.addStdio(name, server.command, server.args, server.env);
    }

    console.warn(kleur.yellow(`  ⚠️  Skipping server "${name}": Unknown configuration`));
    return null;
}

interface CommandResult {
    success: boolean;
    dryRun?: boolean;
    skipped?: boolean;
    error?: string;
}

function executeCommand(agent: AgentName, args: string[], dryRun: boolean = false): CommandResult {
    const cli = AGENT_CLI[agent];

    const quotedArgs = args.map(arg => {
        if (arg.includes(' ') && !arg.startsWith('"') && !arg.startsWith("'")) {
            return `"${arg}"`;
        }
        return arg;
    });
    const command = `${cli.command} ${quotedArgs.join(' ')}`;

    if (dryRun) {
        console.log(kleur.cyan(`  [DRY RUN] ${command}`));
        return { success: true, dryRun: true };
    }

    try {
        execSync(command, { stdio: 'pipe' });
        console.log(kleur.green(`  ✓ ${args.slice(2).join(' ')}`));
        return { success: true };
    } catch (error: any) {
        const stderr = error.stderr?.toString() || error.message;

        if (stderr.includes('already exists') || stderr.includes('already configured')) {
            let serverName = 'unknown';
            if (agent === 'claude') {
                const addIndex = args.indexOf('add');
                for (let i = addIndex + 1; i < args.length; i++) {
                    const arg = args[i];
                    if (arg === '--') continue;
                    if (arg.startsWith('-')) continue;
                    if (['local', 'user', 'project', 'http', 'sse', 'stdio'].includes(arg)) continue;
                    serverName = arg;
                    break;
                }
            } else if (agent === 'gemini' || agent === 'qwen') {
                const addIndex = args.indexOf('add');
                for (let i = addIndex + 1; i < args.length; i++) {
                    const arg = args[i];
                    if (arg === '-t') { i++; continue; }
                    if (arg.startsWith('-')) continue;
                    if (['http', 'sse', 'stdio'].includes(arg)) continue;
                    serverName = arg;
                    break;
                }
            } else {
                serverName = args[2];
            }
            console.log(kleur.dim(`  ✓ ${serverName} (already configured)`));
            return { success: true, skipped: true };
        }

        console.log(kleur.red(`  ✗ Failed: ${stderr.trim()}`));
        return { success: false, error: stderr };
    }
}

function getCurrentServers(agent: AgentName): string[] {
    const cli = AGENT_CLI[agent];
    try {
        const output = execSync(`${cli.command} ${cli.listArgs.join(' ')}`, {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'ignore']
        });
        return cli.parseList(output);
    } catch (error) {
        return [];
    }
}

/**
 * Sync MCP servers to an agent using official CLI
 */
export async function syncMcpServersWithCli(
    agent: AgentName,
    mcpConfig: any,
    dryRun: boolean = false,
    prune: boolean = false
): Promise<void> {
    const cli = AGENT_CLI[agent];
    if (!cli) {
        console.log(kleur.yellow(`  ⚠️  Unsupported agent: ${agent}`));
        return;
    }

    console.log(kleur.bold(`\nSyncing MCP servers to ${agent}...`));

    ensureEnvFile();
    loadEnvFile();

    const missingEnvVars = checkRequiredEnvVars();
    if (missingEnvVars.length > 0) {
        handleMissingEnvVars(missingEnvVars);
    }

    const currentServers = getCurrentServers(agent);
    const canonicalServers = new Set(Object.keys(mcpConfig.mcpServers || {}));

    if (prune) {
        console.log(kleur.red('\n  Prune mode: Removing servers not in canonical config...'));
        for (const serverName of currentServers) {
            if (!canonicalServers.has(serverName)) {
                console.log(kleur.red(`  Removing: ${serverName}`));
                executeCommand(agent, cli.remove(serverName), dryRun);
            }
        }
    }

    console.log(kleur.cyan('\n  Adding/Updating canonical servers...'));
    let successCount = 0;

    for (const [name, server] of Object.entries(mcpConfig.mcpServers)) {
        const cmd = buildAddCommand(agent, name, server);
        if (cmd) {
            const result = executeCommand(agent, cmd, dryRun);
            if (result.success) {
                successCount++;
            }
        }
    }

    console.log(kleur.green(`\n  ✓ Synced ${successCount} MCP servers`));
}

/**
 * Load canonical MCP config from repository
 */
export function loadCanonicalMcpConfig(repoRoot: string): any {
    const corePath = path.join(repoRoot, 'config', 'mcp_servers.json');

    const config: any = { mcpServers: {} };

    if (fs.existsSync(corePath)) {
        const core = fs.readJsonSync(corePath);
        config.mcpServers = { ...config.mcpServers, ...core.mcpServers };
    }

    return config;
}
