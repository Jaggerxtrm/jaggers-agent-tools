import { join } from 'path';
import { ToolAdapter, type AdapterCapabilities } from './base.js';

export class GeminiAdapter extends ToolAdapter {
    readonly toolName = 'gemini';
    readonly displayName = 'Gemini';
    readonly config: { tool: string; baseDir: string; displayName: string };

    constructor(baseDir: string) {
        super();
        this.config = { tool: this.toolName, baseDir, displayName: this.displayName };
    }

    getConfigDir(): string {
        return this.config.baseDir;
    }

    getSkillsDir(): string {
        return join(this.config.baseDir, 'skills');
    }

    getHooksDir(): string {
        return join(this.config.baseDir, 'hooks');
    }

    getCommandsDir(): string {
        if (this.config.baseDir.includes('antigravity')) {
            return join(this.config.baseDir, 'global_workflows'); // Antigravity format
        }
        return join(this.config.baseDir, 'commands'); // Standard Gemini format
    }

    getCapabilities(): AdapterCapabilities {
        return {
            skills: true,
            hooks: true, // Gemini supports PreToolUse -> BeforeTool via our wrapper
            mcp: true,
            commands: true, // Auto-generates commands from skills
        };
    }
}
