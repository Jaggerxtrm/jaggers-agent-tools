import path from 'path';
import os from 'os';

export class EnvVarTransformer {
    static transform(value: any, from: string, to: string): any {
        if (from === to) return value;
        if (typeof value === "string") return this.transformString(value, from, to);
        if (Array.isArray(value)) return value.map((item) => this.transform(item, from, to));
        if (value && typeof value === "object") {
            const result: Record<string, any> = {};
            for (const [key, item] of Object.entries(value)) {
                result[key] = this.transform(item, from, to);
            }
            return result;
        }
        return value;
    }

    static transformString(value: string, from: string, to: string): string {
        const normalized = this.toNormalized(value, from);
        return this.fromNormalized(normalized, to);
    }

    static toNormalized(value: string, from: string): string {
        switch (from) {
            case "claude": return value;
            case "cursor": return value.replace(/\$\{env:([A-Za-z0-9_]+)\}/g, "${$1}");
            case "opencode": return value.replace(/\{env:([A-Za-z0-9_]+)\}/g, "${$1}");
            case "gemini": return value;
            case "qwen": return value;
            default: return value;
        }
    }

    static fromNormalized(value: string, to: string): string {
        switch (to) {
            case "claude": return value;
            case "cursor":
                return value.replace(/\$\{([A-Z0-9_]+)\}/g, (match, name) => {
                    if (["workspaceFolder", "userHome"].includes(name)) return match;
                    return `\${env:${name}}`;
                });
            case "opencode":
                return value.replace(/\$\{([A-Z0-9_]+)\}/g, "{env:$1}");
            case "gemini": return value;
            case "qwen": return value;
            default: return value;
        }
    }
}

export class ConfigAdapter {
    systemRoot: string;
    homeDir: string;
    isClaude: boolean;
    isGemini: boolean;
    isQwen: boolean;
    isCursor: boolean;
    isAntigravity: boolean;
    targetFormat: string;
    hooksDir: string;

    constructor(systemRoot: string) {
        this.systemRoot = systemRoot;
        this.homeDir = os.homedir();

        // Normalize path for platform-agnostic matching
        const normalizedRoot = systemRoot.replace(/\\/g, '/').toLowerCase();

        this.isClaude = normalizedRoot.includes('.claude') || normalizedRoot.includes('/claude');
        this.isGemini = normalizedRoot.includes('.gemini') || normalizedRoot.includes('/gemini');
        this.isQwen = normalizedRoot.includes('.qwen') || normalizedRoot.includes('/qwen');
        this.isCursor = normalizedRoot.includes('cursor');
        this.isAntigravity = normalizedRoot.includes('antigravity');

        this.targetFormat = this.isCursor ? 'cursor' :
            this.isAntigravity ? 'antigravity' :
                this.isClaude ? 'claude' :
                    this.isGemini ? 'gemini' :
                        this.isQwen ? 'qwen' : 'claude';

        this.hooksDir = path.join(this.systemRoot, 'hooks');
    }

    adaptMcpConfig(canonicalConfig: any): any {
        if (!canonicalConfig || !canonicalConfig.mcpServers) return {};
        const config = JSON.parse(JSON.stringify(canonicalConfig));

        // Transform Env Vars
        config.mcpServers = EnvVarTransformer.transform(config.mcpServers, 'claude', this.targetFormat);

        // Apply format-specific transformations
        if (this.isGemini || this.isQwen) {
            this.transformToGeminiFormat(config.mcpServers);
        } else if (this.isAntigravity) {
            this.transformToAntigravityFormat(config.mcpServers);
        } else if (this.isClaude) {
            this.transformToClaudeFormat(config.mcpServers);
        }

        // Resolve Paths
        this.resolveMcpPaths(config.mcpServers);

        return config;
    }

    adaptHooksConfig(canonicalHooks: any): any {
        if (!canonicalHooks) return {};
        if (this.isCursor) return { hooks: {} };

        const hooksConfig = JSON.parse(JSON.stringify(canonicalHooks));

        if (this.isGemini) {
            return this.transformToGeminiHooks(hooksConfig);
        }

        this.resolveHookScripts(hooksConfig);
        return hooksConfig;
    }

    resolveMcpPaths(servers: any): void {
        for (const server of Object.values<any>(servers)) {
            if (server.args) server.args = server.args.map((arg: string) => this.resolvePath(arg));
            if (server.cwd) server.cwd = this.resolvePath(server.cwd);
            if (server.env) {
                for (const key in server.env) server.env[key] = this.resolvePath(server.env[key]);
            }
        }
    }

    transformToGeminiFormat(servers: any): void {
        for (const server of Object.values<any>(servers)) {
            delete server.type;
        }
    }

    transformToClaudeFormat(servers: any): void {
        for (const server of Object.values<any>(servers)) {
            if (server.url && !server.type) {
                if (server.url.includes('/sse')) {
                    server.type = 'sse';
                } else {
                    server.type = 'http';
                }
            } else if (server.command && !server.type) {
                server.type = 'stdio';
            }
        }
    }

    transformToAntigravityFormat(servers: any): void {
        for (const [name, server] of Object.entries<any>(servers)) {
            // Ensure type is set
            if (server.url && !server.type) {
                if (server.url.includes('/sse')) {
                    server.type = 'sse';
                } else {
                    server.type = 'http';
                }
            } else if (server.command && !server.type) {
                server.type = 'stdio';
            }

            // Transform url → serverUrl for HTTP/SSE servers
            if (server.url && (server.type === 'http' || server.type === 'sse')) {
                server.serverUrl = server.url;
                delete server.url;
            }
        }
    }

    resolveHookScripts(hooksConfig: any): void {
        if (hooksConfig.hooks) {
            const pythonBin = process.platform === 'win32' ? 'python' : 'python3';

            for (const [event, hooks] of Object.entries(hooksConfig.hooks)) {
                if (Array.isArray(hooks)) {
                    hooks.forEach((hook: any) => {
                        if (hook.script) {
                            hook.type = "command";
                            const resolvedScriptPath = this.resolvePath(path.join(this.hooksDir, hook.script));
                            hook.command = `${pythonBin} ${resolvedScriptPath}`;
                            delete hook.script;
                        }
                    });
                }
            }
        }
        if (hooksConfig.statusLine && hooksConfig.statusLine.script) {
            const pythonBin = process.platform === 'win32' ? 'python' : 'python3';
            hooksConfig.statusLine.type = "command";
            const resolvedScriptPath = this.resolvePath(path.join(this.hooksDir, hooksConfig.statusLine.script));
            hooksConfig.statusLine.command = `${pythonBin} ${resolvedScriptPath}`;
            delete hooksConfig.statusLine.script;
        }
    }

    transformToGeminiHooks(hooksConfig: any): any {
        const geminiHooks: any = { hooks: {} };
        const eventMap: Record<string, string> = {
            'UserPromptSubmit': 'BeforeAgent',
            'PreToolUse': 'BeforeTool',
            'SessionStart': 'SessionStart'
        };
        const toolMap: Record<string, string> = {
            'Read': 'read_file', 'Write': 'write_file', 'Edit': 'replace', 'Bash': 'run_shell_command'
        };

        const pythonBin = process.platform === 'win32' ? 'python' : 'python3';

        for (const [event, hooks] of Object.entries<any[]>(hooksConfig.hooks || {})) {
            const geminiEvent = eventMap[event];
            if (!geminiEvent) continue;
            geminiHooks.hooks[geminiEvent] = hooks.map((hook: any) => {
                const newHook = { ...hook };
                if (newHook.matcher) {
                    for (const [claudeTool, geminiTool] of Object.entries(toolMap)) {
                        newHook.matcher = newHook.matcher.replace(new RegExp(`\\b${claudeTool}\\b`, 'g'), geminiTool);
                    }
                }
                if (newHook.script) {
                    newHook.type = "command";
                    const resolvedScriptPath = this.resolvePath(path.join(this.hooksDir, newHook.script));
                    newHook.command = `${pythonBin} ${resolvedScriptPath}`;
                    delete newHook.script;
                }
                newHook.timeout = newHook.timeout || 60000;
                return newHook;
            });
        }
        return geminiHooks;
    }

    resolvePath(p: string): string {
        if (!p || typeof p !== 'string') return p;
        let resolved = p.replace(/~\//g, this.homeDir + '/').replace(/\${HOME}/g, this.homeDir);

        // Windows compatibility: use forward slashes in config files
        if (process.platform === 'win32') {
            resolved = resolved.replace(/\\/g, '/');
        }

        return resolved;
    }
}
