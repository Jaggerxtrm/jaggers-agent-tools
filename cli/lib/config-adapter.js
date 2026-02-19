import path from 'path';
import os from 'os';

export class EnvVarTransformer {
  static transform(value, from, to) {
    if (from === to) return value;
    if (typeof value === "string") return this.transformString(value, from, to);
    if (Array.isArray(value)) return value.map((item) => this.transform(item, from, to));
    if (value && typeof value === "object") {
      const result = {};
      for (const [key, item] of Object.entries(value)) {
        result[key] = this.transform(item, from, to);
      }
      return result;
    }
    return value;
  }

  static transformString(value, from, to) {
    const normalized = this.toNormalized(value, from);
    return this.fromNormalized(normalized, to);
  }

  static toNormalized(value, from) {
    switch (from) {
      case "claude": return value;
      case "cursor": return value.replace(/\$\{env:([A-Za-z0-9_]+)\}/g, "${$1}");
      case "opencode": return value.replace(/\{env:([A-Za-z0-9_]+)\}/g, "${$1}");
      default: return value;
    }
  }

  static fromNormalized(value, to) {
    switch (to) {
      case "claude": return value;
      case "cursor":
        return value.replace(/\$\{([A-Z0-9_]+)\}/g, (match, name) => {
          if (["workspaceFolder", "userHome"].includes(name)) return match;
          return `\${env:${name}}`;
        });
      case "opencode":
        return value.replace(/\$\{([A-Z0-9_]+)\}/g, "{env:$1}");
      default: return value;
    }
  }
}

export class ConfigAdapter {
  constructor(systemRoot) {
    this.systemRoot = systemRoot;
    this.homeDir = os.homedir();
    this.isClaude = systemRoot.includes('.claude') || systemRoot.includes('Claude');
    this.isGemini = systemRoot.includes('.gemini') || systemRoot.includes('Gemini');
    this.isCursor = systemRoot.toLowerCase().includes('cursor');
    
    this.targetFormat = this.isCursor ? 'cursor' : (this.isClaude ? 'claude' : 'claude');
    this.hooksDir = path.join(this.systemRoot, 'hooks');
  }

  adaptMcpConfig(canonicalConfig) {
    if (!canonicalConfig || !canonicalConfig.mcpServers) return {};
    const config = JSON.parse(JSON.stringify(canonicalConfig));
    
    // Transform Env Vars
    config.mcpServers = EnvVarTransformer.transform(config.mcpServers, 'claude', this.targetFormat);
    
    // Resolve Paths
    this.resolveMcpPaths(config.mcpServers);

    return config;
  }

  adaptHooksConfig(canonicalHooks) {
    if (!canonicalHooks) return {};
    if (this.isCursor) return { hooks: {} }; 

    const hooksConfig = JSON.parse(JSON.stringify(canonicalHooks));

    if (this.isGemini) {
      return this.transformToGeminiHooks(hooksConfig);
    }

    this.resolveHookScripts(hooksConfig);
    return hooksConfig;
  }

  resolveMcpPaths(servers) {
    for (const server of Object.values(servers)) {
      if (server.args) server.args = server.args.map(arg => this.resolvePath(arg));
      if (server.cwd) server.cwd = this.resolvePath(server.cwd);
      if (server.env) {
        for (const key in server.env) server.env[key] = this.resolvePath(server.env[key]);
      }
    }
  }

  resolveHookScripts(hooksConfig) {
    if (hooksConfig.hooks) {
      for (const [event, hooks] of Object.entries(hooksConfig.hooks)) {
        if (Array.isArray(hooks)) {
            hooks.forEach(hook => {
                if (hook.script) {
                  hook.type = "command";
                  hook.command = path.join(this.hooksDir, hook.script);
                  delete hook.script;
                }
            });
        }
      }
    }
    if (hooksConfig.statusLine && hooksConfig.statusLine.script) {
        hooksConfig.statusLine.type = "command";
        hooksConfig.statusLine.command = path.join(this.hooksDir, hooksConfig.statusLine.script);
        delete hooksConfig.statusLine.script;
    }
  }

  transformToGeminiHooks(hooksConfig) {
    const geminiHooks = { hooks: {} };
    const eventMap = {
      'UserPromptSubmit': 'BeforeAgent',
      'PreToolUse': 'BeforeTool',
      'SessionStart': 'SessionStart'
    };
    const toolMap = { 'Read': 'read_file', 'Write': 'write_file', 'Edit': 'replace', 'Bash': 'run_shell_command' };

    for (const [event, hooks] of Object.entries(hooksConfig.hooks)) {
      const geminiEvent = eventMap[event];
      if (!geminiEvent) continue;
      geminiHooks.hooks[geminiEvent] = hooks.map(hook => {
          const newHook = { ...hook };
          if (newHook.matcher) {
             for (const [claudeTool, geminiTool] of Object.entries(toolMap)) {
                 newHook.matcher = newHook.matcher.replace(new RegExp(`\\b${claudeTool}\\b`, 'g'), geminiTool);
             }
          }
          if (newHook.script) {
             newHook.type = "command";
             newHook.command = path.join(this.hooksDir, newHook.script);
             delete newHook.script;
          }
          newHook.timeout = newHook.timeout || 60000;
          return newHook;
      });
    }
    return geminiHooks;
  }

  resolvePath(p) {
    if (!p || typeof p !== 'string') return p;
    return p.replace(/~\//g, this.homeDir + '/').replace(/\${HOME}/g, this.homeDir);
  }
}
