import { join } from 'path';
import { ToolAdapter, type AdapterCapabilities } from './base.js';

export class ClaudeAdapter extends ToolAdapter {
    readonly toolName = 'claude-code';
    readonly displayName = 'Claude Code';
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
        return join(this.config.baseDir, 'commands'); // Though Claude doesn't strictly use bare commands like Gemini
    }

    getCapabilities(): AdapterCapabilities {
        return {
            skills: true,
            hooks: true,
            mcp: true,
            commands: false, // Claude uses Skills instead of Slash Commands natively
        };
    }
}
