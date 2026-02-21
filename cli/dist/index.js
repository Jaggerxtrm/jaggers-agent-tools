#!/usr/bin/env node

// src/index.ts
import { Command as Command4 } from "commander";

// src/commands/sync.ts
import { Command } from "commander";
import kleur5 from "kleur";
import prompts2 from "prompts";

// src/core/context.ts
import os from "os";
import path from "path";
import fs from "fs-extra";
import Conf from "conf";
import prompts from "prompts";
import kleur from "kleur";
var config = new Conf({
  projectName: "jaggers-config-manager",
  defaults: {
    syncMode: "copy"
  }
});
function getCandidatePaths() {
  const home = os.homedir();
  const appData = process.env.APPDATA;
  const isWindows = process.platform === "win32";
  const paths = [
    { label: ".claude", path: path.join(home, ".claude") },
    { label: ".gemini", path: path.join(home, ".gemini") },
    { label: ".qwen", path: path.join(home, ".qwen") },
    { label: "~/.gemini/antigravity", path: path.join(home, ".gemini", "antigravity") }
  ];
  if (isWindows && appData) {
    paths.push({ label: "Claude (AppData)", path: path.join(appData, "Claude") });
  }
  return paths;
}
async function getContext() {
  const choices = [];
  const candidates = getCandidatePaths();
  for (const c of candidates) {
    const exists = await fs.pathExists(c.path);
    const icon = exists ? "[X]" : "[ ]";
    const desc = exists ? "Found" : "Not found (will create)";
    choices.push({
      title: `${icon} ${c.label} (${c.path})`,
      description: desc,
      value: c.path,
      selected: exists
      // Pre-select existing environments
    });
  }
  const response = await prompts({
    type: "multiselect",
    name: "targets",
    message: "Select target environment(s):",
    choices,
    hint: "- Space to select. Return to submit",
    instructions: false
  });
  if (!response.targets || response.targets.length === 0) {
    console.log(kleur.gray("No targets selected. Exiting."));
    process.exit(0);
  }
  for (const target of response.targets) {
    await fs.ensureDir(target);
  }
  return {
    targets: response.targets,
    syncMode: config.get("syncMode"),
    config
  };
}
function resetContext() {
  config.clear();
  console.log(kleur.yellow("Configuration cleared."));
}

// src/core/diff.ts
import { join as join5 } from "path";
import fs3 from "fs-extra";

// src/utils/hash.ts
import { createHash } from "crypto";
import fs2 from "fs-extra";
import { join } from "path";
async function hashFile(filePath) {
  const content = await fs2.readFile(filePath);
  return createHash("md5").update(content).digest("hex");
}
async function hashDirectory(dirPath) {
  if (!await fs2.pathExists(dirPath)) return "";
  const stats = await fs2.stat(dirPath);
  if (!stats.isDirectory()) {
    return hashFile(dirPath);
  }
  const children = await fs2.readdir(dirPath);
  const childHashes = await Promise.all(
    children.sort().map(async (child) => {
      const h = await hashDirectory(join(dirPath, child));
      return `${child}:${h}`;
    })
  );
  return createHash("md5").update(childHashes.join("|")).digest("hex");
}
async function getNewestMtime(targetPath) {
  if (!await fs2.pathExists(targetPath)) return 0;
  const stats = await fs2.stat(targetPath);
  let maxTime = stats.mtimeMs;
  if (stats.isDirectory()) {
    const children = await fs2.readdir(targetPath);
    for (const child of children) {
      const childTime = await getNewestMtime(join(targetPath, child));
      if (childTime > maxTime) maxTime = childTime;
    }
  }
  return maxTime;
}

// src/adapters/claude.ts
import { join as join2 } from "path";

// src/adapters/base.ts
var ToolAdapter = class {
};

// src/adapters/claude.ts
var ClaudeAdapter = class extends ToolAdapter {
  toolName = "claude-code";
  displayName = "Claude Code";
  config;
  constructor(baseDir) {
    super();
    this.config = { tool: this.toolName, baseDir, displayName: this.displayName };
  }
  getConfigDir() {
    return this.config.baseDir;
  }
  getSkillsDir() {
    return join2(this.config.baseDir, "skills");
  }
  getHooksDir() {
    return join2(this.config.baseDir, "hooks");
  }
  getCommandsDir() {
    return join2(this.config.baseDir, "commands");
  }
  getCapabilities() {
    return {
      skills: true,
      hooks: true,
      mcp: true,
      commands: false
      // Claude uses Skills instead of Slash Commands natively
    };
  }
};

// src/adapters/gemini.ts
import { join as join3 } from "path";
var GeminiAdapter = class extends ToolAdapter {
  toolName = "gemini";
  displayName = "Gemini";
  config;
  constructor(baseDir) {
    super();
    this.config = { tool: this.toolName, baseDir, displayName: this.displayName };
  }
  getConfigDir() {
    return this.config.baseDir;
  }
  getSkillsDir() {
    return join3(this.config.baseDir, "skills");
  }
  getHooksDir() {
    return join3(this.config.baseDir, "hooks");
  }
  getCommandsDir() {
    if (this.config.baseDir.includes("antigravity")) {
      return join3(this.config.baseDir, "global_workflows");
    }
    return join3(this.config.baseDir, "commands");
  }
  getCapabilities() {
    return {
      skills: true,
      hooks: true,
      // Gemini supports PreToolUse -> BeforeTool via our wrapper
      mcp: true,
      commands: true
      // Auto-generates commands from skills
    };
  }
};

// src/adapters/qwen.ts
import { join as join4 } from "path";
var QwenAdapter = class extends ToolAdapter {
  toolName = "qwen";
  displayName = "Qwen";
  config;
  constructor(baseDir) {
    super();
    this.config = { tool: this.toolName, baseDir, displayName: this.displayName };
  }
  getConfigDir() {
    return this.config.baseDir;
  }
  getSkillsDir() {
    return join4(this.config.baseDir, "skills");
  }
  getHooksDir() {
    return join4(this.config.baseDir, "hooks");
  }
  getCommandsDir() {
    return join4(this.config.baseDir, "commands");
  }
  getCapabilities() {
    return {
      skills: true,
      hooks: true,
      mcp: true,
      commands: true
    };
  }
};

// src/adapters/registry.ts
function detectAdapter(systemRoot) {
  const normalized = systemRoot.replace(/\\/g, "/").toLowerCase();
  if (normalized.includes(".claude") || normalized.includes("/claude")) {
    return new ClaudeAdapter(systemRoot);
  }
  if (normalized.includes(".gemini") || normalized.includes("/gemini")) {
    return new GeminiAdapter(systemRoot);
  }
  if (normalized.includes(".qwen") || normalized.includes("/qwen")) {
    return new QwenAdapter(systemRoot);
  }
  return null;
}

// src/core/diff.ts
async function calculateDiff(repoRoot, systemRoot) {
  const adapter = detectAdapter(systemRoot);
  const isClaude = adapter?.toolName === "claude-code";
  const isQwen = adapter?.toolName === "qwen";
  const isGemini = adapter?.toolName === "gemini";
  const changeSet = {
    skills: { missing: [], outdated: [], drifted: [], total: 0 },
    hooks: { missing: [], outdated: [], drifted: [], total: 0 },
    config: { missing: [], outdated: [], drifted: [], total: 0 },
    commands: { missing: [], outdated: [], drifted: [], total: 0 },
    "qwen-commands": { missing: [], outdated: [], drifted: [], total: 0 },
    "antigravity-workflows": { missing: [], outdated: [], drifted: [], total: 0 }
  };
  const folders = ["skills", "hooks"];
  if (isQwen) folders.push("qwen-commands");
  else if (isGemini) folders.push("commands", "antigravity-workflows");
  else if (!isClaude) folders.push("commands");
  for (const category of folders) {
    let repoPath;
    let systemPath;
    if (category === "commands") {
      repoPath = join5(repoRoot, ".gemini", "commands");
      systemPath = join5(systemRoot, category);
    } else if (category === "qwen-commands") {
      repoPath = join5(repoRoot, ".qwen", "commands");
      systemPath = join5(systemRoot, "commands");
    } else if (category === "antigravity-workflows") {
      repoPath = join5(repoRoot, ".gemini", "antigravity", "global_workflows");
      systemPath = join5(systemRoot, ".gemini", "antigravity", "global_workflows");
    } else {
      repoPath = join5(repoRoot, category);
      systemPath = join5(systemRoot, category);
    }
    if (!await fs3.pathExists(repoPath)) continue;
    const items = await fs3.readdir(repoPath);
    changeSet[category].total = items.length;
    for (const item of items) {
      await compareItem(
        category,
        item,
        join5(repoPath, item),
        join5(systemPath, item),
        changeSet
      );
    }
  }
  const configMapping = {
    "settings.json": { repo: "config/settings.json", sys: "settings.json" }
  };
  for (const [name, paths] of Object.entries(configMapping)) {
    const itemRepoPath = join5(repoRoot, paths.repo);
    const itemSystemPath = join5(systemRoot, paths.sys);
    if (await fs3.pathExists(itemRepoPath)) {
      await compareItem("config", name, itemRepoPath, itemSystemPath, changeSet);
    }
  }
  return changeSet;
}
async function compareItem(category, item, repoPath, systemPath, changeSet) {
  const cat = changeSet[category];
  if (!await fs3.pathExists(systemPath)) {
    cat.missing.push(item);
    return;
  }
  const repoHash = await hashDirectory(repoPath);
  const systemHash = await hashDirectory(systemPath);
  if (repoHash !== systemHash) {
    const repoMtime = await getNewestMtime(repoPath);
    const systemMtime = await getNewestMtime(systemPath);
    if (systemMtime > repoMtime + 2e3) {
      cat.drifted.push(item);
    } else {
      cat.outdated.push(item);
    }
  }
}

// src/core/sync-executor.ts
import path5 from "path";
import fs9 from "fs-extra";
import kleur4 from "kleur";

// src/utils/transform-gemini.ts
import fs4 from "fs-extra";
async function transformSkillToCommand(skillMdPath) {
  try {
    const content = await fs4.readFile(skillMdPath, "utf8");
    const frontmatterMatch = content.match(/^---([\s\S]+?)---/);
    if (!frontmatterMatch) return null;
    const frontmatter = frontmatterMatch[1];
    const nameMatch = frontmatter.match(/name:\s*(.+)/);
    const descMatch = frontmatter.match(/description:\s*(.+)/);
    const geminiCmdMatch = frontmatter.match(/gemini-command:\s*(.+)/);
    const geminiPromptMatch = frontmatter.match(/gemini-prompt:\s*\|?\s*\n?([\s\S]+?)(?=\n[a-z- ]+:|$)/);
    if (!nameMatch || !descMatch) return null;
    const name = nameMatch[1].trim();
    const description = descMatch[1].trim();
    const commandName = geminiCmdMatch ? geminiCmdMatch[1].trim() : name;
    let promptBody = `Use the ${name} skill to handle this: {{args}}`;
    if (geminiPromptMatch) {
      const extraLines = geminiPromptMatch[1].trim();
      promptBody = `Use the ${name} skill to handle this request: {{args}}

${extraLines}`;
    }
    const toml = `description = """${description}"""
prompt = """
${promptBody}
"""
`;
    return {
      toml,
      commandName
    };
  } catch (error) {
    console.error(`Error transforming skill to command: ${error.message}`);
    return null;
  }
}

// src/utils/atomic-config.ts
import fs5 from "fs-extra";
import { parse, stringify } from "comment-json";
var PROTECTED_KEYS = [
  "permissions.allow",
  // User-defined permissions
  "hooks.UserPromptSubmit",
  // Claude hooks
  "hooks.SessionStart",
  "hooks.PreToolUse",
  "hooks.BeforeAgent",
  // Gemini hooks
  "hooks.BeforeTool",
  // Gemini hooks
  "security",
  // Auth secrets/OAuth data
  "general",
  // Personal preferences
  "enabledPlugins",
  // User-enabled/disabled plugins
  "model",
  // User's preferred model
  "skillSuggestions.enabled"
  // User preferences
];
function isValueProtected(keyPath) {
  return PROTECTED_KEYS.some(
    (protectedPath) => keyPath === protectedPath || keyPath.startsWith(protectedPath + ".")
  );
}
function deepMergeWithProtection(original, updates, currentPath = "") {
  const result = { ...original };
  for (const [key, value] of Object.entries(updates)) {
    const keyPath = currentPath ? `${currentPath}.${key}` : key;
    if (isValueProtected(keyPath) && original.hasOwnProperty(key)) {
      continue;
    }
    if (key === "mcpServers" && typeof value === "object" && value !== null && typeof original[key] === "object" && original[key] !== null) {
      result[key] = { ...original[key] };
      for (const [serverName, serverConfig] of Object.entries(value)) {
        if (!result[key].hasOwnProperty(serverName)) {
          result[key][serverName] = serverConfig;
        }
      }
    } else if (typeof value === "object" && value !== null && !Array.isArray(value) && typeof original[key] === "object" && original[key] !== null && !Array.isArray(original[key])) {
      result[key] = deepMergeWithProtection(original[key], value, keyPath);
    } else {
      result[key] = value;
    }
  }
  return result;
}
async function atomicWrite(filePath, data, options = {}) {
  const {
    preserveComments = false,
    backupOnSuccess = false,
    backupSuffix = ".bak"
  } = options;
  const tempFilePath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).substr(2, 9)}`;
  try {
    let content;
    if (preserveComments) {
      content = stringify(data, null, 2);
    } else {
      content = JSON.stringify(data, null, 2);
    }
    await fs5.writeFile(tempFilePath, content, "utf8");
    const tempStats = await fs5.stat(tempFilePath);
    if (tempStats.size === 0) {
      throw new Error("Temporary file is empty - write failed");
    }
    if (backupOnSuccess && await fs5.pathExists(filePath)) {
      const backupPath = `${filePath}${backupSuffix}`;
      await fs5.copy(filePath, backupPath);
    }
    await fs5.rename(tempFilePath, filePath);
  } catch (error) {
    try {
      if (await fs5.pathExists(tempFilePath)) {
        await fs5.unlink(tempFilePath);
      }
    } catch (cleanupError) {
    }
    throw error;
  }
}
async function safeReadConfig(filePath) {
  try {
    if (!await fs5.pathExists(filePath)) {
      return {};
    }
    const content = await fs5.readFile(filePath, "utf8");
    try {
      return parse(content);
    } catch (parseError) {
      return JSON.parse(content);
    }
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw new Error(`Failed to read config file: ${error.message}`);
  }
}
async function safeMergeConfig(localConfigPath, repoConfig, options = {}) {
  const {
    preserveComments = true,
    backupOnSuccess = true,
    dryRun = false,
    resolvedLocalConfig = null
  } = options;
  const localConfig = resolvedLocalConfig || await safeReadConfig(localConfigPath);
  const changes = [];
  if (localConfig.mcpServers && typeof localConfig.mcpServers === "object") {
    const localServerNames = Object.keys(localConfig.mcpServers);
    if (localServerNames.length > 0) {
      changes.push(`Preserved ${localServerNames.length} local mcpServers: ${localServerNames.join(", ")}`);
    }
  }
  if (repoConfig.mcpServers && typeof repoConfig.mcpServers === "object") {
    const repoServerNames = Object.keys(repoConfig.mcpServers);
    const newServerNames = repoServerNames.filter(
      (name) => !localConfig.mcpServers || !localConfig.mcpServers.hasOwnProperty(name)
    );
    if (newServerNames.length > 0) {
      changes.push(`Added ${newServerNames.length} new non-conflicting mcpServers from repository: ${newServerNames.join(", ")}`);
    }
  }
  const mergedConfig = deepMergeWithProtection(localConfig, repoConfig);
  const configsAreEqual = JSON.stringify(localConfig) === JSON.stringify(mergedConfig);
  if (!configsAreEqual && !dryRun) {
    await atomicWrite(localConfigPath, mergedConfig, {
      preserveComments,
      backupOnSuccess
    });
  }
  return {
    updated: !configsAreEqual,
    changes
  };
}

// src/utils/config-adapter.ts
import path2 from "path";
import os2 from "os";
var EnvVarTransformer = class {
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
      case "claude":
        return value;
      case "cursor":
        return value.replace(/\$\{env:([A-Za-z0-9_]+)\}/g, "${$1}");
      case "opencode":
        return value.replace(/\{env:([A-Za-z0-9_]+)\}/g, "${$1}");
      case "gemini":
        return value;
      case "qwen":
        return value;
      default:
        return value;
    }
  }
  static fromNormalized(value, to) {
    switch (to) {
      case "claude":
        return value;
      case "cursor":
        return value.replace(/\$\{([A-Z0-9_]+)\}/g, (match, name) => {
          if (["workspaceFolder", "userHome"].includes(name)) return match;
          return `\${env:${name}}`;
        });
      case "opencode":
        return value.replace(/\$\{([A-Z0-9_]+)\}/g, "{env:$1}");
      case "gemini":
        return value;
      case "qwen":
        return value;
      default:
        return value;
    }
  }
};
var ConfigAdapter = class {
  systemRoot;
  homeDir;
  isClaude;
  isGemini;
  isQwen;
  isCursor;
  isAntigravity;
  targetFormat;
  hooksDir;
  constructor(systemRoot) {
    this.systemRoot = systemRoot;
    this.homeDir = os2.homedir();
    const normalizedRoot = systemRoot.replace(/\\/g, "/").toLowerCase();
    this.isClaude = normalizedRoot.includes(".claude") || normalizedRoot.includes("/claude");
    this.isGemini = normalizedRoot.includes(".gemini") || normalizedRoot.includes("/gemini");
    this.isQwen = normalizedRoot.includes(".qwen") || normalizedRoot.includes("/qwen");
    this.isCursor = normalizedRoot.includes("cursor");
    this.isAntigravity = normalizedRoot.includes("antigravity");
    this.targetFormat = this.isCursor ? "cursor" : this.isAntigravity ? "antigravity" : this.isClaude ? "claude" : "claude";
    this.hooksDir = path2.join(this.systemRoot, "hooks");
  }
  adaptMcpConfig(canonicalConfig) {
    if (!canonicalConfig || !canonicalConfig.mcpServers) return {};
    const config2 = JSON.parse(JSON.stringify(canonicalConfig));
    config2.mcpServers = EnvVarTransformer.transform(config2.mcpServers, "claude", this.targetFormat);
    if (this.isGemini || this.isQwen) {
      this.transformToGeminiFormat(config2.mcpServers);
    } else if (this.isAntigravity) {
      this.transformToAntigravityFormat(config2.mcpServers);
    } else if (this.isClaude) {
      this.transformToClaudeFormat(config2.mcpServers);
    }
    this.resolveMcpPaths(config2.mcpServers);
    return config2;
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
      if (server.args) server.args = server.args.map((arg) => this.resolvePath(arg));
      if (server.cwd) server.cwd = this.resolvePath(server.cwd);
      if (server.env) {
        for (const key in server.env) server.env[key] = this.resolvePath(server.env[key]);
      }
    }
  }
  transformToGeminiFormat(servers) {
    for (const server of Object.values(servers)) {
      delete server.type;
    }
  }
  transformToClaudeFormat(servers) {
    for (const server of Object.values(servers)) {
      if (server.url && !server.type) {
        if (server.url.includes("/sse")) {
          server.type = "sse";
        } else {
          server.type = "http";
        }
      } else if (server.command && !server.type) {
        server.type = "stdio";
      }
    }
  }
  transformToAntigravityFormat(servers) {
    for (const [name, server] of Object.entries(servers)) {
      if (server.url && !server.type) {
        if (server.url.includes("/sse")) {
          server.type = "sse";
        } else {
          server.type = "http";
        }
      } else if (server.command && !server.type) {
        server.type = "stdio";
      }
      if (server.url && (server.type === "http" || server.type === "sse")) {
        server.serverUrl = server.url;
        delete server.url;
      }
    }
  }
  resolveHookScripts(hooksConfig) {
    if (hooksConfig.hooks) {
      const pythonBin = process.platform === "win32" ? "python" : "python3";
      for (const [event, hooks] of Object.entries(hooksConfig.hooks)) {
        if (Array.isArray(hooks)) {
          hooks.forEach((hook) => {
            if (hook.script) {
              hook.type = "command";
              const resolvedScriptPath = this.resolvePath(path2.join(this.hooksDir, hook.script));
              hook.command = `${pythonBin} ${resolvedScriptPath}`;
              delete hook.script;
            }
          });
        }
      }
    }
    if (hooksConfig.statusLine && hooksConfig.statusLine.script) {
      const pythonBin = process.platform === "win32" ? "python" : "python3";
      hooksConfig.statusLine.type = "command";
      const resolvedScriptPath = this.resolvePath(path2.join(this.hooksDir, hooksConfig.statusLine.script));
      hooksConfig.statusLine.command = `${pythonBin} ${resolvedScriptPath}`;
      delete hooksConfig.statusLine.script;
    }
  }
  transformToGeminiHooks(hooksConfig) {
    const geminiHooks = { hooks: {} };
    const eventMap = {
      "UserPromptSubmit": "BeforeAgent",
      "PreToolUse": "BeforeTool",
      "SessionStart": "SessionStart"
    };
    const toolMap = {
      "Read": "read_file",
      "Write": "write_file",
      "Edit": "replace",
      "Bash": "run_shell_command"
    };
    const pythonBin = process.platform === "win32" ? "python" : "python3";
    for (const [event, hooks] of Object.entries(hooksConfig.hooks || {})) {
      const geminiEvent = eventMap[event];
      if (!geminiEvent) continue;
      geminiHooks.hooks[geminiEvent] = hooks.map((hook) => {
        const newHook = { ...hook };
        if (newHook.matcher) {
          for (const [claudeTool, geminiTool] of Object.entries(toolMap)) {
            newHook.matcher = newHook.matcher.replace(new RegExp(`\\b${claudeTool}\\b`, "g"), geminiTool);
          }
        }
        if (newHook.script) {
          newHook.type = "command";
          const resolvedScriptPath = this.resolvePath(path2.join(this.hooksDir, newHook.script));
          newHook.command = `${pythonBin} ${resolvedScriptPath}`;
          delete newHook.script;
        }
        newHook.timeout = newHook.timeout || 6e4;
        return newHook;
      });
    }
    return geminiHooks;
  }
  resolvePath(p) {
    if (!p || typeof p !== "string") return p;
    let resolved = p.replace(/~\//g, this.homeDir + "/").replace(/\${HOME}/g, this.homeDir);
    if (process.platform === "win32") {
      resolved = resolved.replace(/\\/g, "/");
    }
    return resolved;
  }
};

// src/utils/sync-mcp-cli.ts
import { execSync } from "child_process";
import fs7 from "fs-extra";
import path4 from "path";
import kleur3 from "kleur";

// src/utils/env-manager.ts
import fs6 from "fs-extra";
import path3 from "path";
import os3 from "os";
import kleur2 from "kleur";
import dotenv from "dotenv";
var CONFIG_DIR = path3.join(os3.homedir(), ".config", "jaggers-agent-tools");
var ENV_FILE = path3.join(CONFIG_DIR, ".env");
var ENV_EXAMPLE_FILE = path3.join(CONFIG_DIR, ".env.example");
var REQUIRED_ENV_VARS = {
  CONTEXT7_API_KEY: {
    description: "Context7 MCP server API key",
    example: "ctx7sk-your-api-key-here",
    getUrl: () => "https://context7.com/"
  }
};
function ensureEnvFile() {
  if (!fs6.existsSync(CONFIG_DIR)) {
    fs6.ensureDirSync(CONFIG_DIR);
    console.log(kleur2.gray(`  Created config directory: ${CONFIG_DIR}`));
  }
  if (!fs6.existsSync(ENV_EXAMPLE_FILE)) {
    createEnvExample();
  }
  if (!fs6.existsSync(ENV_FILE)) {
    createEnvFile();
    return false;
  }
  return true;
}
function createEnvExample() {
  const content = [
    "# Jaggers Agent Tools - Environment Variables",
    "# Copy this file to .env and fill in your actual values",
    "",
    ...Object.entries(REQUIRED_ENV_VARS).map(([key, config2]) => {
      return [
        `# ${config2.description}`,
        `# Get your key from: ${config2.getUrl()}`,
        `${key}=${config2.example}`,
        ""
      ].join("\n");
    }),
    "# See config/.env.example in the repository for all available options",
    ""
  ].join("\n");
  fs6.writeFileSync(ENV_EXAMPLE_FILE, content);
  console.log(kleur2.gray(`  Created example file: ${ENV_EXAMPLE_FILE}`));
}
function createEnvFile() {
  const content = [
    "# Jaggers Agent Tools - Environment Variables",
    "# Generated automatically by jaggers-agent-tools CLI",
    "",
    "# Copy values from .env.example and fill in your actual keys",
    ""
  ].join("\n");
  fs6.writeFileSync(ENV_FILE, content);
  console.log(kleur2.green(`  Created environment file: ${ENV_FILE}`));
}
function loadEnvFile() {
  if (fs6.existsSync(ENV_FILE)) {
    const envConfig = dotenv.parse(fs6.readFileSync(ENV_FILE));
    for (const [key, value] of Object.entries(envConfig)) {
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
    return envConfig;
  }
  return {};
}
function checkRequiredEnvVars() {
  const missing = [];
  for (const [key] of Object.entries(REQUIRED_ENV_VARS)) {
    if (!process.env[key]) {
      missing.push(key);
    }
  }
  return missing;
}
function handleMissingEnvVars(missing) {
  if (missing.length === 0) {
    return true;
  }
  console.log(kleur2.yellow("\n  \u26A0\uFE0F  Missing environment variables:"));
  for (const key of missing) {
    const config2 = REQUIRED_ENV_VARS[key];
    console.log(kleur2.yellow(`    - ${key}: ${config2.description}`));
    console.log(kleur2.dim(`      Get your key from: ${config2.getUrl()}`));
  }
  console.log(kleur2.yellow(`
  Please edit: ${ENV_FILE}`));
  console.log(kleur2.gray(`  Or copy from example: ${ENV_EXAMPLE_FILE}`));
  return false;
}
function getEnvFilePath() {
  return ENV_FILE;
}

// src/utils/sync-mcp-cli.ts
var AGENT_CLI = {
  claude: {
    command: "claude",
    listArgs: ["mcp", "list"],
    addStdio: (name, cmd, args, env) => {
      const base = ["mcp", "add", "-s", "user", name, "--"];
      if (env && Object.keys(env).length > 0) {
        for (const [key, value] of Object.entries(env)) {
          base.push("-e", `${key}=${resolveEnvVar(value)}`);
        }
      }
      base.push(cmd, ...args || []);
      return base;
    },
    addHttp: (name, url, headers) => {
      const base = ["mcp", "add", "-s", "user", "--transport", "http", name, url];
      if (headers) {
        for (const [key, value] of Object.entries(headers)) {
          base.push("--header", `${key}: ${resolveEnvVar(value)}`);
        }
      }
      return base;
    },
    addSse: (name, url) => {
      return ["mcp", "add", "-s", "user", "--transport", "sse", name, url];
    },
    remove: (name) => ["mcp", "remove", "-s", "user", name],
    parseList: (output) => parseMcpListOutput(output, /^([a-zA-Z0-9_-]+):/)
  },
  gemini: {
    command: "gemini",
    listArgs: ["mcp", "list"],
    addStdio: (name, cmd, args, env) => {
      const base = ["mcp", "add", name, cmd];
      if (args && args.length > 0) base.push(...args);
      if (env && Object.keys(env).length > 0) {
        for (const [key, value] of Object.entries(env)) {
          base.push("-e", `${key}=${resolveEnvVar(value)}`);
        }
      }
      return base;
    },
    addHttp: (name, url, headers) => {
      const base = ["mcp", "add", "-t", "http", name, url];
      if (headers) {
        for (const [key, value] of Object.entries(headers)) {
          base.push("-H", `${key}=${resolveEnvVar(value)}`);
        }
      }
      return base;
    },
    addSse: (name, url) => {
      return ["mcp", "add", "-t", "sse", name, url];
    },
    remove: (name) => ["mcp", "remove", name],
    parseList: (output) => parseMcpListOutput(output, /^✓ ([a-zA-Z0-9_-]+):/)
  },
  qwen: {
    command: "qwen",
    listArgs: ["mcp", "list"],
    addStdio: (name, cmd, args, env) => {
      const base = ["mcp", "add", name, cmd];
      if (args && args.length > 0) base.push(...args);
      if (env && Object.keys(env).length > 0) {
        for (const [key, value] of Object.entries(env)) {
          base.push("-e", `${key}=${resolveEnvVar(value)}`);
        }
      }
      return base;
    },
    addHttp: (name, url, headers) => {
      const base = ["mcp", "add", "-t", "http", name, url];
      if (headers) {
        for (const [key, value] of Object.entries(headers)) {
          base.push("-H", `${key}=${resolveEnvVar(value)}`);
        }
      }
      return base;
    },
    addSse: (name, url) => {
      return ["mcp", "add", "-t", "sse", name, url];
    },
    remove: (name) => ["mcp", "remove", name],
    parseList: (output) => parseMcpListOutput(output, /^✓ ([a-zA-Z0-9_-]+):/)
  }
};
function parseMcpListOutput(output, pattern) {
  const servers = [];
  for (const line of output.split("\n")) {
    const match = line.match(pattern);
    if (match) {
      servers.push(match[1]);
    }
  }
  return servers;
}
function resolveEnvVar(value) {
  if (typeof value !== "string") return value;
  const envMatch = value.match(/\$\{([A-Z0-9_]+)\}/i);
  if (envMatch) {
    const envName = envMatch[1];
    const envValue = process.env[envName];
    if (envValue) {
      return envValue;
    } else {
      console.warn(kleur3.yellow(`  \u26A0\uFE0F  Environment variable ${envName} is not set in ${getEnvFilePath()}`));
      return "";
    }
  }
  return value;
}
function detectAgent(systemRoot) {
  const normalizedRoot = systemRoot.replace(/\\/g, "/").toLowerCase();
  if (normalizedRoot.includes(".claude") || normalizedRoot.includes("/claude")) {
    return "claude";
  } else if (normalizedRoot.includes(".gemini") || normalizedRoot.includes("/gemini")) {
    return "gemini";
  } else if (normalizedRoot.includes(".qwen") || normalizedRoot.includes("/qwen")) {
    return "qwen";
  }
  return null;
}
function buildAddCommand(agent, name, server) {
  const cli = AGENT_CLI[agent];
  if (!cli) return null;
  if (server.url || server.serverUrl) {
    const url = server.url || server.serverUrl;
    const type = server.type || (url.includes("/sse") ? "sse" : "http");
    if (type === "sse") {
      return cli.addSse(name, url);
    } else {
      return cli.addHttp(name, url, server.headers);
    }
  }
  if (server.command) {
    return cli.addStdio(name, server.command, server.args, server.env);
  }
  console.warn(kleur3.yellow(`  \u26A0\uFE0F  Skipping server "${name}": Unknown configuration`));
  return null;
}
function executeCommand(agent, args, dryRun = false) {
  const cli = AGENT_CLI[agent];
  const quotedArgs = args.map((arg) => {
    if (arg.includes(" ") && !arg.startsWith('"') && !arg.startsWith("'")) {
      return `"${arg}"`;
    }
    return arg;
  });
  const command = `${cli.command} ${quotedArgs.join(" ")}`;
  if (dryRun) {
    console.log(kleur3.cyan(`  [DRY RUN] ${command}`));
    return { success: true, dryRun: true };
  }
  try {
    execSync(command, { stdio: "pipe" });
    console.log(kleur3.green(`  \u2713 ${args.slice(2).join(" ")}`));
    return { success: true };
  } catch (error) {
    const stderr = error.stderr?.toString() || error.message;
    if (stderr.includes("already exists") || stderr.includes("already configured")) {
      let serverName = "unknown";
      if (agent === "claude") {
        const addIndex = args.indexOf("add");
        for (let i = addIndex + 1; i < args.length; i++) {
          const arg = args[i];
          if (arg === "--") continue;
          if (arg.startsWith("-")) continue;
          if (["local", "user", "project", "http", "sse", "stdio"].includes(arg)) continue;
          serverName = arg;
          break;
        }
      } else if (agent === "gemini" || agent === "qwen") {
        const addIndex = args.indexOf("add");
        for (let i = addIndex + 1; i < args.length; i++) {
          const arg = args[i];
          if (arg === "-t") {
            i++;
            continue;
          }
          if (arg.startsWith("-")) continue;
          if (["http", "sse", "stdio"].includes(arg)) continue;
          serverName = arg;
          break;
        }
      } else {
        serverName = args[2];
      }
      console.log(kleur3.dim(`  \u2713 ${serverName} (already configured)`));
      return { success: true, skipped: true };
    }
    console.log(kleur3.red(`  \u2717 Failed: ${stderr.trim()}`));
    return { success: false, error: stderr };
  }
}
function getCurrentServers(agent) {
  const cli = AGENT_CLI[agent];
  try {
    const output = execSync(`${cli.command} ${cli.listArgs.join(" ")}`, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"]
    });
    return cli.parseList(output);
  } catch (error) {
    return [];
  }
}
async function syncMcpServersWithCli(agent, mcpConfig, dryRun = false, prune = false) {
  const cli = AGENT_CLI[agent];
  if (!cli) {
    console.log(kleur3.yellow(`  \u26A0\uFE0F  Unsupported agent: ${agent}`));
    return;
  }
  console.log(kleur3.bold(`
Syncing MCP servers to ${agent}...`));
  ensureEnvFile();
  loadEnvFile();
  const missingEnvVars = checkRequiredEnvVars();
  if (missingEnvVars.length > 0) {
    handleMissingEnvVars(missingEnvVars);
  }
  const currentServers = getCurrentServers(agent);
  const canonicalServers = new Set(Object.keys(mcpConfig.mcpServers || {}));
  if (prune) {
    console.log(kleur3.red("\n  Prune mode: Removing servers not in canonical config..."));
    for (const serverName of currentServers) {
      if (!canonicalServers.has(serverName)) {
        console.log(kleur3.red(`  Removing: ${serverName}`));
        executeCommand(agent, cli.remove(serverName), dryRun);
      }
    }
  }
  console.log(kleur3.cyan("\n  Adding/Updating canonical servers..."));
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
  console.log(kleur3.green(`
  \u2713 Synced ${successCount} MCP servers`));
}
function loadCanonicalMcpConfig(repoRoot) {
  const corePath = path4.join(repoRoot, "config", "mcp_servers.json");
  const config2 = { mcpServers: {} };
  if (fs7.existsSync(corePath)) {
    const core = fs7.readJsonSync(corePath);
    config2.mcpServers = { ...config2.mcpServers, ...core.mcpServers };
  }
  return config2;
}

// src/core/rollback.ts
import fs8 from "fs-extra";
async function createBackup(filePath) {
  const timestamp = Date.now();
  const backupPath = `${filePath}.backup-${timestamp}`;
  if (await fs8.pathExists(filePath)) {
    await fs8.copy(filePath, backupPath);
  }
  return {
    originalPath: filePath,
    backupPath,
    timestamp: /* @__PURE__ */ new Date()
  };
}
async function restoreBackup(backup) {
  if (await fs8.pathExists(backup.backupPath)) {
    await fs8.move(backup.backupPath, backup.originalPath, { overwrite: true });
  }
}
async function cleanupBackup(backup) {
  await fs8.remove(backup.backupPath);
}

// src/core/sync-executor.ts
async function executeSync(repoRoot, systemRoot, changeSet, mode, actionType, isDryRun = false) {
  const isClaude = systemRoot.includes(".claude") || systemRoot.includes("Claude");
  const isQwen = systemRoot.includes(".qwen") || systemRoot.includes("Qwen");
  const isGemini = systemRoot.includes(".gemini") || systemRoot.includes("Gemini");
  const categories = ["skills", "hooks", "config"];
  if (isQwen) categories.push("qwen-commands");
  else if (isGemini) categories.push("commands", "antigravity-workflows");
  else if (!isClaude) categories.push("commands");
  let count = 0;
  const adapter = new ConfigAdapter(systemRoot);
  const backups = [];
  try {
    const agent = detectAgent(systemRoot);
    if (agent && actionType === "sync") {
      console.log(kleur4.gray(`  --> ${agent} MCP servers (via ${agent} mcp CLI)`));
      const canonicalConfig = loadCanonicalMcpConfig(repoRoot);
      await syncMcpServersWithCli(agent, canonicalConfig, isDryRun, mode === "prune");
      count++;
    }
    for (const category of categories) {
      const itemsToProcess = [];
      if (actionType === "sync") {
        const cat = changeSet[category];
        itemsToProcess.push(...cat.missing);
        itemsToProcess.push(...cat.outdated);
        if (mode === "prune") {
          for (const itemToDelete of cat.drifted || []) {
            const dest = path5.join(systemRoot, category, itemToDelete);
            console.log(kleur4.red(`  [x] PRUNING ${category}/${itemToDelete}`));
            if (!isDryRun) {
              if (await fs9.pathExists(dest)) {
                backups.push(await createBackup(dest));
                await fs9.remove(dest);
              }
            }
            count++;
          }
        }
      } else if (actionType === "backport") {
        const cat = changeSet[category];
        itemsToProcess.push(...cat.drifted);
      }
      for (const item of itemsToProcess) {
        let src, dest;
        if (category === "config" && item === "settings.json" && actionType === "sync") {
          src = path5.join(repoRoot, "config", "settings.json");
          dest = path5.join(systemRoot, "settings.json");
          console.log(kleur4.gray(`  --> config/settings.json`));
          if (agent) {
            console.log(kleur4.gray(`  (Skipped: ${agent} uses ${agent} mcp CLI for MCP servers)`));
            count++;
            continue;
          }
          if (!isDryRun && await fs9.pathExists(dest)) {
            backups.push(await createBackup(dest));
          }
          const repoConfig = await fs9.readJson(src);
          let finalRepoConfig = resolveConfigPaths(repoConfig, systemRoot);
          const hooksSrc = path5.join(repoRoot, "config", "hooks.json");
          if (await fs9.pathExists(hooksSrc)) {
            const hooksRaw = await fs9.readJson(hooksSrc);
            const hooksAdapted = adapter.adaptHooksConfig(hooksRaw);
            if (hooksAdapted.hooks) {
              finalRepoConfig.hooks = { ...finalRepoConfig.hooks || {}, ...hooksAdapted.hooks };
              if (!isDryRun) console.log(kleur4.dim(`      (Injected hooks)`));
            }
          }
          if (fs9.existsSync(dest)) {
            const localConfig = await fs9.readJson(dest);
            const resolvedLocalConfig = resolveConfigPaths(localConfig, systemRoot);
            if (mode === "prune") {
              if (localConfig.mcpServers && finalRepoConfig.mcpServers) {
                const canonicalServers = new Set(Object.keys(finalRepoConfig.mcpServers));
                for (const serverName of Object.keys(localConfig.mcpServers)) {
                  if (!canonicalServers.has(serverName)) {
                    delete localConfig.mcpServers[serverName];
                    if (!isDryRun) console.log(kleur4.red(`      (Pruned local MCP server: ${serverName})`));
                  }
                }
              }
            }
            const mergeResult = await safeMergeConfig(dest, finalRepoConfig, {
              backupOnSuccess: false,
              // Handled by our own rollback system
              preserveComments: true,
              dryRun: isDryRun,
              resolvedLocalConfig
            });
            if (mergeResult.updated) {
              console.log(kleur4.blue(`      (Configuration safely merged)`));
            }
          } else {
            if (!isDryRun) {
              await fs9.ensureDir(path5.dirname(dest));
              await fs9.writeJson(dest, finalRepoConfig, { spaces: 2 });
            }
            console.log(kleur4.green(`      (Created new configuration)`));
          }
          count++;
          continue;
        }
        const repoPath = category === "commands" ? path5.join(repoRoot, ".gemini", "commands") : category === "qwen-commands" ? path5.join(repoRoot, ".qwen", "commands") : category === "antigravity-workflows" ? path5.join(repoRoot, ".gemini", "antigravity", "global_workflows") : path5.join(repoRoot, category);
        const systemPath = category === "qwen-commands" ? path5.join(systemRoot, "commands") : category === "antigravity-workflows" ? path5.join(systemRoot, ".gemini", "antigravity", "global_workflows") : path5.join(systemRoot, category);
        if (actionType === "backport") {
          src = path5.join(systemPath, item);
          dest = path5.join(repoPath, item);
        } else {
          src = path5.join(repoPath, item);
          dest = path5.join(systemPath, item);
        }
        console.log(kleur4.gray(`  ${actionType === "backport" ? "<--" : "-->"} ${category}/${item}`));
        if (!isDryRun && actionType === "sync" && await fs9.pathExists(dest)) {
          backups.push(await createBackup(dest));
        }
        if (mode === "symlink" && actionType === "sync" && category !== "config") {
          if (!isDryRun) {
            if (process.platform === "win32") {
              console.log(kleur4.yellow("  \u26A0 Symlinks require Developer Mode on Windows \u2014 falling back to copy."));
              await fs9.remove(dest);
              await fs9.copy(src, dest);
            } else {
              await fs9.remove(dest);
              await fs9.ensureSymlink(src, dest);
            }
          }
        } else {
          if (!isDryRun) {
            await fs9.remove(dest);
            await fs9.copy(src, dest);
          }
        }
        if (category === "skills" && !isClaude && actionType === "sync") {
          const skillMdPath = path5.join(src, "SKILL.md");
          if (fs9.existsSync(skillMdPath)) {
            const result = await transformSkillToCommand(skillMdPath);
            if (result && !isDryRun) {
              const commandDest = path5.join(systemRoot, "commands", `${result.commandName}.toml`);
              if (await fs9.pathExists(commandDest)) {
                backups.push(await createBackup(commandDest));
              }
              await fs9.ensureDir(path5.dirname(commandDest));
              await fs9.writeFile(commandDest, result.toml);
              console.log(kleur4.cyan(`      (Auto-generated slash command: /${result.commandName})`));
            }
          }
        }
        count++;
      }
    }
    if (!isDryRun && actionType === "sync") {
      const manifestPath = path5.join(systemRoot, ".jaggers-sync-manifest.json");
      const manifest = {
        lastSync: (/* @__PURE__ */ new Date()).toISOString(),
        repoRoot,
        items: count
      };
      await fs9.writeJson(manifestPath, manifest, { spaces: 2 });
    }
    for (const backup of backups) {
      await cleanupBackup(backup);
    }
    return count;
  } catch (error) {
    console.error(kleur4.red(`
Sync failed, rolling back ${backups.length} changes...`));
    for (const backup of backups) {
      await restoreBackup(backup);
      await cleanupBackup(backup);
    }
    throw error;
  }
}
function resolveConfigPaths(config2, targetDir) {
  const newConfig = JSON.parse(JSON.stringify(config2));
  function recursiveReplace(obj) {
    for (const key in obj) {
      if (typeof obj[key] === "string") {
        if (obj[key].match(/\/[^\s"']+\/hooks\//)) {
          const hooksDir = path5.join(targetDir, "hooks");
          let replacementDir = `${hooksDir}/`;
          if (process.platform === "win32") {
            replacementDir = replacementDir.replace(/\\/g, "/");
          }
          obj[key] = obj[key].replace(/(\/[^\s"']+\/hooks\/)/g, replacementDir);
        }
      } else if (typeof obj[key] === "object" && obj[key] !== null) {
        recursiveReplace(obj[key]);
      }
    }
  }
  recursiveReplace(newConfig);
  return newConfig;
}

// src/commands/sync.ts
import path6 from "path";
function createSyncCommand() {
  return new Command("sync").description("Sync agent tools (skills, hooks, config) to target environments").option("--dry-run", "Preview changes without making any modifications", false).option("-y, --yes", "Skip confirmation prompts", false).option("--prune", "Remove items not in the canonical repository", false).option("--backport", "Backport drifted local changes back to the repository", false).action(async (opts) => {
    const { dryRun, yes, prune, backport } = opts;
    const actionType = backport ? "backport" : "sync";
    const repoRoot = path6.resolve(process.cwd(), "..");
    if (dryRun) {
      console.log(kleur5.cyan("\n  DRY RUN \u2014 no changes will be written\n"));
    }
    const ctx = await getContext();
    const { targets, syncMode, config: config2 } = ctx;
    let totalCount = 0;
    for (const target of targets) {
      console.log(kleur5.bold(`
\u{1F4C2} Target: ${target}`));
      const changeSet = await calculateDiff(repoRoot, target);
      const totalChanges = Object.values(changeSet).reduce((sum, cat) => {
        return sum + cat.missing.length + cat.outdated.length + cat.drifted.length;
      }, 0);
      if (totalChanges === 0) {
        console.log(kleur5.green("  \u2713 Already up-to-date"));
        continue;
      }
      for (const [category, cat] of Object.entries(changeSet)) {
        const c = cat;
        if (c.missing.length > 0) {
          console.log(kleur5.yellow(`  + ${c.missing.length} missing ${category}: ${c.missing.join(", ")}`));
        }
        if (c.outdated.length > 0) {
          console.log(kleur5.blue(`  \u2191 ${c.outdated.length} outdated ${category}: ${c.outdated.join(", ")}`));
        }
        if (c.drifted.length > 0) {
          console.log(kleur5.red(`  \u2717 ${c.drifted.length} drifted ${category}: ${c.drifted.join(", ")}`));
        }
      }
      if (!yes && !dryRun) {
        const { confirm } = await prompts2({
          type: "confirm",
          name: "confirm",
          message: `Proceed with ${actionType} (${totalChanges} changes)?`,
          initial: true
        });
        if (!confirm) {
          console.log(kleur5.gray("  Skipped."));
          continue;
        }
      }
      const count = await executeSync(repoRoot, target, changeSet, syncMode, actionType, dryRun);
      totalCount += count;
      console.log(kleur5.green(`  \u2713 ${dryRun ? "[DRY RUN]" : ""} Synced ${count} items`));
    }
    console.log(kleur5.bold(kleur5.green(`
\u2713 Total: ${totalCount} items synced
`)));
  });
}

// src/commands/status.ts
import { Command as Command2 } from "commander";
import kleur6 from "kleur";
import path7 from "path";
function createStatusCommand() {
  return new Command2("status").description("Show diff between repo and target environments (read-only)").action(async () => {
    const repoRoot = path7.resolve(process.cwd(), "..");
    const ctx = await getContext();
    const { targets } = ctx;
    for (const target of targets) {
      console.log(kleur6.bold(`
\u{1F4C2} ${target}`));
      const changeSet = await calculateDiff(repoRoot, target);
      let hasChanges = false;
      for (const [category, cat] of Object.entries(changeSet)) {
        const c = cat;
        if (c.missing.length === 0 && c.outdated.length === 0 && c.drifted.length === 0) continue;
        hasChanges = true;
        console.log(kleur6.bold(`  ${category}:`));
        for (const item of c.missing) {
          console.log(kleur6.yellow(`    + ${item} (missing)`));
        }
        for (const item of c.outdated) {
          console.log(kleur6.blue(`    \u2191 ${item} (outdated)`));
        }
        for (const item of c.drifted) {
          console.log(kleur6.red(`    \u2717 ${item} (drifted \u2014 local ahead)`));
        }
      }
      if (!hasChanges) {
        console.log(kleur6.green("  \u2713 Up-to-date"));
      }
    }
    console.log();
  });
}

// src/commands/reset.ts
import { Command as Command3 } from "commander";
import kleur7 from "kleur";
function createResetCommand() {
  return new Command3("reset").description("Reset CLI configuration (clears saved sync mode and preferences)").action(() => {
    resetContext();
    console.log(kleur7.green("\u2713 Configuration reset. Run sync again to reconfigure."));
  });
}

// src/index.ts
var program = new Command4();
program.name("jaggers-config").description("Sync agent tools (skills, hooks, config, MCP servers) across AI environments").version("1.2.0");
program.addCommand(createSyncCommand());
program.addCommand(createStatusCommand());
program.addCommand(createResetCommand());
program.action(async () => {
  const syncCmd = createSyncCommand();
  await syncCmd.parseAsync([], { from: "user" });
});
program.parseAsync(process.argv);
//# sourceMappingURL=index.js.map