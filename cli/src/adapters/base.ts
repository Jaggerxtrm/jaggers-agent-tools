import type { Skill, MCPServer, Hook, Command } from '../types/models.js';

export interface AdapterCapabilities {
    skills: boolean;
    hooks: boolean;
    mcp: boolean;
    commands: boolean;
}

export interface AdapterConfig {
    tool: string;
    baseDir: string;
    displayName: string;
}

export abstract class ToolAdapter {
    abstract readonly toolName: string;
    abstract readonly displayName: string;
    abstract readonly config: AdapterConfig;

    // Capabilities
    abstract getCapabilities(): AdapterCapabilities;

    // Paths
    abstract getConfigDir(): string;
    abstract getSkillsDir(): string;
    abstract getHooksDir(): string;
    abstract getCommandsDir(): string;
}
